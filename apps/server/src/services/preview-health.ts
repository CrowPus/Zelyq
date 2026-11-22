import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { connect, type PeerCertificate } from "node:tls";
import type { CheckStatus, HealthCheck } from "./observability.js";

/**
 * Whether named previews work, checked from outside the way a visitor's
 * browser reaches them: the wildcard name resolves, the certificate a
 * visitor gets is valid and not about to run out, the certificate on this
 * server (the one renewal replaces) is too, and Zelyq's preview router
 * answers. A made-up preview name is used, so no real app is touched: its
 * six-character tail has letters a project id never has.
 */
export interface PreviewHealthReport {
  status: CheckStatus;
  /** One line for a person. */
  detail: string;
  domain: string | null;
  checkedAt: string;
  name?: string;
  addresses?: string[];
  /** What a visitor's browser is given (Cloudflare's, when it is in front). */
  publicCertificate?: CertificateFacts | null;
  /** What this server's web server holds: the one renewal replaces. Null when TLS ends elsewhere. */
  serverCertificate?: CertificateFacts | null;
  routerAnswering?: boolean;
  problems: string[];
}

export interface CertificateFacts {
  validTo: string;
  daysLeft: number;
  issuer: string;
  coversName: boolean;
  trusted: boolean;
}

/** Below this, a warning; below the second, the check is down. */
const WARN_DAYS = 21;
const DOWN_DAYS = 7;
const CACHE_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
/** Not a project's name: a project id's tail is hex, never "z". */
const CHECK_LABEL = "zelyq-health-zzzzzz";
/** The marker on the router's own "not running" page (routes/preview-proxy.ts). */
const ROUTER_MARKER = "This preview is not running";

export interface PreviewHealthProbes {
  lookup(name: string): Promise<string[]>;
  certificate(host: string, port: number, servername: string): Promise<CertificateFacts | null>;
  routerPage(name: string): Promise<{ status: number; body: string } | null>;
}

export class PreviewHealth {
  private last: PreviewHealthReport | null = null;
  private running: Promise<PreviewHealthReport> | null = null;

  constructor(
    private readonly domain: () => string | null,
    private readonly probes: PreviewHealthProbes = realProbes,
  ) {}

  /** Drops the remembered result, e.g. when the domain changes. */
  forget(): void {
    this.last = null;
  }

  /** The latest result, checked again when older than five minutes or when asked. */
  async report(fresh = false): Promise<PreviewHealthReport> {
    const domain = this.domain();
    if (
      !fresh &&
      this.last &&
      this.last.domain === domain &&
      Date.now() - Date.parse(this.last.checkedAt) < CACHE_MS
    ) {
      return this.last;
    }
    if (!this.running) {
      this.running = this.check(domain)
        .then((report) => {
          this.last = report;
          return report;
        })
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }

  /**
   * As a line in the server's deep health check: the last result at once
   * (refreshed in the background when old), never a wait on the network.
   * Advisory: a preview problem never marks the whole server down.
   */
  async asHealthCheck(): Promise<HealthCheck> {
    const domain = this.domain();
    const usable = this.last && this.last.domain === domain ? this.last : null;
    const fresh = usable && Date.now() - Date.parse(usable.checkedAt) < CACHE_MS;
    if (!fresh) {
      const next = this.report(true).catch(() => null);
      if (!usable) {
        const first = await Promise.race([
          next,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000).unref()),
        ]);
        if (!first) {
          return { name: "previews", status: "off", detail: "being checked", advisory: true };
        }
        return { name: "previews", status: first.status, detail: first.detail, advisory: true };
      }
    }
    const report = usable as PreviewHealthReport;
    return { name: "previews", status: report.status, detail: report.detail, advisory: true };
  }

  private async check(domain: string | null): Promise<PreviewHealthReport> {
    const checkedAt = new Date().toISOString();
    if (!domain) {
      return {
        status: "off",
        detail: "no preview domain: previews are not served by name",
        domain: null,
        checkedAt,
        problems: [],
      };
    }
    const name = `${CHECK_LABEL}.${domain}`;
    const problems: string[] = [];
    const warnings: string[] = [];

    const addresses = await this.probes.lookup(name).catch(() => [] as string[]);
    if (addresses.length === 0) problems.push(`*.${domain} does not resolve`);

    const [publicCertificate, serverCertificate, page] = await Promise.all([
      addresses.length
        ? this.probes.certificate(name, 443, name).catch(() => null)
        : Promise.resolve(null),
      this.probes.certificate("127.0.0.1", 443, name).catch(() => null),
      addresses.length ? this.probes.routerPage(name).catch(() => null) : Promise.resolve(null),
    ]);

    const judge = (label: string, facts: CertificateFacts | null) => {
      if (!facts) return;
      if (!facts.coversName) problems.push(`the ${label} certificate does not cover *.${domain}`);
      else if (!facts.trusted) problems.push(`the ${label} certificate is not trusted`);
      else if (facts.daysLeft < DOWN_DAYS)
        problems.push(`the ${label} certificate runs out in ${facts.daysLeft} days`);
      else if (facts.daysLeft < WARN_DAYS)
        warnings.push(`the ${label} certificate runs out in ${facts.daysLeft} days`);
    };
    if (addresses.length && !publicCertificate) problems.push("no certificate is served for it");
    judge("public", publicCertificate);
    // Behind Cloudflare the visitor sees Cloudflare's certificate, so the one
    // on this server is what renewal keeps alive: it is judged too (once,
    // when it is the same certificate).
    const same =
      serverCertificate &&
      publicCertificate &&
      serverCertificate.validTo === publicCertificate.validTo &&
      serverCertificate.issuer === publicCertificate.issuer;
    if (serverCertificate && !same) judge("server", serverCertificate);

    const routerAnswering = Boolean(page && page.body.includes(ROUTER_MARKER));
    if (addresses.length && !routerAnswering) {
      problems.push(
        page ? `the preview router did not answer (got ${page.status})` : "nothing answered",
      );
    }

    const status: CheckStatus = problems.length ? "down" : warnings.length ? "slow" : "ok";
    const days = [publicCertificate, serverCertificate]
      .filter((facts): facts is CertificateFacts => Boolean(facts))
      .map((facts) => facts.daysLeft);
    const detail =
      status === "ok"
        ? `*.${domain}: certificate ${Math.min(...days)} days left, router answering`
        : [...problems, ...warnings].join("; ");
    return {
      status,
      detail,
      domain,
      checkedAt,
      name,
      addresses,
      publicCertificate,
      serverCertificate,
      routerAnswering,
      problems: [...problems, ...warnings],
    };
  }
}

function facts(certificate: PeerCertificate, name: string, trusted: boolean): CertificateFacts {
  const validTo = new Date(certificate.valid_to).toISOString();
  const names = (certificate.subjectaltname ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/^DNS:/, "").toLowerCase());
  // A wildcard covers exactly one label: *.zelyq.app covers a.zelyq.app, not a.b.zelyq.app.
  const covers = names.some((entry) => {
    if (entry === name) return true;
    if (!entry.startsWith("*.")) return false;
    const base = entry.slice(2);
    if (!name.endsWith(`.${base}`)) return false;
    return !name.slice(0, -(base.length + 1)).includes(".");
  });
  return {
    validTo,
    daysLeft: Math.floor((Date.parse(validTo) - Date.now()) / DAY_MS),
    issuer: [certificate.issuer?.O ?? certificate.issuer?.CN ?? "unknown"].flat()[0] ?? "unknown",
    coversName: covers,
    trusted,
  };
}

const realProbes: PreviewHealthProbes = {
  async lookup(name) {
    const found = await Promise.race([
      lookup(name, { all: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), 3000).unref(),
      ),
    ]);
    return found.map((entry) => entry.address);
  },
  certificate(host, port, servername) {
    return new Promise((resolve) => {
      const socket = connect({ host, port, servername, rejectUnauthorized: false, timeout: 4000 });
      const done = (value: CertificateFacts | null) => {
        socket.destroy();
        resolve(value);
      };
      socket.once("secureConnect", () => {
        const peer = socket.getPeerCertificate();
        done(peer?.valid_to ? facts(peer, servername, socket.authorized) : null);
      });
      socket.once("timeout", () => done(null));
      socket.once("error", () => done(null));
    });
  },
  routerPage(name) {
    return new Promise((resolve) => {
      const request = httpsRequest(
        { host: name, port: 443, path: "/", method: "GET", servername: name, timeout: 4000 },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            if (body.length < 20_000) body += chunk;
          });
          response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
        },
      );
      // Settles once, whichever comes first: an answer, an error, or silence.
      request.on("timeout", () => {
        request.destroy();
        resolve(null);
      });
      request.on("error", () => resolve(null));
      request.on("close", () => resolve(null));
      request.end();
    });
  },
};

/** Where the watcher keeps what it last told people, so a restart does not tell them again. */
export interface PreviewHealthMemory {
  get(): Promise<string | null>;
  set(status: string): Promise<void>;
}

/**
 * Checks every hour and says so when previews start needing attention (a
 * certificate under three weeks, or anything down) and when they are fine
 * again: the change, never every check. A bad result is checked again five
 * minutes later before anyone hears of it, so one network hiccup is not an
 * email. What was last said is kept in the database: a restart, or a second
 * process, does not say it again.
 */
export function watchPreviewHealth(
  health: PreviewHealth,
  memory: PreviewHealthMemory,
  notify: (change: { status: CheckStatus; report: PreviewHealthReport }) => Promise<void> | void,
  options: { everyMs?: number; confirmMs?: number; firstMs?: number } = {},
): () => void {
  const everyMs = options.everyMs ?? 60 * 60_000;
  const confirmMs = options.confirmMs ?? 5 * 60_000;
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, work: () => Promise<void>) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      void work().catch(() => undefined);
    }, ms);
    timer.unref();
    timers.add(timer);
  };
  const bad = (status: string | null) => status === "slow" || status === "down";

  const tick = async (confirming: boolean): Promise<void> => {
    const report = await health.report(true);
    const now = report.status;
    if (now === "off") return;
    const said = await memory.get();
    if (now === said) return;
    if (bad(now) && !confirming) {
      // Not yet: once more in a few minutes.
      later(confirmMs, () => tick(true));
      return;
    }
    if (!bad(now) && !bad(said)) {
      await memory.set(now);
      return;
    }
    await memory.set(now);
    await notify({ status: now, report });
  };

  later(options.firstMs ?? 60_000, () => tick(false));
  const timer = setInterval(() => void tick(false).catch(() => undefined), everyMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    for (const pending of timers) clearTimeout(pending);
  };
}
