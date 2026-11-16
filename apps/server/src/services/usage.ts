import fs from "node:fs/promises";
import path from "node:path";
import {
  PLAN_LIMIT_KEYS,
  PLAN_LIMITS,
  type Plan,
  type PlanLimitKey,
  type PlansSettings,
  parsePipelineFile,
  pipelineTarget,
  plansSettingsSchema,
  type TeamUsage,
  UNLIMITED_PLAN,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";

/**
 * What each team uses, and what its plan allows.
 *
 * Storage counts what a team made and could not get back: its apps' own
 * files and history, undo points, Studio's images and videos, chat
 * attachments and pipeline files. Installed packages and build output are
 * left out: they are most of an app's size on disk and Zelyq can always
 * reinstall them, so counting them would charge people for nothing they did.
 *
 * Files are measured in the background (every few minutes, and when asked);
 * everything else is counted when asked. A limit only stops something new:
 * nothing that exists is ever broken or deleted for being over.
 */

/** Rebuilt by an install or a build: never the person's own work. */
const REINSTALLABLE = new Set([
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".parcel-cache",
  ".cache",
  ".expo",
  ".gradle",
  "dist",
  "build",
  "target",
]);

const PLANS_KEY = "plans";
const MEASURE_EVERY_MS = 15 * 60_000;
const MB = 1024 * 1024;

/** Bytes under a folder; hard links once, links never followed. */
export async function folderBytes(root: string, skipReinstallable: boolean): Promise<number> {
  const seen = new Set<string>();
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipReinstallable && REINSTALLABLE.has(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.lstat(full).catch(() => null);
      if (!stat) continue;
      if (stat.nlink > 1) {
        const id = `${stat.dev}:${stat.ino}`;
        if (seen.has(id)) continue;
        seen.add(id);
      }
      total += stat.size;
    }
  }
  return total;
}

interface Measured {
  apps: number;
  undoPoints: number;
  attachments: number;
  at: string;
}

export interface UsagePaths {
  /** Where each app's files are: <workspace>/<projectId>; undo points under .snapshots. */
  workspaceDir: string | null;
  attachmentsDir: string;
}

export class UsageService {
  private readonly measured = new Map<string, Measured>();
  private readonly measuring = new Map<string, Promise<Measured>>();
  private timer: NodeJS.Timeout | null = null;
  /** Whether an app's preview is running (set by the app: the runtime knows). */
  previewRunning?: (projectId: string) => Promise<boolean>;

  constructor(
    private readonly store: Store,
    private readonly paths: UsagePaths,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.measureAll(), MEASURE_EVERY_MS);
    this.timer.unref();
    void this.measureAll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------------ plans

  async plans(): Promise<PlansSettings> {
    const stored = await this.store.settings.get(PLANS_KEY);
    if (stored) {
      try {
        return plansSettingsSchema.parse(JSON.parse(stored));
      } catch {
        // A broken value is no plans, never a locked server.
      }
    }
    return { plans: [], defaultPlan: UNLIMITED_PLAN.id };
  }

  /** Every plan, Unlimited always among them. */
  async allPlans(): Promise<Plan[]> {
    const { plans } = await this.plans();
    return [UNLIMITED_PLAN, ...plans.filter((plan) => plan.id !== UNLIMITED_PLAN.id)];
  }

  async savePlans(raw: unknown): Promise<PlansSettings> {
    const input = plansSettingsSchema.parse(raw);
    const ids = new Set([UNLIMITED_PLAN.id]);
    for (const plan of input.plans) {
      if (ids.has(plan.id)) throw ZelyqError.badRequest(`Two plans are called ${plan.id}.`);
      ids.add(plan.id);
    }
    if (!ids.has(input.defaultPlan)) {
      throw ZelyqError.badRequest("The plan for new teams must be one of the plans.");
    }
    const clean = {
      plans: input.plans.filter((plan) => plan.id !== UNLIMITED_PLAN.id),
      defaultPlan: input.defaultPlan,
    };
    await this.store.settings.set(PLANS_KEY, JSON.stringify(clean));
    return clean;
  }

  async planOf(teamId: string): Promise<Plan> {
    const all = await this.allPlans();
    const chosen = await this.store.settings.get(`team:${teamId}:plan`);
    // A team the server's admin is in stays Unlimited unless put on a plan by name:
    // choosing a plan for new teams never limits the owner's own.
    if (!chosen && (await this.hasServerAdmin(teamId))) return UNLIMITED_PLAN;
    const fallback = (await this.plans()).defaultPlan;
    return (
      all.find((plan) => plan.id === chosen) ??
      all.find((plan) => plan.id === fallback) ??
      UNLIMITED_PLAN
    );
  }

  /** The server admin moves a team to a plan. */
  async setPlan(teamId: string, planId: string): Promise<void> {
    if (!(await this.allPlans()).some((plan) => plan.id === planId)) {
      throw ZelyqError.notFound("Plan", planId);
    }
    await this.store.settings.set(`team:${teamId}:plan`, planId);
  }

  // ------------------------------------------------------------------ usage

  /** What a team uses, against its plan. */
  async usage(teamId: string, fresh = false): Promise<TeamUsage> {
    const plan = await this.planOf(teamId);
    const files = fresh ? await this.measure(teamId) : await this.filesOf(teamId);
    const counts = await this.counts(teamId);
    const studio =
      (await this.store.images.bytesForTeam(teamId)) +
      (await this.store.videos.bytesForTeam(teamId));
    const pipelineBytes = counts.pipelineBytes;
    const storage = {
      apps: files.apps / MB,
      undoPoints: files.undoPoints / MB,
      studio: studio / MB,
      attachments: files.attachments / MB,
      pipelines: pipelineBytes / MB,
    };
    const used: Record<PlanLimitKey, number> = {
      storageMb: Math.round(
        storage.apps +
          storage.undoPoints +
          storage.studio +
          storage.attachments +
          storage.pipelines,
      ),
      apps: counts.apps,
      pipelines: counts.pipelines,
      triggers: counts.triggers,
      environments: counts.environments,
      machines: counts.machines,
      members: counts.members,
      previews: counts.previews,
      runnerMinutes: Math.ceil(counts.localSeconds / 60),
    };
    return {
      plan: { id: plan.id, name: plan.name },
      lines: PLAN_LIMIT_KEYS.map((key) => ({
        key,
        label: PLAN_LIMITS[key].label,
        unit: PLAN_LIMITS[key].unit,
        description: PLAN_LIMITS[key].description,
        used: used[key],
        limit: plan.limits[key] ?? null,
      })),
      storage,
      measuredAt: files.at || null,
    };
  }

  /**
   * Whether the team may add `adding` more of something. Throws, in plain
   * words, when its plan does not allow it; never for a plan with no limit.
   */
  async check(teamId: string, key: PlanLimitKey, adding = 1): Promise<void> {
    const plan = await this.planOf(teamId);
    const limit = plan.limits[key];
    if (limit === null || limit === undefined) return;
    const line = (await this.usage(teamId)).lines.find((one) => one.key === key);
    const used = line?.used ?? 0;
    if (used + adding <= limit) return;
    const words = PLAN_LIMITS[key];
    const amount = (value: number) => `${value}${words.unit ? ` ${words.unit}` : ""}`;
    throw new ZelyqError(
      "forbidden",
      key === "storageMb"
        ? `Your team's plan (${plan.name}) has ${amount(limit)} of storage, and the team uses ${amount(used)}. Delete what it no longer needs (old images, videos, apps), or a server admin moves the team to a bigger plan.`
        : key === "runnerMinutes"
          ? `Your team's plan (${plan.name}) has ${amount(limit)} on this server's runner this month, and they are used. Run on one of the team's own machines (free), or a server admin moves the team to a bigger plan.`
          : `Your team's plan (${plan.name}) allows ${limit} ${limit === 1 && "one" in words ? words.one : words.label.toLowerCase()}, and the team has ${used}. A server admin can move the team to a bigger plan.`,
    );
  }

  /** A pipeline that runs on this server's own runner, anywhere in its file. */
  usesLocalRunner(source: string): boolean {
    const parsed = parsePipelineFile(source);
    if (!parsed.ok) return false;
    const targets = [
      parsed.file["runs-on"],
      ...parsed.file.stages.map((stage) => stage["runs-on"]),
    ];
    return targets.some(
      (target) => target !== undefined && pipelineTarget({ "runs-on": target }).kind === "local",
    );
  }

  // ---------------------------------------------------------------- inside

  private async hasServerAdmin(teamId: string): Promise<boolean> {
    for (const member of await this.store.teams.listMembers(teamId)) {
      const user = await this.store.users.findById(member.userId);
      if (user?.instanceRole === "admin") return true;
    }
    return false;
  }

  private async counts(teamId: string) {
    const since = new Date();
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
    const [projects, pipelines, environments, runners, members, invites, pipelineUsage] =
      await Promise.all([
        this.store.projects.listForTeams([teamId], 100_000),
        this.store.pipelines.pipelines.listForTeam(teamId),
        this.store.deploy.environments.listForTeam(teamId),
        this.store.pipelines.runners.listForTeam(teamId),
        this.store.teams.listMembers(teamId),
        this.store.emailLinks.pendingInvites(teamId),
        this.store.pipelines.usage.forTeam(teamId, since.toISOString()),
      ]);
    let previews = 0;
    if (this.previewRunning) {
      for (const project of projects) {
        if (await this.previewRunning(project.id).catch(() => false)) previews += 1;
      }
    }
    return {
      apps: projects.length,
      pipelines: pipelines.length,
      triggers: pipelineUsage.triggers,
      environments: environments.length,
      machines: runners.length,
      members: members.length + invites.length,
      previews,
      localSeconds: pipelineUsage.localSeconds,
      pipelineBytes: pipelineUsage.artifactBytes + pipelineUsage.logBytes,
    };
  }

  private async filesOf(teamId: string): Promise<Measured> {
    const known = this.measured.get(teamId);
    if (known) return known;
    return await this.measure(teamId);
  }

  /** Measures a team's files now (one at a time per team). */
  async measure(teamId: string): Promise<Measured> {
    const running = this.measuring.get(teamId);
    if (running) return await running;
    const work = (async (): Promise<Measured> => {
      const projects = await this.store.projects.listForTeams([teamId], 100_000);
      let apps = 0;
      let undoPoints = 0;
      let attachments = 0;
      for (const project of projects) {
        if (this.paths.workspaceDir) {
          apps += await folderBytes(path.join(this.paths.workspaceDir, project.id), true);
          undoPoints += await folderBytes(
            path.join(this.paths.workspaceDir, ".snapshots", project.id),
            false,
          );
        }
        attachments += await folderBytes(path.join(this.paths.attachmentsDir, project.id), false);
      }
      const result = { apps, undoPoints, attachments, at: new Date().toISOString() };
      this.measured.set(teamId, result);
      return result;
    })();
    this.measuring.set(teamId, work);
    try {
      return await work;
    } finally {
      this.measuring.delete(teamId);
    }
  }

  private async measureAll(): Promise<void> {
    try {
      for (const team of await this.store.teams.listAll()) {
        await this.measure(team.id).catch(() => undefined);
      }
    } catch {
      // Measuring is bookkeeping: it never stops the server.
    }
  }
}
