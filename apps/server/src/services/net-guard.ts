import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import os from "node:os";

/**
 * The one guard for every call Zelyq makes to an address someone else chose:
 * Ops's checks, notifications, channels, mail.
 *
 * - "strict": an address the engineer (a model) picks. Refuses this server,
 *   private networks, link-local and cloud metadata addresses.
 * - "normal": an address a person set up (a webhook to the team's own chat
 *   server on the office network is legitimate). Refuses this server,
 *   link-local and cloud metadata addresses only.
 * - "deployment": the address of an app Zelyq deployed, worked out from the
 *   deployment itself (it may run on this very machine). Refuses link-local
 *   and cloud metadata addresses only; callers return a status, never a body.
 *
 * The check happens when the connection is made, on the exact address it is
 * made to: a name cannot pass the check and then resolve somewhere else.
 */
export type GuardLevel = "strict" | "normal" | "deployment";

const ALWAYS = new BlockList();
ALWAYS.addSubnet("127.0.0.0", 8, "ipv4");
ALWAYS.addSubnet("0.0.0.0", 8, "ipv4");
ALWAYS.addSubnet("169.254.0.0", 16, "ipv4");
ALWAYS.addAddress("::1", "ipv6");
ALWAYS.addAddress("::", "ipv6");
ALWAYS.addSubnet("fe80::", 10, "ipv6");
ALWAYS.addAddress("fd00:ec2::254", "ipv6");
// Multicast, broadcast and the retired site-local range: never a place to call.
ALWAYS.addSubnet("224.0.0.0", 4, "ipv4");
ALWAYS.addSubnet("240.0.0.0", 4, "ipv4");
ALWAYS.addSubnet("ff00::", 8, "ipv6");
ALWAYS.addSubnet("fec0::", 10, "ipv6");
// Translation ranges that can carry a local address in any position: local-use NAT64, Teredo.
ALWAYS.addSubnet("64:ff9b:1::", 48, "ipv6");
ALWAYS.addSubnet("2001::", 32, "ipv6");

const METADATA = new BlockList();
METADATA.addSubnet("169.254.0.0", 16, "ipv4");
METADATA.addSubnet("fe80::", 10, "ipv6");
METADATA.addAddress("fd00:ec2::254", "ipv6");

const PRIVATE = new BlockList();
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE.addSubnet("fc00::", 7, "ipv6");

/** This machine's own addresses, on every interface. */
function ownAddresses(): Set<string> {
  const found = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list ?? []) found.add(entry.address.toLowerCase());
  }
  return found;
}

/** An IPv6 address as its eight 16-bit groups, or null. */
function groupsOf(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;
  let text = ip;
  // A dotted IPv4 tail (::ffff:1.2.3.4) as two groups.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split("::") as [string, string | undefined];
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const fill = rest === undefined ? [] : Array(8 - left.length - right.length).fill("0");
  const groups = [...left, ...fill, ...right].map((part) => Number.parseInt(part || "0", 16));
  return groups.length === 8 ? groups : null;
}

const v4 = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;

/**
 * The IPv4 address an IPv6 one carries inside, for the forms that route to
 * it: mapped (::ffff:a.b.c.d), translated (::ffff:0:a.b.c.d), compatible
 * (::a.b.c.d), NAT64 (64:ff9b::a.b.c.d) and 6to4 (2002:aabb:ccdd::).
 */
function embeddedIPv4(ip: string): string | null {
  const g = groupsOf(ip);
  if (!g) return null;
  const zero = (from: number, to: number) => g.slice(from, to).every((part) => part === 0);
  if (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return v4(g[6] as number, g[7] as number);
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return v4(g[6] as number, g[7] as number);
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return v4(g[6] as number, g[7] as number);
  if (g[0] === 0x2002) return v4(g[1] as number, g[2] as number);
  return null;
}

/** Why an address is refused at this level, or null when it is fine. */
export function refusedAddress(address: string, level: GuardLevel): string | null {
  let ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  // An IPv4 address carried in IPv6 (::ffff:127.0.0.1, 64:ff9b::7f00:1, …) is that address.
  const inside = embeddedIPv4(ip);
  if (inside) ip = inside;
  const family = isIP(ip);
  if (family === 0) return `${address} is not an address.`;
  const kind = family === 6 ? "ipv6" : "ipv4";
  if (level === "deployment") {
    return METADATA.check(ip, kind)
      ? `${address} is a link-local or cloud metadata address.`
      : null;
  }
  if (ALWAYS.check(ip, kind) || ownAddresses().has(ip)) {
    return `${address} is this server, or a local, link-local, multicast or cloud metadata address.`;
  }
  if (level === "strict" && PRIVATE.check(ip, kind)) {
    return `${address} is on a private network.`;
  }
  return null;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** A DNS lookup that refuses (rather than returns) any address the guard refuses. */
export function guardedLookup(level: GuardLevel) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback): void => {
    dnsLookup(hostname, { all: true }, (error, addresses) => {
      if (error) {
        callback(error, []);
        return;
      }
      const list = addresses as LookupAddress[];
      for (const entry of list) {
        const reason = refusedAddress(entry.address, level);
        if (reason) {
          callback(Object.assign(new Error(`${hostname}: ${reason}`), { code: "EGUARD" }), []);
          return;
        }
      }
      if (options.all) callback(null, list);
      else callback(null, list[0]?.address ?? "", list[0]?.family);
    });
  };
}

export interface GuardedResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  /** How long until the first byte of the answer, in milliseconds. */
  ms: number;
}

/**
 * One HTTP(S) request to an address someone else chose. No redirects are
 * followed (a redirect could point anywhere); the body is read up to a limit.
 */
export function guardedRequest(
  address: string,
  init: {
    level: GuardLevel;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    maxBytes?: number;
  },
): Promise<GuardedResponse> {
  const url = new URL(address);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return Promise.reject(new Error("Only http:// and https:// addresses."));
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    const reason = refusedAddress(host, init.level);
    if (reason) return Promise.reject(new Error(reason));
  }
  const maxBytes = init.maxBytes ?? 1_000_000;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const outgoing = send(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers,
        lookup: guardedLookup(init.level) as never,
        timeout: init.timeoutMs ?? 10_000,
      },
      (response) => {
        const ms = Date.now() - started;
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size <= maxBytes) chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            ms,
          }),
        );
        response.on("error", reject);
      },
    );
    outgoing.on("timeout", () =>
      outgoing.destroy(new Error(`${url.host} did not answer in time.`)),
    );
    outgoing.on("error", reject);
    if (init.body) outgoing.write(init.body);
    outgoing.end();
  });
}

/**
 * Why a machine's address (an IP or a host name) is refused at this level, or
 * null. A name is looked up now and every address it leads to is checked; a
 * name that does not resolve yet is let through (the connection is guarded
 * again when it is made).
 */
export async function refusedHost(host: string, level: GuardLevel): Promise<string | null> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare)) return refusedAddress(bare, level);
  const found = await new Promise<LookupAddress[]>((resolve) => {
    dnsLookup(bare, { all: true }, (error, addresses) =>
      resolve(error ? [] : (addresses as LookupAddress[])),
    );
  });
  for (const entry of found) {
    const reason = refusedAddress(entry.address, level);
    if (reason) return `${host} leads to ${entry.address}: ${reason}`;
  }
  return null;
}
