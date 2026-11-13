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
 *
 * The check happens when the connection is made, on the exact address it is
 * made to: a name cannot pass the check and then resolve somewhere else.
 */
export type GuardLevel = "strict" | "normal";

const ALWAYS = new BlockList();
ALWAYS.addSubnet("127.0.0.0", 8, "ipv4");
ALWAYS.addSubnet("0.0.0.0", 8, "ipv4");
ALWAYS.addSubnet("169.254.0.0", 16, "ipv4");
ALWAYS.addAddress("::1", "ipv6");
ALWAYS.addAddress("::", "ipv6");
ALWAYS.addSubnet("fe80::", 10, "ipv6");
ALWAYS.addAddress("fd00:ec2::254", "ipv6");

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

/** Why an address is refused at this level, or null when it is fine. */
export function refusedAddress(address: string, level: GuardLevel): string | null {
  let ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  // ::ffff:127.0.0.1 is 127.0.0.1.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1]) ip = mapped[1];
  const family = isIP(ip);
  if (family === 0) return `${address} is not an address.`;
  const kind = family === 6 ? "ipv6" : "ipv4";
  if (ALWAYS.check(ip, kind) || ownAddresses().has(ip)) {
    return `${address} is this server, or a link-local or cloud metadata address.`;
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
