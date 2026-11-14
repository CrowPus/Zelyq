import {
  newId,
  type OpsAlertView,
  type OpsCheckKind,
  type OpsCheckView,
  type OpsStatusApp,
  type OpsStatusView,
  roleAtLeast,
} from "@zelyq/core";
import type { OpsAlertRow, OpsCheckRow, RunnerRow, Store } from "@zelyq/db";
import type { RunnerService } from "../../pipelines/runners.js";
import { SshSession } from "../../pipelines/ssh.js";
import { checkBlocks } from "../blocks.js";
import {
  CONTAINERS_SCRIPT,
  MACHINE_SCRIPT,
  type MachineFacts,
  type ProbeResult,
  probeAddress,
  probeCertificate,
  probeDomain,
  readMachine,
} from "./probes.js";

/**
 * The watch (072 §4, 075 Step 1): checks run on a timer by the server, with
 * no model and whatever the spending cap. Each team's checks are kept in step
 * with Zelyq's records; a failing check opens one alert, a passing one closes
 * it; urgent alerts nobody acknowledges go to the next person.
 */

const TICK_MS = 30_000;
const MINUTE = 60;
/** How often each kind runs, in seconds. */
const EVERY: Record<OpsCheckKind, number> = {
  address: MINUTE,
  speed: MINUTE,
  app: MINUTE,
  machine: 5 * MINUTE,
  certificate: 24 * 60 * MINUTE,
  domain: 24 * 60 * MINUTE,
  pipeline: 0,
};
/** How often each team's records are read again for what to watch. */
const SYNC_EVERY_MS = 5 * 60_000;
/** Teams checked side by side in one tick. */
const TEAMS_AT_ONCE = 4;
/** An urgent alert nobody acknowledged goes to the next person after this. */
export const ESCALATE_AFTER_MS = 15 * 60_000;
const SLOW_FOR_MS = 10 * 60_000;

export type WatchEvent =
  | { kind: "alert_opened"; teamId: string; alert: OpsAlertRow; to: string[] }
  | { kind: "alert_closed"; teamId: string; alert: OpsAlertRow; to: string[] }
  | { kind: "alert_escalated"; teamId: string; alert: OpsAlertRow; to: string[] };

interface Wanted {
  kind: OpsCheckKind;
  target: string;
  title: string;
  params: Record<string, unknown>;
}

const hourOf = (date: Date) => date.toISOString().slice(0, 13);
const realName = (host: string) =>
  !/^[\d.]+$/.test(host) && !host.includes(":") && host !== "localhost";

export class CheckService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Told of every alert that opens, closes or moves on (the mailer and channels listen). */
  events?: (event: WatchEvent) => void;

  constructor(
    private readonly store: Store,
    private readonly runners: Pick<RunnerService, "target">,
    private readonly probes = {
      probeAddress,
      probeCertificate,
      probeDomain,
      machine: machineFacts,
    },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over every team Ops watches. Never overlaps itself. */
  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const engineers = await this.store.ops.engineers.listAll();
      // A few teams at a time: one slow machine never holds up everyone else's checks.
      const queue = [...engineers];
      const worker = async () => {
        for (let engineer = queue.shift(); engineer; engineer = queue.shift()) {
          const teamId = engineer.teamId;
          // Checks and alerts keep going when Ops is paused or over its spending cap: they cost nothing.
          const last = this.synced.get(teamId) ?? 0;
          if (now.getTime() - last >= SYNC_EVERY_MS || now.getTime() < last) {
            await this.sync(teamId, now).catch(() => undefined);
          }
          await this.runDue(teamId, now).catch(() => undefined);
          await this.escalate(teamId, now).catch(() => undefined);
        }
      };
      await Promise.all(Array.from({ length: Math.min(TEAMS_AT_ONCE, queue.length) }, worker));
      if (now.getUTCMinutes() === 0) {
        await this.store.ops.checkHours.prune(hourOf(new Date(now.getTime() - 31 * 86_400_000)));
      }
    } finally {
      this.running = false;
    }
  }

  // ------------------------------------------------------------ what to watch

  /** What Zelyq's records say should be watched in a team. */
  async wanted(teamId: string): Promise<Wanted[]> {
    const environments = await this.store.deploy.environments.listForTeam(teamId);
    const runners = await this.store.pipelines.runners.listForTeam(teamId);
    const live = await this.store.deploy.deployments.live(environments.map((row) => row.id));
    const wanted: Wanted[] = [];
    const domains = new Map<string, { environment: string; machine: string }>();
    for (const deployment of live) {
      const environment = environments.find((row) => row.id === deployment.environmentId);
      if (!environment) continue;
      const where = `${deployment.app} on ${environment.name}`;
      const target = `${environment.name}/${deployment.app}`;
      const params = {
        environmentId: environment.id,
        app: deployment.app,
        // The container is found by this deployment's own label, whatever it is named.
        deploymentId: deployment.id,
        runnerId: environment.runnerId,
        url: deployment.url
          ? new URL(deployment.healthPath || "/", deployment.url).toString()
          : null,
      };
      if (deployment.url) {
        wanted.push({ kind: "address", target, title: `${where} answers`, params });
        wanted.push({
          kind: "speed",
          target,
          title: `${where} answers at its usual speed`,
          params,
        });
        const parsed = new URL(deployment.url);
        const host = parsed.hostname;
        const runner = runners.find((row) => row.id === environment.runnerId);
        // A certificate is checked only where the site is served over public HTTPS by name:
        // not for http, nor for certificates from Zelyq's own authority ("internal").
        const publicHttps =
          parsed.protocol === "https:" && ["auto", "external"].includes(environment.https);
        if (realName(host) && runner && publicHttps) {
          domains.set(host, {
            environment: environment.name,
            machine: environment.address ?? runner.host,
          });
        }
      }
      if (environment.runnerId)
        wanted.push({ kind: "app", target, title: `${where} is running`, params });
    }
    for (const runner of runners) {
      if (!environments.some((row) => row.runnerId === runner.id)) continue;
      wanted.push({
        kind: "machine",
        target: `machine:${runner.id}`,
        title: `${runner.name}: disk, memory and reachable`,
        params: { runnerId: runner.id },
      });
    }
    for (const [domain, where] of domains) {
      wanted.push({
        kind: "certificate",
        target: `domain:${domain}`,
        title: `${domain}: HTTPS certificate`,
        params: { domain },
      });
      wanted.push({
        kind: "domain",
        target: `domain:${domain}`,
        title: `${domain} is found in public DNS`,
        params: { domain, machine: where.machine },
      });
    }
    for (const pipeline of await this.store.pipelines.pipelines.listForTeam(teamId)) {
      let deploys = false;
      try {
        deploys = checkBlocks(pipeline.source).deploysTo.length > 0;
      } catch {
        deploys = false;
      }
      if (deploys) {
        wanted.push({
          kind: "pipeline",
          target: `pipeline:${pipeline.id}`,
          title: `Pipeline ${pipeline.name} ships without failing`,
          params: { pipelineId: pipeline.id },
        });
      }
    }
    // The same thing once (two live rows can exist for a moment while a deploy switches over).
    const seen = new Set<string>();
    return wanted.filter((want) => {
      const key = `${want.kind} ${want.target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** When each team's records were last read: they are read again every five minutes. */
  private readonly synced = new Map<string, number>();

  /** Keeps the team's checks in step with its records; a person's choices stay. */
  async sync(teamId: string, now = new Date()): Promise<void> {
    this.synced.set(teamId, now.getTime());
    const wanted = await this.wanted(teamId);
    const existing = await this.store.ops.checks.listForTeam(teamId);
    const at = now.toISOString();
    for (const want of wanted) {
      const found = existing.find((row) => row.kind === want.kind && row.target === want.target);
      if (!found) {
        await this.store.ops.checks.create({
          id: newId("opsCheck"),
          teamId,
          kind: want.kind,
          target: want.target,
          title: want.title,
          params: JSON.stringify(want.params),
          everySeconds: EVERY[want.kind],
          enabled: true,
          origin: "records",
          state: "unknown",
          failures: 0,
          failingSince: null,
          lastDetail: null,
          lastCheckedAt: null,
          normalMs: null,
          switchedOffBy: null,
          createdAt: at,
          updatedAt: at,
        });
      } else {
        const params = { ...(JSON.parse(found.params) as Record<string, unknown>), ...want.params };
        if (found.title !== want.title || JSON.stringify(params) !== found.params) {
          await this.store.ops.checks.update(found.id, {
            title: want.title,
            params: JSON.stringify(params),
            updatedAt: at,
          });
        }
      }
    }
    // What the records no longer have is no longer watched; its open alert closes.
    for (const row of existing) {
      if (row.origin !== "records") continue;
      if (wanted.some((want) => want.kind === row.kind && want.target === row.target)) continue;
      const open = await this.store.ops.alerts.openForCheck(row.id);
      if (open) await this.close(open, "no longer watched (it was removed)", now);
      await this.store.ops.checks.remove(row.id);
    }
  }

  // ------------------------------------------------------------ running checks

  private async runDue(teamId: string, now: Date): Promise<void> {
    const checks = (await this.store.ops.checks.listForTeam(teamId)).filter(
      (row) =>
        row.enabled &&
        row.everySeconds > 0 &&
        (!row.lastCheckedAt ||
          now.getTime() - new Date(row.lastCheckedAt).getTime() >=
            // After a miss, look again sooner: "down" is told within two minutes, not three.
            (row.failures > 0 ? Math.min(row.everySeconds, 30) : row.everySeconds) * 1000 - 2000),
    );
    if (checks.length === 0) return;
    // An app being deployed right now is not judged: its container is being replaced.
    const deploying = new Set(
      (await this.store.deploy.deployments.listByStatus("deploying")).map(
        (row) => `${row.environmentId}/${row.app}`,
      ),
    );
    const busy = (row: OpsCheckRow) => {
      const params = JSON.parse(row.params) as { environmentId?: string; app?: string };
      return deploying.has(`${params.environmentId}/${params.app}`);
    };

    // Machines: one visit each, asking only for what is due (containers each minute,
    // disk and memory every five).
    const parts = new Map<string, { machine: boolean; containers: boolean }>();
    for (const row of checks) {
      const params = JSON.parse(row.params) as { runnerId?: string | null };
      if (!params.runnerId || (row.kind !== "machine" && row.kind !== "app")) continue;
      const wanted = parts.get(params.runnerId) ?? { machine: false, containers: false };
      if (row.kind === "machine") wanted.machine = true;
      else if (!busy(row)) wanted.containers = true;
      parts.set(params.runnerId, wanted);
    }
    const visits = new Map<string, MachineFacts | Error>();
    await Promise.all(
      [...parts].map(async ([runnerId, wanted]) => {
        if (!wanted.machine && !wanted.containers) return;
        const runner = await this.store.pipelines.runners.findById(runnerId);
        if (!runner) return;
        visits.set(
          runnerId,
          await this.probes
            .machine(runner, this.runners, wanted)
            .catch((error: unknown) => error as Error),
        );
      }),
    );

    // Addresses: one request each, shared by the "answers" and "speed" checks.
    const answers = new Map<string, ProbeResult>();
    const urls = new Set<string>();
    for (const row of checks) {
      if (row.kind !== "address" && row.kind !== "speed") continue;
      const url = (JSON.parse(row.params) as { url?: string | null }).url;
      if (url && !busy(row)) urls.add(url);
    }
    await Promise.all(
      [...urls].map(async (url) => answers.set(url, await this.probes.probeAddress(url))),
    );

    for (const row of checks) {
      if (busy(row) && ["address", "speed", "app"].includes(row.kind)) continue;
      const params = JSON.parse(row.params) as Record<string, unknown>;
      let result: ProbeResult | null = null;
      if (row.kind === "address" || row.kind === "speed") {
        result = answers.get(String(params.url ?? "")) ?? null;
      } else if (row.kind === "app") {
        const visit = visits.get(String(params.runnerId ?? ""));
        result =
          visit instanceof Error || !visit
            ? null
            : appResult(
                visit,
                String(params.deploymentId ?? ""),
                `zelyq-${params.app}-${row.target.split("/")[0]}`,
              );
      } else if (row.kind === "machine") {
        const visit = visits.get(String(params.runnerId ?? ""));
        result =
          visit instanceof Error
            ? { ok: false, ms: 0, detail: `not reachable: ${visit.message}` }
            : visit
              ? machineResult(visit)
              : null;
      } else if (row.kind === "certificate") {
        result = await this.probes.probeCertificate(String(params.domain));
      } else if (row.kind === "domain") {
        result = await this.probes.probeDomain(String(params.domain), String(params.machine));
      }
      await this.record(row, result, now);
    }
  }

  /** A result: state, the hour's figures, the app's normal, and the alert it opens or closes. */
  async record(row: OpsCheckRow, result: ProbeResult | null, now: Date): Promise<void> {
    const at = now.toISOString();
    if (!result) {
      // Could not look (no machine, the visit failed for an app): unknown, never "ok".
      await this.store.ops.checks.update(row.id, {
        state: "unknown",
        lastCheckedAt: at,
        updatedAt: at,
      });
      return;
    }
    let failing = !result.ok;
    let detail = result.detail;
    const patch: Partial<OpsCheckRow> = { lastCheckedAt: at, updatedAt: at };

    if (row.kind === "speed") {
      // Judged against this app's own normal, and only after ten minutes of it.
      const normal = row.normalMs;
      if (!result.ok) {
        failing = false;
        detail = "no answer (the answers check covers it)";
      } else {
        failing = normal !== null && result.ms > Math.max(3 * normal, normal + 1000);
        // The normal learns only from answers close to it: a slow week never becomes "normal".
        if (normal === null || result.ms <= normal * 1.5) {
          patch.normalMs =
            normal === null ? result.ms : Math.round(normal * 0.95 + result.ms * 0.05);
        }
        detail =
          normal === null
            ? `${result.ms} ms (learning its normal)`
            : `${result.ms} ms (usually ${normal} ms)`;
      }
    }
    if (row.kind === "address" && result.ok) {
      patch.normalMs =
        row.normalMs === null ? result.ms : Math.round(row.normalMs * 0.95 + result.ms * 0.05);
    }

    patch.failures = failing ? row.failures + 1 : 0;
    patch.failingSince = failing ? (row.failingSince ?? at) : null;
    patch.lastDetail = detail;
    patch.state = failing ? "failing" : "ok";
    await this.store.ops.checks.update(row.id, patch);
    await this.store.ops.checkHours.record(row.id, hourOf(now), !failing, result.ms);

    const open = await this.store.ops.alerts.openForCheck(row.id);
    if (!failing) {
      if (open) await this.close(open, "back by itself", now);
      return;
    }
    if (open) return;
    // One problem, one alert: an app that is down fails "answers" and "running" together.
    if (row.target.includes("/") && (row.kind === "address" || row.kind === "app")) {
      const siblings = (await this.store.ops.checks.listForTeam(row.teamId)).filter(
        (other) =>
          other.id !== row.id &&
          other.target === row.target &&
          ["address", "app"].includes(other.kind),
      );
      for (const other of siblings) {
        if (await this.store.ops.alerts.openForCheck(other.id)) return;
      }
    }
    const since = new Date(patch.failingSince as string).getTime();
    const due =
      row.kind === "speed"
        ? now.getTime() - since >= SLOW_FOR_MS
        : row.kind === "address" || row.kind === "machine" || row.kind === "app"
          ? (patch.failures ?? 0) >= 2
          : true;
    if (due) await this.open(row, detail, now);
  }

  /** A pipeline run ended (the engine reports it): a deploying pipeline that failed is an alert. */
  async runFinished(
    teamId: string,
    pipelineId: string,
    status: string,
    label: string,
    now = new Date(),
  ): Promise<void> {
    const check = (await this.store.ops.checks.listForTeam(teamId)).find(
      (row) => row.kind === "pipeline" && row.target === `pipeline:${pipelineId}` && row.enabled,
    );
    if (!check) return;
    const ok = status === "passed";
    if (!["passed", "failed", "timed_out"].includes(status)) return;
    await this.record(check, { ok, ms: 0, detail: `${label} ${status}` }, now);
  }

  // ------------------------------------------------------------ alerts

  private severityOf(row: OpsCheckRow, detail: string): "urgent" | "warning" {
    if (row.kind === "speed" || row.kind === "domain") return "warning";
    if (row.kind === "certificate") {
      // Expired, or about to: urgent. Could not be reached or read: a warning to look at.
      if (/expired/i.test(detail)) return "urgent";
      const days = /(-?\d+) days left/.exec(detail)?.[1];
      return days !== undefined && Number(days) < 3 ? "urgent" : "warning";
    }
    if (row.kind === "machine" && !detail.startsWith("not reachable")) {
      return /disk (9[5-9]|100)%/.test(detail) ? "urgent" : "warning";
    }
    return "urgent";
  }

  private async open(row: OpsCheckRow, detail: string, now: Date): Promise<void> {
    const alert: OpsAlertRow = {
      id: newId("opsAlert"),
      teamId: row.teamId,
      checkId: row.id,
      severity: this.severityOf(row, detail),
      title: alertTitle(row),
      detail: detail.slice(0, 500),
      openedAt: now.toISOString(),
      closedAt: null,
      closedHow: null,
      acknowledgedBy: null,
      acknowledgedAt: null,
      silencedUntil: null,
      silencedBy: null,
      escalation: 0,
      notifiedAt: now.toISOString(),
    };
    await this.store.ops.alerts.create(alert);
    this.events?.({
      kind: "alert_opened",
      teamId: row.teamId,
      alert,
      to: await this.peopleAt(row.teamId, 0),
    });
  }

  private async close(alert: OpsAlertRow, how: string, now: Date): Promise<void> {
    await this.store.ops.alerts.update(alert.id, { closedAt: now.toISOString(), closedHow: how });
    const closed = { ...alert, closedAt: now.toISOString(), closedHow: how };
    // Everyone who was told it opened hears that it ended.
    const told = new Set<string>();
    for (let level = 0; level <= alert.escalation; level += 1) {
      for (const person of await this.peopleAt(alert.teamId, level)) told.add(person);
    }
    if (!alert.silencedUntil || new Date(alert.silencedUntil) <= now) {
      this.events?.({ kind: "alert_closed", teamId: alert.teamId, alert: closed, to: [...told] });
    }
  }

  /** The people an alert goes to at a level: the first admin, then the next, and so on. */
  async peopleAt(teamId: string, level: number): Promise<string[]> {
    const members = (await this.store.teams.listMembers(teamId))
      .filter((member) => roleAtLeast(member.role, "admin"))
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
    const person = members[Math.min(level, members.length - 1)];
    return person ? [person.userId] : [];
  }

  /** Urgent alerts nobody acknowledged move to the next person; silence holds them. */
  private async escalate(teamId: string, now: Date): Promise<void> {
    const members = (await this.store.teams.listMembers(teamId)).filter((member) =>
      roleAtLeast(member.role, "admin"),
    );
    for (const alert of await this.store.ops.alerts.listOpen(teamId)) {
      if (alert.severity !== "urgent" || alert.acknowledgedAt) continue;
      if (alert.silencedUntil && new Date(alert.silencedUntil) > now) continue;
      if (alert.escalation >= members.length - 1) continue;
      const since = new Date(alert.notifiedAt ?? alert.openedAt).getTime();
      if (now.getTime() - since < ESCALATE_AFTER_MS) continue;
      const escalation = alert.escalation + 1;
      await this.store.ops.alerts.update(alert.id, { escalation, notifiedAt: now.toISOString() });
      this.events?.({
        kind: "alert_escalated",
        teamId,
        alert: { ...alert, escalation },
        to: await this.peopleAt(teamId, escalation),
      });
    }
  }

  // ------------------------------------------------------------ the status view

  async status(teamId: string, now = new Date()): Promise<OpsStatusView> {
    const checks = (await this.store.ops.checks.listForTeam(teamId)).filter(
      (row) => row.enabled || row.origin,
    );
    const hours = await this.store.ops.checkHours.listSince(
      checks.map((row) => row.id),
      hourOf(new Date(now.getTime() - 30 * 86_400_000)),
    );
    const uptime = (ids: string[]) => {
      let runs = 0;
      let passed = 0;
      for (const hour of hours) {
        if (!ids.includes(hour.checkId)) continue;
        runs += hour.runs;
        passed += hour.passed;
      }
      return runs ? Math.round((passed / runs) * 10_000) / 100 : null;
    };
    const view = (row: OpsCheckRow): OpsCheckView => ({
      id: row.id,
      kind: row.kind as OpsCheckKind,
      title: row.title,
      target: row.target,
      enabled: row.enabled,
      state: row.state as OpsCheckView["state"],
      lastDetail: row.lastDetail,
      lastCheckedAt: row.lastCheckedAt,
      normalMs: row.normalMs,
      uptime30d: uptime([row.id]),
    });
    const alertView = (row: OpsAlertRow): OpsAlertView => ({
      id: row.id,
      severity: row.severity as OpsAlertView["severity"],
      title: row.title,
      detail: row.detail,
      openedAt: row.openedAt,
      closedAt: row.closedAt,
      closedHow: row.closedHow,
      acknowledgedBy: row.acknowledgedBy,
      acknowledgedAt: row.acknowledgedAt,
      silencedUntil: row.silencedUntil,
      escalation: row.escalation,
    });
    const byApp = new Map<string, OpsCheckRow[]>();
    for (const row of checks) {
      if (!row.target.includes("/") || !["address", "speed", "app"].includes(row.kind)) continue;
      byApp.set(row.target, [...(byApp.get(row.target) ?? []), row]);
    }
    const apps: OpsStatusApp[] = [...byApp.entries()].map(([target, rows]) => {
      const [environment, app] = target.split("/") as [string, string];
      const live = rows.filter((row) => row.enabled);
      const down = live.some((row) => row.kind !== "speed" && row.state === "failing");
      const slow = live.some((row) => row.kind === "speed" && row.state === "failing");
      const unknown = live.every((row) => row.state === "unknown");
      const address = rows.find((row) => row.kind === "address");
      const params = JSON.parse((address ?? rows[0])?.params ?? "{}") as { url?: string | null };
      return {
        app,
        environment,
        url: params.url ?? null,
        light: down ? "red" : slow ? "amber" : unknown ? "grey" : "green",
        uptime30d: uptime(rows.filter((row) => row.kind !== "speed").map((row) => row.id)),
        normalMs: address?.normalMs ?? null,
        checks: rows.map(view),
      };
    });
    const alerts = await this.store.ops.alerts.listForTeam(teamId, 30);
    return {
      apps,
      machines: checks.filter((row) => row.kind === "machine").map(view),
      other: checks
        .filter((row) => ["certificate", "domain", "pipeline"].includes(row.kind))
        .map(view),
      open: alerts.filter((row) => !row.closedAt).map(alertView),
      recent: alerts
        .filter((row) => row.closedAt)
        .slice(0, 10)
        .map(alertView),
      watchedFromTwoPlaces: false,
    };
  }

  /** A person switches a check on or off (Ops never switches one off). */
  async setEnabled(
    checkId: string,
    teamId: string,
    enabled: boolean,
    userId: string,
  ): Promise<void> {
    const check = await this.store.ops.checks.findById(checkId);
    if (!check || check.teamId !== teamId) throw new Error("No such check.");
    const at = new Date().toISOString();
    await this.store.ops.checks.update(checkId, {
      enabled,
      switchedOffBy: enabled ? null : userId,
      state: enabled ? "unknown" : check.state,
      // Switched back on, it starts again: old misses do not count.
      ...(enabled ? { failures: 0, failingSince: null } : {}),
      updatedAt: at,
    });
    if (!enabled) {
      const open = await this.store.ops.alerts.openForCheck(checkId);
      if (open) await this.close(open, "the check was switched off by a person", new Date());
    }
  }

  /** A person says "I'm on it": it stops moving on. */
  async acknowledge(alertId: string, userId: string, now = new Date()): Promise<OpsAlertRow> {
    const alert = await this.store.ops.alerts.findById(alertId);
    if (!alert) throw new Error("No such alert.");
    await this.store.ops.alerts.update(alertId, {
      acknowledgedBy: userId,
      acknowledgedAt: now.toISOString(),
    });
    return { ...alert, acknowledgedBy: userId, acknowledgedAt: now.toISOString() };
  }

  /** Planned work: no messages for a while; it resumes by itself. */
  async silence(
    alertId: string,
    userId: string,
    minutes: number,
    now = new Date(),
  ): Promise<OpsAlertRow> {
    const alert = await this.store.ops.alerts.findById(alertId);
    if (!alert) throw new Error("No such alert.");
    const until = new Date(now.getTime() + minutes * 60_000).toISOString();
    // The wait before it moves on starts again when the silence ends.
    await this.store.ops.alerts.update(alertId, {
      silencedUntil: until,
      silencedBy: userId,
      notifiedAt: until,
    });
    return { ...alert, silencedUntil: until, silencedBy: userId, notifiedAt: until };
  }
}

function alertTitle(row: OpsCheckRow): string {
  const params = JSON.parse(row.params) as { app?: string; domain?: string };
  const where = row.target.includes("/") ? `${params.app} on ${row.target.split("/")[0]}` : "";
  switch (row.kind) {
    case "address":
      return `${where} does not answer`;
    case "speed":
      return `${where} is much slower than usual`;
    case "app":
      return `${where} is not running properly`;
    case "machine":
      return row.title.replace(": disk, memory and reachable", " needs attention");
    case "certificate":
      return `${params.domain}: the HTTPS certificate needs attention`;
    case "domain":
      return `${params.domain} no longer leads to its machine`;
    case "pipeline":
      return row.title.replace(" ships without failing", " failed");
    default:
      return row.title;
  }
}

/** A container's state as a check result: running, and not restarting again and again. */
export function appResult(visit: MachineFacts, deploymentId: string, name: string): ProbeResult {
  // The container of this deployment (by its label), whatever it is named; else by the old name.
  const container =
    [...visit.containers.values()].find(
      (row) => deploymentId && row.deployment === deploymentId && !row.process,
    ) ?? visit.containers.get(name);
  if (!container) return { ok: false, ms: 0, detail: "its container is not on the machine" };
  if (container.state !== "running")
    return { ok: false, ms: 0, detail: `its container is ${container.state}` };
  return { ok: true, ms: 0, detail: "running" };
}

/** A machine's figures as a check result. */
export function machineResult(visit: MachineFacts): ProbeResult {
  const problems: string[] = [];
  const disk = Math.max(visit.diskPct ?? 0, visit.dockerDiskPct ?? 0);
  if (disk > 85) problems.push(`disk ${disk}% full`);
  if (visit.memAvailablePct !== null && visit.memAvailablePct < 5) {
    problems.push(`memory almost gone (${visit.memAvailablePct}% free)`);
  }
  const figures = `disk ${disk}%, memory ${visit.memAvailablePct ?? "?"}% free, load ${visit.load ?? "?"} on ${visit.cpus ?? "?"} processors`;
  return problems.length
    ? { ok: false, ms: 0, detail: `${problems.join("; ")} (${figures})` }
    : { ok: true, ms: 0, detail: figures };
}

/** One visit to a machine: the fixed script over SSH. */
export async function machineFacts(
  runner: RunnerRow,
  runners: Pick<RunnerService, "target">,
  parts: { machine: boolean; containers: boolean } = { machine: true, containers: true },
): Promise<MachineFacts> {
  const session = await SshSession.open(await runners.target(runner));
  try {
    const script = `${parts.machine ? MACHINE_SCRIPT : ""}${parts.containers ? CONTAINERS_SCRIPT : ""}\nexit 0\n`;
    const result = await session.capture("sh -s", 20_000, script);
    return readMachine(result.stdout);
  } finally {
    session.close();
  }
}
