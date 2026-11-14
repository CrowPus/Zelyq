import { Resolver } from "node:dns/promises";
import { connect as tlsConnect } from "node:tls";
import { guardedLookup, guardedRequest } from "../../net-guard.js";

/**
 * The light probes the watch runs (075 Step 1): each one fixed, small and
 * cheap, never a shell for a model. Each says what it saw in plain words.
 */

export interface ProbeResult {
  ok: boolean;
  /** How long it took, for answer times (0 when not timed). */
  ms: number;
  detail: string;
}

/** Whether an app's address answers, and how fast (an error page counts as no answer). */
export async function probeAddress(address: string): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const answer = await guardedRequest(address, {
      level: "deployment",
      timeoutMs: 10_000,
      maxBytes: 0,
    });
    const ok = answer.status < 500;
    return {
      ok,
      ms: answer.ms,
      detail: ok
        ? `answered ${answer.status} in ${answer.ms} ms`
        : `answered ${answer.status} (an error page)`,
    };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      detail: `no answer: ${(error as Error).message}`,
    };
  }
}

/** Asks public resolvers: what visitors get, not what this server has cached. */
export function publicResolver(): Resolver {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  return resolver;
}

export interface DnsFacts {
  a: string[];
  aaaa: string[];
  cname: string[];
}

export async function dnsFacts(domain: string): Promise<DnsFacts> {
  const resolver = publicResolver();
  const [a, aaaa, cname] = await Promise.all([
    resolver.resolve4(domain).catch(() => [] as string[]),
    resolver.resolve6(domain).catch(() => [] as string[]),
    resolver.resolveCname(domain).catch(() => [] as string[]),
  ]);
  return { a, aaaa, cname };
}

/** Whether a domain still leads to the machine it is served from. */
export async function probeDomain(domain: string, machineAddress: string): Promise<ProbeResult> {
  const facts = await dnsFacts(domain);
  const targets = /^[0-9.]+$/.test(machineAddress)
    ? [machineAddress]
    : await publicResolver()
        .resolve4(machineAddress)
        .catch(() => [] as string[]);
  if (facts.a.length === 0 && facts.cname.length === 0) {
    return { ok: false, ms: 0, detail: `${domain} has no DNS record` };
  }
  const leads = facts.a.some((address) => targets.includes(address));
  return {
    ok: leads,
    ms: 0,
    detail: leads
      ? `${domain} leads to ${machineAddress}`
      : `${domain} leads to ${[...facts.a, ...facts.cname].join(", ")}, not to ${machineAddress}`,
  };
}

export interface CertificateFacts {
  valid: boolean;
  daysLeft: number | null;
  issuer: string | null;
  names: string[];
  error: string | null;
}

/** The certificate a domain shows on port 443. */
export function certificateFacts(domain: string): Promise<CertificateFacts> {
  return new Promise((resolve) => {
    const socket = tlsConnect({
      host: domain,
      port: 443,
      servername: domain,
      rejectUnauthorized: false,
      lookup: guardedLookup("strict") as never,
      timeout: 10_000,
    });
    const finish = (facts: CertificateFacts) => {
      socket.destroy();
      resolve(facts);
    };
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      const expires = certificate.valid_to ? new Date(certificate.valid_to) : null;
      finish({
        valid: socket.authorized,
        daysLeft: expires ? Math.floor((expires.getTime() - Date.now()) / 86_400_000) : null,
        issuer: (certificate.issuer?.O as string | undefined) ?? null,
        names: String(certificate.subjectaltname ?? "")
          .split(",")
          .map((name) => name.trim().replace(/^DNS:/, ""))
          .filter(Boolean),
        error: socket.authorized ? null : String(socket.authorizationError ?? "not trusted"),
      });
    });
    socket.once("timeout", () =>
      finish({
        valid: false,
        daysLeft: null,
        issuer: null,
        names: [],
        error: "no answer on port 443",
      }),
    );
    socket.once("error", (error) =>
      finish({ valid: false, daysLeft: null, issuer: null, names: [], error: error.message }),
    );
  });
}

export async function probeCertificate(
  domain: string,
): Promise<ProbeResult & { daysLeft: number | null }> {
  const facts = await certificateFacts(domain);
  if (!facts.valid) {
    return {
      ok: false,
      ms: 0,
      daysLeft: facts.daysLeft,
      detail: `${domain}: certificate not valid (${facts.error})`,
    };
  }
  return {
    ok: (facts.daysLeft ?? 0) >= 14,
    ms: 0,
    daysLeft: facts.daysLeft,
    detail: `${domain}: certificate valid, ${facts.daysLeft} days left`,
  };
}

/**
 * One fixed script per machine (sent to its shell, never built from input):
 * disk, memory, load, and every Zelyq
 * container's state and restart count. Lines are tagged so the answer is easy
 * to read and nothing in a container's name can be mistaken for a figure.
 */
export const MACHINE_SCRIPT = `
echo "disk $(df -P / | awk 'NR==2{print $5}')"
d=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null)
[ -n "$d" ] && echo "dockerdisk $(df -P "$d" | awk 'NR==2{print $5}')"
echo "mem $(awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{print int(a*100/t)}' /proc/meminfo)"
echo "load $(cut -d' ' -f1 /proc/loadavg) $(nproc)"
docker ps -a --filter name=^zelyq- --format 'c {{.Names}}|{{.State}}' 2>/dev/null
for n in $(docker ps -aq --filter name=^zelyq- 2>/dev/null); do docker inspect --format 'r {{.Name}}|{{.RestartCount}}' "$n"; done
exit 0
`;

export interface MachineFacts {
  diskPct: number | null;
  dockerDiskPct: number | null;
  memAvailablePct: number | null;
  load: number | null;
  cpus: number | null;
  containers: Map<string, { state: string; restarts: number }>;
}

export function readMachine(output: string): MachineFacts {
  const facts: MachineFacts = {
    diskPct: null,
    dockerDiskPct: null,
    memAvailablePct: null,
    load: null,
    cpus: null,
    containers: new Map(),
  };
  for (const line of output.split("\n")) {
    const [tag, ...rest] = line.trim().split(" ");
    const value = rest.join(" ");
    if (tag === "disk") facts.diskPct = Number.parseInt(value, 10);
    else if (tag === "dockerdisk") facts.dockerDiskPct = Number.parseInt(value, 10);
    else if (tag === "mem") facts.memAvailablePct = Number.parseInt(value, 10);
    else if (tag === "load") {
      const [load, cpus] = value.split(" ");
      facts.load = Number.parseFloat(load ?? "");
      facts.cpus = Number.parseInt(cpus ?? "", 10);
    } else if (tag === "c") {
      const [name, state] = value.split("|");
      if (name) {
        const seen = facts.containers.get(name);
        facts.containers.set(name, { state: state ?? "unknown", restarts: seen?.restarts ?? 0 });
      }
    } else if (tag === "r") {
      const [rawName, count] = value.split("|");
      const name = (rawName ?? "").replace(/^\//, "");
      if (name) {
        const seen = facts.containers.get(name);
        facts.containers.set(name, {
          state: seen?.state ?? "unknown",
          restarts: Number.parseInt(count ?? "0", 10) || 0,
        });
      }
    }
  }
  for (const key of ["diskPct", "dockerDiskPct", "memAvailablePct", "load", "cpus"] as const) {
    if (Number.isNaN(facts[key] as number)) facts[key] = null;
  }
  return facts;
}
