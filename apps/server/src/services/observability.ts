import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { newId, ZelyqError } from "@zelyq/core";
import type { ErrorGroupRow, Store } from "@zelyq/db";

/**
 * What a server's developers need to see: whether every part is healthy,
 * which errors happen (grouped, with secrets taken out), why work fails, and
 * how fast it answers. Read through the admin API (`health`, `errors`,
 * `metrics` scopes); nothing leaves the server by itself.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------------ scrubbing

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk|pk|rk)[-_](?:live_|test_|ant-|proj-)?[A-Za-z0-9_-]{12,}/g, "[key]"],
  [/\bzlq_[a-z]+_[A-Za-z0-9_-]{10,}/g, "[key]"],
  [/\bzvk_[A-Za-z0-9_-]{10,}/g, "[key]"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "[key]"],
  [/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g, "[key]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[key]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[token]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [token]"],
  [
    /\b(password|passwd|secret|token|api[_-]?key|apikey|authorization|cookie)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi,
    "$1$2[hidden]",
  ],
  [/:\/\/[^/\s:@]+:[^/\s@]+@/g, "://[user]:[hidden]@"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b[A-Fa-f0-9]{40,}\b/g, "[hex]"],
  [/\b[A-Za-z0-9+/]{48,}={0,2}/g, "[data]"],
];

/** Takes out anything that looks like a key, token, password or email. */
export function scrub(text: string): string {
  let clean = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) clean = clean.replace(pattern, replacement);
  return clean;
}

/** The same failure with different ids or numbers in its message is one failure. */
function normalize(message: string): string {
  return message
    .replace(/\b[a-z]{3}_[0-9a-f]{8,}\b/g, "<id>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b\d+(\.\d+)?\b/g, "<n>")
    .replace(/(["'`]).{1,80}?\1/g, "$1…$1")
    .slice(0, 300);
}

/** The first line of the stack that is this server's own code, without line numbers. */
function locationOf(stack: string | undefined): string {
  for (const line of (stack ?? "").split("\n").slice(1)) {
    if (line.includes("node_modules") || line.includes("node:")) continue;
    const match = /at (?:(.+?) \()?(?:.*\/)?((?:apps|packages)\/[^:)]+)/.exec(line);
    if (match) return `${match[2]}${match[1] ? ` ${match[1]}` : ""}`;
  }
  return "unknown";
}

export interface ErrorContext {
  route?: string | null;
  userId?: string | null;
  teamId?: string | null;
}

export class ErrorTracker {
  private readonly pending = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  /** Told about a group seen for the first time, or back after being resolved. */
  onNewGroup?: (group: ErrorGroupRow, regressed: boolean) => void;

  constructor(
    private readonly store: Store,
    private readonly log?: (error: unknown, message: string) => void,
  ) {}

  /** Records an error against its group. Never throws, never waits the caller. */
  capture(error: unknown, context: ErrorContext = {}): void {
    const work = this.write(error, context).catch((failure) =>
      this.log?.(failure, "could not record a server error"),
    );
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }

  async settled(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private async write(error: unknown, context: ErrorContext): Promise<void> {
    const failure = error instanceof Error ? error : new Error(String(error));
    const kind = (failure.name || "Error").slice(0, 80);
    const message = scrub(failure.message || "(no message)").slice(0, 500);
    const location = locationOf(failure.stack);
    const fingerprint = createHash("sha256")
      .update(`${kind}\n${normalize(message)}\n${location}`)
      .digest("hex");
    const at = new Date().toISOString();
    let group = await this.store.errors.findByFingerprint(fingerprint);
    let fresh = false;
    if (!group) {
      await this.store.errors.createGroup({
        id: newId("errorGroup"),
        fingerprint,
        kind,
        message,
        location,
        route: context.route ?? null,
        count: 0,
        firstSeen: at,
        lastSeen: at,
        status: "open",
        resolvedAt: null,
        sampleStack: scrub(failure.stack ?? "").slice(0, 4000),
      });
      group = await this.store.errors.findByFingerprint(fingerprint);
      fresh = true;
      if (!group) return;
    }
    const regressed = group.status === "resolved";
    await this.store.errors.hit(
      group.id,
      at,
      { userId: context.userId ?? null, teamId: context.teamId ?? null },
      regressed,
    );
    if (fresh || regressed) this.onNewGroup?.({ ...group, status: "open" }, regressed);
  }

  async list(query: { from?: string; to?: string; status?: string; limit?: string }) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 7 * DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw ZelyqError.badRequest("`from` and `to` must be dates.");
    }
    if (query.status && !["open", "resolved", "ignored"].includes(query.status)) {
      throw ZelyqError.badRequest("`status` is open, resolved or ignored.");
    }
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "100", 10) || 100, 1), 500);
    const groups = await this.store.errors.listGroups({
      from: from.toISOString(),
      status: query.status,
      limit,
    });
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      groups: await Promise.all(
        groups.map(async (group) => ({
          ...summarize(group),
          inRange: await this.store.errors.hitsFor(group.id, from.toISOString(), to.toISOString()),
        })),
      ),
    };
  }

  async detail(id: string) {
    const group = await this.store.errors.findById(id);
    if (!group) throw ZelyqError.notFound("Error group", id);
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 30 * DAY_MS).toISOString();
    return {
      ...summarize(group),
      sampleStack: group.sampleStack,
      last30Days: await this.store.errors.hitsFor(id, from, to),
      byDay: await this.store.errors.hitsByDay(id, from, to),
    };
  }

  async setStatus(id: string, raw: unknown) {
    const status = (raw as { status?: unknown } | null)?.status;
    if (status !== "open" && status !== "resolved" && status !== "ignored") {
      throw ZelyqError.badRequest('Send { "status": "open" | "resolved" | "ignored" }.');
    }
    if (!(await this.store.errors.findById(id))) throw ZelyqError.notFound("Error group", id);
    await this.store.errors.setStatus(id, status, new Date().toISOString());
    return await this.detail(id);
  }

  /** Who was hit is kept 90 days; the groups and their totals stay. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () =>
        void this.store.errors
          .forgetHitsBefore(new Date(Date.now() - 90 * DAY_MS).toISOString())
          .catch((error) => this.log?.(error, "could not prune error hits")),
      DAY_MS,
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function summarize(group: ErrorGroupRow) {
  return {
    id: group.id,
    kind: group.kind,
    message: group.message,
    location: group.location,
    route: group.route,
    count: group.count,
    firstSeen: group.firstSeen,
    lastSeen: group.lastSeen,
    status: group.status,
    resolvedAt: group.resolvedAt,
  };
}

// ------------------------------------------------------------------ timing

interface RouteStat {
  count: number;
  errors: number;
  clientErrors: number;
  totalMs: number;
  maxMs: number;
  /** The last few durations, for typical and worst-case figures. */
  recent: number[];
}

const RECENT = 500;
const LOOP_TICK_MS = 20;

/** How long each call takes, per route, since the server started. In memory only. */
export class RequestStats {
  private readonly routes = new Map<string, RouteStat>();
  readonly startedAt = Date.now();
  private readonly loop = monitorEventLoopDelay({ resolution: LOOP_TICK_MS });

  constructor() {
    this.loop.enable();
  }

  record(method: string, route: string, status: number, ms: number): void {
    const key = `${method} ${route}`;
    const stat = this.routes.get(key) ?? {
      count: 0,
      errors: 0,
      clientErrors: 0,
      totalMs: 0,
      maxMs: 0,
      recent: [],
    };
    stat.count += 1;
    if (status >= 500) stat.errors += 1;
    else if (status >= 400) stat.clientErrors += 1;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    stat.recent.push(ms);
    if (stat.recent.length > RECENT) stat.recent.shift();
    this.routes.set(key, stat);
  }

  /** The event loop's delay: how long work waits for its turn. High means overloaded. */
  loopDelayMs(): { p50: number; p99: number; max: number } {
    // Each sample includes the timer's own tick; what matters is the wait beyond it.
    const ms = (ns: number) => Math.max(0, Math.round((ns / 1e6 - LOOP_TICK_MS) * 10) / 10);
    return {
      p50: ms(this.loop.percentile(50)),
      p99: ms(this.loop.percentile(99)),
      max: ms(this.loop.max),
    };
  }

  routesReport(limit = 50) {
    return [...this.routes.entries()]
      .map(([route, stat]) => {
        const sorted = [...stat.recent].sort((a, b) => a - b);
        const at = (share: number) =>
          sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
        return {
          route,
          calls: stat.count,
          serverErrors: stat.errors,
          clientErrors: stat.clientErrors,
          averageMs: Math.round(stat.totalMs / stat.count),
          p50Ms: Math.round(at(0.5)),
          p95Ms: Math.round(at(0.95)),
          maxMs: Math.round(stat.maxMs),
        };
      })
      .sort((a, b) => b.p95Ms - a.p95Ms)
      .slice(0, limit);
  }

  /** The Prometheus text format, for Google Cloud Monitoring, Grafana and the like. */
  prometheus(extra: Array<{ name: string; help: string; value: number }> = []): string {
    const lines: string[] = [];
    const metric = (name: string, help: string, type: string) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    };
    const label = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    metric("zelyq_uptime_seconds", "Seconds since the server started.", "gauge");
    lines.push(`zelyq_uptime_seconds ${Math.round((Date.now() - this.startedAt) / 1000)}`);
    const memory = process.memoryUsage();
    metric("zelyq_memory_rss_bytes", "Memory the server process holds.", "gauge");
    lines.push(`zelyq_memory_rss_bytes ${memory.rss}`);
    metric("zelyq_memory_heap_used_bytes", "JavaScript heap in use.", "gauge");
    lines.push(`zelyq_memory_heap_used_bytes ${memory.heapUsed}`);
    const loop = this.loopDelayMs();
    metric(
      "zelyq_event_loop_delay_p99_ms",
      "How long work waits for its turn (99th percentile).",
      "gauge",
    );
    lines.push(`zelyq_event_loop_delay_p99_ms ${loop.p99}`);
    metric("zelyq_http_requests_total", "Calls answered, by route and kind of answer.", "counter");
    for (const [key, stat] of this.routes) {
      const [method, route] = key.split(" ");
      const ok = stat.count - stat.errors - stat.clientErrors;
      const base = `method="${label(method!)}",route="${label(route!)}"`;
      lines.push(`zelyq_http_requests_total{${base},class="2xx"} ${ok}`);
      lines.push(`zelyq_http_requests_total{${base},class="4xx"} ${stat.clientErrors}`);
      lines.push(`zelyq_http_requests_total{${base},class="5xx"} ${stat.errors}`);
    }
    metric(
      "zelyq_http_request_duration_ms_sum",
      "Total time spent answering, by route.",
      "counter",
    );
    for (const [key, stat] of this.routes) {
      const [method, route] = key.split(" ");
      lines.push(
        `zelyq_http_request_duration_ms_sum{method="${label(method!)}",route="${label(route!)}"} ${Math.round(stat.totalMs)}`,
      );
    }
    for (const entry of extra) {
      metric(entry.name, entry.help, "gauge");
      lines.push(`${entry.name} ${entry.value}`);
    }
    return `${lines.join("\n")}\n`;
  }
}

// ------------------------------------------------------------------ health

export type CheckStatus = "ok" | "slow" | "down" | "off";
export interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  ms?: number;
}

export interface HealthProbes {
  store: Store;
  dataDir: string;
  runtime: () => Promise<{ ok: boolean; detail?: string }>;
  agent: () => Promise<{ status: string; detail?: string }>;
  mailConfigured: () => Promise<boolean>;
  lastCleanup: () => Promise<{ at?: string; finishedAt?: string } | null>;
  stats: RequestStats;
}

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now();
  const value = await work();
  return { value, ms: Math.round(performance.now() - started) };
}

/** Every part of the server, checked now. Each check has its own time limit. */
export async function deepHealth(probes: HealthProbes) {
  const within = async (name: string, check: () => Promise<HealthCheck>): Promise<HealthCheck> => {
    try {
      return await Promise.race([
        check(),
        new Promise<HealthCheck>((resolve) =>
          setTimeout(
            () => resolve({ name, status: "down", detail: "No answer within 5 seconds." }),
            5000,
          ).unref(),
        ),
      ]);
    } catch (error) {
      return { name, status: "down", detail: scrub((error as Error).message).slice(0, 300) };
    }
  };

  const checks = await Promise.all([
    within("database", async () => {
      const { ms } = await timed(() => probes.store.users.count());
      return {
        name: "database",
        status: ms > 1000 ? "slow" : "ok",
        detail: `${probes.store.dialect}, answered in ${ms} ms`,
        ms,
      };
    }),
    within("disk", async () => {
      // The data folder, or where the server runs before it exists.
      const stats = await fs.statfs(probes.dataDir).catch(() => fs.statfs(process.cwd()));
      const free = (stats.bavail * stats.bsize) / (stats.blocks * stats.bsize);
      const freeGb = Math.round(((stats.bavail * stats.bsize) / 1024 ** 3) * 10) / 10;
      return {
        name: "disk",
        status: free < 0.05 ? "down" : free < 0.15 ? "slow" : "ok",
        detail: `${freeGb} GB free (${Math.round(free * 100)}%)`,
      };
    }),
    within("agent", async () => {
      const { value, ms } = await timed(() => probes.agent());
      return {
        name: "agent",
        status: value.status === "ok" ? (ms > 2000 ? "slow" : "ok") : "down",
        detail:
          value.status === "ok" ? `answered in ${ms} ms` : scrub(value.detail ?? value.status),
        ms,
      };
    }),
    within("runtime", async () => {
      const { value, ms } = await timed(() => probes.runtime());
      return {
        name: "runtime",
        status: value.ok ? "ok" : "down",
        detail: value.ok
          ? "apps can be built and previewed"
          : scrub(value.detail ?? "not available"),
        ms,
      };
    }),
    within("mail", async () =>
      (await probes.mailConfigured())
        ? { name: "mail", status: "ok", detail: "set up" }
        : { name: "mail", status: "off", detail: "not set up: no invitation or reset emails" },
    ),
    within("event_loop", async () => {
      const loop = probes.stats.loopDelayMs();
      return {
        name: "event_loop",
        status: loop.p99 > 200 ? "slow" : "ok",
        detail: `work waits ${loop.p50} ms typically, ${loop.p99} ms at worst (99%)`,
      };
    }),
    within("memory", async () => {
      const memory = process.memoryUsage();
      const usedMb = Math.round(memory.rss / 1024 / 1024);
      return { name: "memory", status: "ok", detail: `${usedMb} MB in use` };
    }),
    within("cleanup", async () => {
      const last = await probes.lastCleanup();
      const at = last?.finishedAt ?? last?.at;
      if (!at) return { name: "cleanup", status: "off", detail: "has not run yet" };
      const age = Date.now() - Date.parse(at);
      return {
        name: "cleanup",
        status: age > 3 * DAY_MS ? "slow" : "ok",
        detail: `idle clean-up last ran ${new Date(at).toISOString()}`,
      };
    }),
  ]);

  const worst = checks.some((check) => check.status === "down")
    ? "down"
    : checks.some((check) => check.status === "slow")
      ? "slow"
      : "ok";
  return {
    status: worst,
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - probes.stats.startedAt) / 1000),
    version: process.env.npm_package_version ?? "0.1.0",
    checks,
  };
}
