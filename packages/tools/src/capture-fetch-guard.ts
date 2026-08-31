/**
 * The SSRF guard for `capture_reference` (proposal 067).
 *
 * `capture_reference` is the one tool that reaches an arbitrary URL a user
 * typed. Everything it fetches — the pages it navigates, every image, font and
 * media subresource — goes through this module. There is no operator switch to
 * turn it off.
 *
 * What it stops:
 *   - non-http(s) schemes, embedded credentials, ports other than 80/443;
 *   - a hostname that resolves to a loopback / private / link-local / CGNAT /
 *     multicast / reserved address (the cloud metadata endpoint,
 *     169.254.169.254, is link-local and covered);
 *   - a public URL that 30x-redirects toward an internal host — every hop is
 *     re-resolved and re-checked;
 *   - DNS rebinding between the check and the connect — the socket is pinned to
 *     the exact address that was validated (`lookup` below).
 *
 * It is deliberately a small pile of pure functions plus one `guardedFetch`, so
 * the SSRF table in `capture-fetch-guard.test.ts` can exercise every branch
 * without a network.
 */
import { lookup as dnsLookupCb } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { promisify } from "node:util";

const dnsLookupAll = promisify(dnsLookupCb) as (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

export const CLONE_USER_AGENT = "ZelyqCloneBot/1.0 (+https://zelyq.com/clone)";

/** Raised for anything the guard refuses. `reason` is safe to show a user. */
export class CaptureBlockedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "CaptureBlockedError";
  }
}

// --- address classification ------------------------------------------------

function ipv4ToInt(ip: string): number {
  const p = ip.split(".").map((n) => Number.parseInt(n, 10));
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return Number.NaN;
  const [a, b, c, d] = p as [number, number, number, number];
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

function inCidr4(ipInt: number, base: string, bits: number): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : ~((1 << (32 - bits)) - 1) >>> 0;
  return (ipInt & mask) === (ipv4ToInt(base) & mask);
}

/** RFC 1918 / 5735 / 6598 / 3927 / 5771 and friends — anything not on the
 * public internet, plus the documentation and benchmark ranges for good
 * measure. */
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — includes the 169.254.169.254 metadata IP
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
  ["255.255.255.255", 32],
];

function isBlockedV4(ip: string): boolean {
  const asInt = ipv4ToInt(ip);
  if (Number.isNaN(asInt)) return true; // unparseable → refuse
  return BLOCKED_V4.some(([base, bits]) => inCidr4(asInt, base, bits));
}

function ipv6ToBigInt(ip: string): bigint | null {
  const zone = ip.indexOf("%");
  const clean = zone === -1 ? ip : ip.slice(0, zone);
  const halves = clean.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
  let groups: string[];
  if (tail === null) {
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  }
  if (groups.length !== 8) return null;
  let out = 0n;
  for (const g of groups) {
    const v = Number.parseInt(g || "0", 16);
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null;
    out = (out << 16n) + BigInt(v);
  }
  return out;
}

function inCidr6(value: bigint, prefixHex: bigint, bits: number): boolean {
  if (bits === 0) return true;
  const shift = BigInt(128 - bits);
  return value >> shift === prefixHex >> shift;
}

function isBlockedV6(ip: string): boolean {
  const v = ipv6ToBigInt(ip);
  if (v === null) return true;
  // ::/128 unspecified, ::1/128 loopback
  if (v === 0n || v === 1n) return true;
  // IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96): judge the embedded v4.
  const nat64Prefix = (0x64n << 112n) | (0xff9bn << 96n);
  if (inCidr6(v, 0xffffn << 32n, 96) || inCidr6(v, nat64Prefix, 96)) {
    const embedded = Number(v & 0xffffffffn);
    const dotted = [
      (embedded >>> 24) & 255,
      (embedded >>> 16) & 255,
      (embedded >>> 8) & 255,
      embedded & 255,
    ].join(".");
    return isBlockedV4(dotted);
  }
  // fc00::/7 unique-local
  if (inCidr6(v, 0xfc00n << 112n, 7)) return true;
  // fe80::/10 link-local
  if (inCidr6(v, 0xfe80n << 112n, 10)) return true;
  // ff00::/8 multicast
  if (inCidr6(v, 0xff00n << 112n, 8)) return true;
  // 2001:db8::/32 documentation
  if (inCidr6(v, (0x2001n << 112n) | (0x0db8n << 96n), 32)) return true;
  return false;
}

/**
 * True when an address must never be connected to. IPv4-mapped and NAT64 forms
 * (`::ffff:10.0.0.1`, `64:ff9b::7f00:1`) are unwrapped to their embedded v4 and
 * judged there; anything that is not a recognisable IP literal is refused.
 */
export function isBlockedAddress(ip: string): boolean {
  const trimmed = ip.replace(/^\[|\]$/g, "");
  const embeddedV4 = trimmed.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  const family = isIP(trimmed);
  if (family === 4) return isBlockedV4(trimmed);
  if (embeddedV4 && trimmed.includes(":")) return isBlockedV4(embeddedV4[1] ?? trimmed);
  if (family === 6) return isBlockedV6(trimmed);
  return true;
}

// --- URL shape -----------------------------------------------------------

/**
 * Validates a URL's shape without touching the network. Throws
 * `CaptureBlockedError` on a bad scheme, credentials in the URL, a port other
 * than 80/443, or a literal address / `localhost` name that is already known
 * bad. A DNS name still has to clear `resolveAndAssertHost`.
 */
export function assertAllowedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CaptureBlockedError(`not a valid URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CaptureBlockedError(`only http and https are allowed, got "${url.protocol}"`);
  }
  if (url.username || url.password) {
    throw new CaptureBlockedError("a URL with an embedded username or password is not allowed");
  }
  const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
  if (port !== 80 && port !== 443) {
    throw new CaptureBlockedError(`only ports 80 and 443 are allowed, got ${port}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new CaptureBlockedError("the URL has no host");
  if (/^(localhost|.*\.localhost)$/i.test(host)) {
    throw new CaptureBlockedError(`"${host}" is not a public host`);
  }
  if (isIP(host) && isBlockedAddress(host)) {
    throw new CaptureBlockedError(`${host} is in a blocked address range`);
  }
  return url;
}

const resolveCache = new Map<string, { address: string; family: number }>();

/**
 * Resolves a hostname and refuses it unless **every** address it resolves to is
 * public. Returns one validated address to pin the socket to. Literal IPs skip
 * DNS but are still range-checked. Cached for the life of the process so a long
 * crawl does not re-resolve every host on every subresource.
 */
export async function resolveAndAssertHost(
  hostname: string,
): Promise<{ address: string; family: number }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const cached = resolveCache.get(host);
  if (cached) return cached;

  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new CaptureBlockedError(`${host} is in a blocked address range`);
    }
    const pinned = { address: host, family: isIP(host) };
    resolveCache.set(host, pinned);
    return pinned;
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await dnsLookupAll(host, { all: true });
  } catch {
    throw new CaptureBlockedError(`could not resolve "${host}"`);
  }
  if (records.length === 0) throw new CaptureBlockedError(`no addresses for "${host}"`);
  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new CaptureBlockedError(
        `"${host}" resolves to ${record.address}, which is in a blocked range`,
      );
    }
  }
  const pinned = records[0];
  if (!pinned) throw new CaptureBlockedError(`no addresses for "${host}"`);
  resolveCache.set(host, pinned);
  return pinned;
}

/** For a Playwright `route` handler: resolve+range-check, throw if blocked. */
export async function assertRequestAllowed(rawUrl: string): Promise<void> {
  const url = assertAllowedUrl(rawUrl);
  await resolveAndAssertHost(url.hostname);
}

// --- the fetch -----------------------------------------------------------

export interface GuardedResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  finalUrl: string;
}

export interface GuardedFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

function requestOnce(
  url: URL,
  pinned: { address: string; family: number },
  timeoutMs: number,
  maxBytes: number,
  extraHeaders: Record<string, string>,
): Promise<{ status: number; headers: GuardedResponse["headers"]; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method: "GET",
        timeout: Math.max(1000, timeoutMs),
        headers: { "user-agent": CLONE_USER_AGENT, accept: "*/*", ...extraHeaders },
        // Pin the connection to the address the guard already validated — a
        // rebind between resolve and connect cannot swap in a private IP.
        lookup: (_hostname, options, cb) => {
          if (options && (options as { all?: boolean }).all) {
            (cb as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [
              pinned,
            ]);
          } else {
            (cb as (e: null, a: string, f: number) => void)(null, pinned.address, pinned.family);
          }
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            req.destroy();
            reject(new CaptureBlockedError(`response exceeds the ${maxBytes}-byte cap`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new CaptureBlockedError("the request timed out")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * A GET that enforces the whole guard: shape check, resolve-and-range-check,
 * pinned connect, and manual redirect following (max 5) with every hop
 * re-validated. Never sends cookies, credentials, or any header the caller did
 * not pass.
 */
export async function guardedFetch(
  rawUrl: string,
  options: GuardedFetchOptions = {},
): Promise<GuardedResponse> {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 20_000;
  let redirectsLeft = options.maxRedirects ?? 5;
  let current = assertAllowedUrl(rawUrl);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const pinned = await resolveAndAssertHost(current.hostname);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new CaptureBlockedError("the request timed out");
    const res = await requestOnce(current, pinned, remaining, maxBytes, options.headers ?? {});

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.location;
      const target = Array.isArray(location) ? location[0] : location;
      if (!target) return { ...res, finalUrl: current.href };
      if (redirectsLeft-- <= 0) throw new CaptureBlockedError("too many redirects");
      current = assertAllowedUrl(new URL(target, current).href);
      continue;
    }
    return { ...res, finalUrl: current.href };
  }
}

/** Test seam — drop the resolve cache between cases. */
export function __clearResolveCache(): void {
  resolveCache.clear();
}
