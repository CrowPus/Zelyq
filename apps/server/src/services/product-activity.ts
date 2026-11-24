import {
  type AuditAction,
  cleanProductDetail,
  newId,
  PRODUCT_FEATURES,
  type ProductEvent,
  type ProductEventName,
  type ProductFeature,
  productEventNameSchema,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { UsageService } from "./usage.js";

export interface ActivityContext {
  userId?: string | null;
  teamId?: string | null;
  projectId?: string | null;
  detail?: Record<string, unknown>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** What some audit actions mean as product activity: recorded where they already are. */
const FROM_AUDIT: Partial<
  Record<AuditAction, { name: ProductEventName; detail?: Record<string, string> }>
> = {
  "project.created": { name: "app.created" },
  "project.deleted": { name: "app.deleted" },
  "team.member_added": { name: "member.joined" },
  "team.member_invited": { name: "member.invited" },
  "vault.secret.created": { name: "feature.used", detail: { feature: "vault" } },
  "pipeline.created": { name: "feature.used", detail: { feature: "pipelines" } },
  "environment.created": { name: "feature.used", detail: { feature: "deploy_environments" } },
  "agent.created": { name: "feature.used", detail: { feature: "outside_agents" } },
  "ops.set_up": { name: "feature.used", detail: { feature: "ops" } },
  "ops.job_started": { name: "feature.used", detail: { feature: "ops" } },
  "project.pushed": { name: "feature.used", detail: { feature: "git" } },
  "provider.connected": { name: "feature.used", detail: { feature: "supabase" } },
};

/**
 * Product activity: recording what people do, and the numbers worked out
 * from it (active people, the activation funnel, retention, feature use).
 *
 * Recording never slows down or fails what is being recorded: it is fire and
 * forget, and a failure is logged, not thrown. `ZELYQ_PRODUCT_EVENTS=off`
 * turns it off; the data never leaves this server by itself.
 */
export class ProductActivity {
  private readonly pending = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  usage?: UsageService;
  /** Told about each event recorded (events to an account service). */
  onRecorded?: (event: ProductEvent) => void;
  /** Marks a team (and the person) as used: see TeamStatusService.touch. */
  touch?: (teamId: string | null, userId: string) => Promise<void>;

  constructor(
    private readonly store: Store,
    private readonly options: {
      enabled: boolean;
      /** Rows older than this are folded into daily totals. */
      keepMonths: number;
      log?: (error: unknown, message: string) => void;
    },
  ) {}

  record(name: ProductEventName, context: ActivityContext = {}): void {
    if (!this.options.enabled) return;
    const work = this.write(name, context).catch((error) =>
      this.options.log?.(error, `could not record product activity ${name}`),
    );
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }

  /** An audit entry that also counts as product activity. */
  fromAudit(
    action: AuditAction,
    entry: {
      userId: string | null;
      teamId: string | null;
      projectId?: string | null;
      detail?: Record<string, unknown>;
    },
  ): void {
    const mapped = FROM_AUDIT[action];
    if (!mapped) return;
    this.record(mapped.name, {
      userId: entry.userId,
      teamId: entry.teamId,
      projectId: entry.projectId ?? null,
      detail: { ...entry.detail, ...mapped.detail },
    });
  }

  feature(feature: ProductFeature, context: ActivityContext): void {
    this.record("feature.used", { ...context, detail: { feature } });
  }

  /** Every recording started so far has been written (for tests and shutdown). */
  async settled(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private async write(name: ProductEventName, context: ActivityContext): Promise<void> {
    let teamId = context.teamId ?? null;
    if (!teamId && context.projectId) {
      teamId = (await this.store.projects.findById(context.projectId))?.teamId ?? null;
    }
    const event = {
      id: newId("productEvent"),
      name,
      userId: context.userId ?? null,
      teamId,
      projectId: context.projectId ?? null,
      detail: cleanProductDetail(name, context.detail),
      createdAt: new Date().toISOString(),
    };
    await this.store.productEvents.record(event);
    this.onRecorded?.(event);
    // Something a person did: the team was used, and the person was here.
    if (context.userId) await this.touch?.(teamId, context.userId);
  }

  // ------------------------------------------------------------------ keeping

  /** Once a day: fold rows older than the kept months into daily totals. */
  start(): void {
    if (this.timer || !this.options.enabled) return;
    const run = () =>
      void this.fold().catch((error) =>
        this.options.log?.(error, "could not fold product activity"),
      );
    this.timer = setInterval(run, DAY_MS);
    this.timer.unref();
    setTimeout(run, 60_000).unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async fold(now = new Date()): Promise<number> {
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - this.options.keepMonths);
    return await this.store.productEvents.foldBefore(cutoff.toISOString().slice(0, 10));
  }

  // ------------------------------------------------------------------ numbers

  /** `from`/`to` from a query: dates or times; by default the last 30 days. */
  range(query: { from?: string; to?: string }, defaultDays = 30): { from: string; to: string } {
    const parse = (value: string | undefined, fallback: Date) => {
      if (!value) return fallback;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw ZelyqError.badRequest(`Not a date: ${value}`);
      return date;
    };
    const to = parse(query.to, new Date());
    const from = parse(query.from, new Date(to.getTime() - defaultDays * DAY_MS));
    if (from >= to) throw ZelyqError.badRequest("`from` must be before `to`.");
    if (to.getTime() - from.getTime() > 800 * DAY_MS) {
      throw ZelyqError.badRequest("Ask for at most 800 days at a time.");
    }
    return { from: from.toISOString(), to: to.toISOString() };
  }

  async events(query: {
    from?: string;
    to?: string;
    name?: string;
    team?: string;
    user?: string;
    cursor?: string;
    limit?: string;
  }) {
    const { from, to } = this.range(query);
    if (query.name && !productEventNameSchema.safeParse(query.name).success) {
      throw ZelyqError.badRequest(`Not an event: ${query.name}`);
    }
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "500", 10) || 500, 1), 2000);
    const after = query.cursor ? await this.store.productEvents.findById(query.cursor) : null;
    if (query.cursor && !after) throw ZelyqError.badRequest("That cursor is not an event here.");
    const events = await this.store.productEvents.list({
      from,
      to,
      name: query.name,
      teamId: query.team,
      userId: query.user,
      after,
      limit,
    });
    return { events, nextCursor: events.length === limit ? events.at(-1)!.id : null };
  }

  /** Per day: sign-ups, active people and teams, and the main things done. */
  async overview(query: { from?: string; to?: string }) {
    const { from, to } = this.range(query);
    const daily = await this.store.productEvents.daily(from, to);
    const active = await this.store.productEvents.activeByDay(from, to);
    const failed = await this.failuresByDay(from, to);
    const older = await this.store.productEvents.listDaily(from, to);

    const days = new Map<string, Record<string, number>>();
    const row = (day: string) => {
      let entry = days.get(day);
      if (!entry) {
        entry = {
          signups: 0,
          activePeople: 0,
          activeTeams: 0,
          appsCreated: 0,
          agentMessages: 0,
          builds: 0,
          buildsFailed: 0,
          previews: 0,
          deploys: 0,
          deploysFailed: 0,
          pipelineRuns: 0,
          limitsReached: 0,
        };
        days.set(day, entry);
      }
      return entry;
    };
    const key: Partial<Record<string, string>> = {
      "account.created": "signups",
      "app.created": "appsCreated",
      "agent.message": "agentMessages",
      "agent.build_finished": "builds",
      "preview.started": "previews",
      "deploy.finished": "deploys",
      "pipeline.run_finished": "pipelineRuns",
      "limit.reached": "limitsReached",
    };
    for (const count of [...older, ...daily]) {
      const field = key[count.name];
      if (field) row(count.day)[field]! += count.count;
    }
    for (const entry of active) {
      row(entry.day).activePeople = entry.people;
      row(entry.day).activeTeams = entry.teams;
    }
    for (const entry of failed) {
      const field = entry.name === "deploy.finished" ? "deploysFailed" : "buildsFailed";
      row(entry.day)[field]! += entry.count;
    }

    const list = [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, values]) => ({ day, ...values }));
    const totals: Record<string, number> = {};
    for (const values of days.values()) {
      for (const [name, value] of Object.entries(values)) {
        if (name !== "activePeople" && name !== "activeTeams") {
          totals[name] = (totals[name] ?? 0) + value;
        }
      }
    }
    const end = new Date(to).getTime();
    const window = async (days: number) =>
      await this.store.productEvents.active(new Date(end - days * DAY_MS).toISOString(), to);
    return {
      from,
      to,
      days: list,
      totals: { ...totals, ...(await this.store.productEvents.active(from, to)) },
      daily: await window(1),
      weekly: await window(7),
      monthly: await window(30),
    };
  }

  /**
   * Activation: of the people who signed up in the range, how many teams went
   * on to each step (at any time since), and how many stopped before it.
   */
  async funnel(query: { from?: string; to?: string }) {
    const { from, to } = this.range(query);
    const signups = await this.store.productEvents.who(from, to, ["account.created"]);
    const cohort = new Set(signups.map((entry) => entry.teamId).filter(Boolean) as string[]);
    const later = await this.store.productEvents.who(from, new Date().toISOString(), [
      "app.created",
      "agent.build_finished",
      "preview.started",
      "deploy.finished",
      "member.invited",
    ]);
    const reached = (name: string) =>
      new Set(
        later
          .filter((entry) => entry.name === name && entry.teamId && cohort.has(entry.teamId))
          .map((entry) => entry.teamId),
      ).size;
    const steps = [
      { step: "signed_up", label: "Signed up", teams: cohort.size },
      { step: "first_app", label: "Made an app", teams: reached("app.created") },
      {
        step: "first_build",
        label: "Agent built something",
        teams: reached("agent.build_finished"),
      },
      { step: "first_preview", label: "Opened a preview", teams: reached("preview.started") },
      { step: "first_deploy", label: "Deployed", teams: reached("deploy.finished") },
      { step: "invited", label: "Invited someone", teams: reached("member.invited") },
    ];
    return {
      from,
      to,
      steps: steps.map((step) => ({
        ...step,
        share: cohort.size ? Math.round((step.teams / cohort.size) * 1000) / 10 : 0,
      })),
    };
  }

  /**
   * Of the people who signed up in each of the last `weeks` weeks, the share
   * who did anything 1, 2, … weeks after signing up. A week not over yet is null.
   */
  async retention(query: { weeks?: string }) {
    const weeks = Math.min(Math.max(Number.parseInt(query.weeks ?? "8", 10) || 8, 1), 26);
    const now = Date.now();
    const from = new Date(now - weeks * 7 * DAY_MS).toISOString();
    const signups = await this.store.productEvents.who(from, new Date(now).toISOString(), [
      "account.created",
    ]);
    const activity = await this.store.productEvents.who(from, new Date(now).toISOString());
    const daysActive = new Map<string, Set<string>>();
    for (const entry of activity) {
      if (!entry.userId) continue;
      const set = daysActive.get(entry.userId) ?? new Set<string>();
      set.add(entry.day);
      daysActive.set(entry.userId, set);
    }
    const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
    const cohorts = new Map<string, Array<{ userId: string; joined: number }>>();
    for (const signup of signups) {
      if (!signup.userId) continue;
      const joined = dayMs(signup.day);
      const index = Math.floor((now - joined) / (7 * DAY_MS));
      const week = new Date(now - (index + 1) * 7 * DAY_MS).toISOString().slice(0, 10);
      const list = cohorts.get(week) ?? [];
      list.push({ userId: signup.userId, joined });
      cohorts.set(week, list);
    }
    return {
      weeks,
      cohorts: [...cohorts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week, people]) => ({
          week,
          people: people.length,
          returned: Array.from({ length: weeks }, (_, offset) => {
            const k = offset + 1;
            const ended = people.every((person) => person.joined + (k + 1) * 7 * DAY_MS <= now);
            if (!ended) return null;
            const back = people.filter((person) =>
              [...(daysActive.get(person.userId) ?? [])].some((day) => {
                const at = dayMs(day);
                return (
                  at >= person.joined + k * 7 * DAY_MS && at < person.joined + (k + 1) * 7 * DAY_MS
                );
              }),
            ).length;
            return Math.round((back / people.length) * 1000) / 10;
          }),
        })),
    };
  }

  /** How much each feature is used, by how many teams, and on which plans. */
  async features(query: { from?: string; to?: string }) {
    const { from, to } = this.range(query);
    const rows = await this.store.productEvents.byDetail("feature.used", "feature", from, to);
    const plans = await this.plansOf(rows.map((row) => row.teamId));
    return {
      from,
      to,
      features: PRODUCT_FEATURES.map((feature) => {
        const mine = rows.filter((row) => row.value === feature);
        const byPlan: Record<string, number> = {};
        for (const row of mine) {
          const plan = row.teamId ? (plans.get(row.teamId) ?? "unknown") : "unknown";
          byPlan[plan] = (byPlan[plan] ?? 0) + row.count;
        }
        return {
          feature,
          uses: mine.reduce((sum, row) => sum + row.count, 0),
          teams: new Set(mine.map((row) => row.teamId).filter(Boolean)).size,
          byPlan,
        };
      }),
    };
  }

  /** Teams per plan, teams close to a limit, and which limits stopped people. */
  async plans(query: { from?: string; to?: string }) {
    const { from, to } = this.range(query);
    const usage = this.usage;
    if (!usage) throw new ZelyqError("internal", "Plans are not available.");
    const perPlan: Record<string, number> = {};
    const nearLimit: Array<{ teamId: string; plan: string; limits: string[] }> = [];
    for (const team of await this.store.teams.listAll()) {
      const used = await usage.usage(team.id);
      perPlan[used.plan.id] = (perPlan[used.plan.id] ?? 0) + 1;
      const near = used.lines
        // Runs at once only means busy: past it, runs wait rather than being refused.
        .filter(
          (line) =>
            line.key !== "runsAtOnce" &&
            line.limit !== null &&
            line.limit > 0 &&
            line.used >= line.limit * 0.8,
        )
        .map((line) => line.key);
      if (near.length) nearLimit.push({ teamId: team.id, plan: used.plan.id, limits: near });
    }
    const hits = await this.store.productEvents.byDetail("limit.reached", "limit", from, to);
    const limitsReached: Record<string, { times: number; teams: number }> = {};
    for (const hit of hits) {
      const entry = limitsReached[hit.value] ?? { times: 0, teams: 0 };
      entry.times += hit.count;
      entry.teams += 1;
      limitsReached[hit.value] = entry;
    }
    return { from, to, teamsPerPlan: perPlan, nearLimit, limitsReached };
  }

  /** Every event of one kind in a range (detail included), for failure and timing reports. */
  private async all(name: ProductEventName, from: string, to: string) {
    return await this.store.productEvents.list({ from, to, name, limit: 200_000 });
  }

  /**
   * Why agent work failed, by reason and AI provider. Customers bring their
   * own keys: a wave of `no_key` or a provider's errors is a sign for better
   * help text, not an outage of ours.
   */
  async agentFailures(query: { from?: string; to?: string }) {
    const { from, to } = this.range(query, 7);
    const builds = await this.all("agent.build_finished", from, to);
    const failed = builds.filter((build) => build.detail.ok === false);
    const byReason: Record<string, number> = {};
    const byProvider: Record<string, { builds: number; failed: number }> = {};
    for (const build of builds) {
      const provider = String(build.detail.provider ?? "unknown");
      const entry = byProvider[provider] ?? { builds: 0, failed: 0 };
      entry.builds += 1;
      if (build.detail.ok === false) {
        entry.failed += 1;
        const reason = String(build.detail.reason ?? "unknown");
        byReason[reason] = (byReason[reason] ?? 0) + 1;
      }
      byProvider[provider] = entry;
    }
    return {
      from,
      to,
      builds: builds.length,
      failed: failed.length,
      failureRate: builds.length ? Math.round((failed.length / builds.length) * 1000) / 10 : 0,
      byReason,
      byProvider,
      teamsHit: new Set(failed.map((build) => build.teamId).filter(Boolean)).size,
    };
  }

  /** Failed previews (by reason), pipeline runs (by how they ended) and deploys. */
  async buildFailures(query: { from?: string; to?: string }) {
    const { from, to } = this.range(query, 7);
    const count = (values: string[]) => {
      const counts: Record<string, number> = {};
      for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    };
    const previewsOk = await this.all("preview.started", from, to);
    const previewsFailed = await this.all("preview.failed", from, to);
    const runs = await this.all("pipeline.run_finished", from, to);
    const deploys = await this.all("deploy.finished", from, to);
    const failedRuns = runs.filter((run) => run.detail.ok === false);
    const failedDeploys = deploys.filter((deploy) => deploy.detail.ok === false);
    return {
      from,
      to,
      previews: {
        started: previewsOk.length,
        failed: previewsFailed.length,
        byReason: count(previewsFailed.map((event) => String(event.detail.reason ?? "unknown"))),
      },
      pipelineRuns: {
        finished: runs.length,
        failed: failedRuns.length,
        byStatus: count(failedRuns.map((event) => String(event.detail.status ?? "unknown"))),
      },
      deploys: {
        finished: deploys.length,
        failed: failedDeploys.length,
        byKind: count(failedDeploys.map((event) => String(event.detail.kind ?? "unknown"))),
      },
    };
  }

  /** How long the main work takes: typical (p50) and slow (p95) seconds. */
  async timings(query: { from?: string; to?: string }) {
    const { from, to } = this.range(query, 7);
    const spread = (values: number[]) => {
      const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
      const at = (share: number) =>
        sorted.length
          ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]!
          : null;
      return { samples: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? null };
    };
    const seconds = (events: Array<{ detail: Record<string, unknown> }>) =>
      events.map((event) => Number(event.detail.seconds));
    const builds = (await this.all("agent.build_finished", from, to)).filter(
      (build) => build.detail.ok === true,
    );
    return {
      from,
      to,
      agentTurnSeconds: spread(seconds(builds)),
      previewStartSeconds: spread(seconds(await this.all("preview.started", from, to))),
      pipelineRunSeconds: spread(seconds(await this.all("pipeline.run_finished", from, to))),
    };
  }

  private async failuresByDay(from: string, to: string) {
    return await this.store.productEvents.failuresByDay(from, to);
  }

  private async plansOf(teamIds: Array<string | null>): Promise<Map<string, string>> {
    const plans = new Map<string, string>();
    for (const teamId of new Set(teamIds)) {
      if (!teamId || !this.usage) continue;
      plans.set(teamId, (await this.usage.planOf(teamId)).id);
    }
    return plans;
  }
}
