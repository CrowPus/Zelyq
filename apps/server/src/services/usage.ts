import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type FreeSpaceResult,
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

/**
 * What the idle-app clean-up may remove: only what an install or a framework
 * rebuilds by itself. Never dist, build or anything that might be the
 * person's own work, and never a folder with files in the app's git history.
 */
const CLEARABLE = new Set([
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".parcel-cache",
]);
/** A Python environment is only one when it says so. */
const PYTHON_ENVS = new Set([".venv", "venv"]);
const CLEAN_EVERY_MS = 6 * 60 * 60_000;
const TOUCH_EVERY_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export interface CleanupReport {
  at: string;
  /** Only looked: what would be cleared, nothing removed. */
  dryRun: boolean;
  apps: number;
  freedBytes: number;
  /** One line per app cleared. */
  cleared: Array<{ projectId: string; name: string; bytes: number; folders: string[] }>;
}

/** Whether git keeps any file under this folder: then it is the person's, never cleared. */
function gitTracks(root: string, relative: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", root, "ls-files", "--", relative],
      { timeout: 20_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? true : stdout.trim().length > 0),
    );
  });
}

const PLANS_KEY = "plans";
const MEASURE_EVERY_MS = 15 * 60_000;
const MB = 1024 * 1024;

/** Bytes under a folder; hard links once, links never followed. */
export async function folderBytes(root: string, skipReinstallable: boolean): Promise<number> {
  return await foldersBytes([root], skipReinstallable);
}

/** Bytes under several folders together: a file hard-linked in two is counted once. */
export async function foldersBytes(roots: string[], skipReinstallable: boolean): Promise<number> {
  const seen = new Set<string>();
  let total = 0;
  const stack = [...roots];
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
  perApp: Array<{
    id: string;
    name: string;
    files: number;
    undoPoints: number;
    attachments: number;
  }>;
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
    this.cleanTimer = setInterval(
      () => void this.cleanIdle().catch(() => undefined),
      CLEAN_EVERY_MS,
    );
    this.cleanTimer.unref();
    void this.measureAll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.cleanTimer) clearInterval(this.cleanTimer);
    this.timer = null;
    this.cleanTimer = null;
  }

  // -------------------------------------------------------- idle clean-up

  private cleanTimer: NodeJS.Timeout | null = null;
  private readonly touched = new Map<string, number>();
  /** Whether an app's agent is working now (its status says building). */
  appBusy?: (projectId: string) => Promise<boolean>;
  /** How many idle days before clearing (Server settings); 0: never. */
  idleDays?: () => Promise<number>;

  /** Someone opened, talked to or previewed an app: it is not idle. At most once an hour. */
  touch(projectId: string): void {
    const now = Date.now();
    if (now - (this.touched.get(projectId) ?? 0) < TOUCH_EVERY_MS) return;
    this.touched.set(projectId, now);
    void this.store.settings
      .set(`project:${projectId}:used`, new Date(now).toISOString())
      .catch(() => this.touched.delete(projectId));
  }

  async lastUsed(projectId: string, updatedAt: string): Promise<number> {
    // Every use is recorded (opened, talked to, previewed); an app never used since
    // that began counts from when it last changed.
    const used = await this.store.settings.get(`project:${projectId}:used`);
    return used ? Date.parse(used) : Date.parse(updatedAt) || 0;
  }

  async lastCleanup(): Promise<CleanupReport | null> {
    const stored = await this.store.settings.get("cleanup:last");
    try {
      return stored ? (JSON.parse(stored) as CleanupReport) : null;
    } catch {
      return null;
    }
  }

  /**
   * Clears installed packages and build caches from apps nobody has used for
   * a while. Skips an app whose preview runs or whose agent works, and any
   * folder git keeps. The packages come back the next time its preview starts.
   */
  async cleanIdle(options: { days?: number; dryRun?: boolean } = {}): Promise<CleanupReport> {
    const days = options.days ?? (await this.idleDays?.()) ?? 14;
    const report: CleanupReport = {
      at: new Date().toISOString(),
      dryRun: options.dryRun === true,
      apps: 0,
      freedBytes: 0,
      cleared: [],
    };
    if (!this.paths.workspaceDir || days <= 0) return report;
    const cutoff = Date.now() - days * DAY_MS;
    for (const team of await this.store.teams.listAll()) {
      for (const project of await this.store.projects.listForTeams([team.id], 100_000)) {
        if ((await this.lastUsed(project.id, project.updatedAt)) > cutoff) continue;
        if (await this.previewRunning?.(project.id).catch(() => true)) continue;
        if (await this.appBusy?.(project.id).catch(() => true)) continue;
        const root = path.join(this.paths.workspaceDir, project.id);
        const folders = await this.clearableFolders(root);
        if (folders.length === 0) continue;
        let bytes = 0;
        const removed: string[] = [];
        for (const relative of folders) {
          const full = path.join(root, relative);
          const size = await folderBytes(full, false);
          if (options.dryRun) {
            bytes += size;
            removed.push(relative);
            continue;
          }
          try {
            await fs.rm(full, { recursive: true, force: true });
            bytes += size;
            removed.push(relative);
          } catch {
            // Left as it is: next time.
          }
        }
        if (removed.length === 0) continue;
        report.apps += 1;
        report.freedBytes += bytes;
        report.cleared.push({ projectId: project.id, name: project.name, bytes, folders: removed });
      }
    }
    if (options.dryRun) return report;
    await this.store.settings.set("cleanup:last", JSON.stringify(report)).catch(() => undefined);
    // What each team uses has changed.
    this.measured.clear();
    return report;
  }

  /** The folders under an app that may go, outermost only, git-kept ones left out. */
  private async clearableFolders(root: string): Promise<string[]> {
    const found: string[] = [];
    const hasGit = await fs
      .access(path.join(root, ".git"))
      .then(() => true)
      .catch(() => false);
    const walk = async (relative: string, depth: number) => {
      if (depth > 4) return;
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if (entry.name === ".git" || entry.name === ".zelyq") continue;
        const child = relative ? path.join(relative, entry.name) : entry.name;
        if (CLEARABLE.has(entry.name)) {
          if (
            PYTHON_ENVS.has(entry.name) &&
            !(await fs
              .access(path.join(root, child, "pyvenv.cfg"))
              .then(() => true)
              .catch(() => false))
          ) {
            await walk(child, depth + 1);
            continue;
          }
          if (hasGit && (await gitTracks(root, child))) continue;
          found.push(child);
          continue;
        }
        await walk(child, depth + 1);
      }
    };
    await walk("", 0);
    return found;
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
      apps: await Promise.all(
        [...(files.perApp ?? [])]
          .sort(
            (a, b) =>
              b.files + b.undoPoints + b.attachments - (a.files + a.undoPoints + a.attachments),
          )
          .map(async (app) => ({
            id: app.id,
            name: app.name,
            files: app.files / MB,
            undoPoints: app.undoPoints / MB,
            undoCount: (await this.store.snapshots.listForProject(app.id, 100_000)).length,
            attachments: app.attachments / MB,
          })),
      ),
    };
  }

  /** Removes an app's older undo points (set by the app: the project service does it). */
  pruneUndo?: (projectId: string, keep: number) => Promise<number>;
  /** Removes an app's chat attachments (set by the app). */
  removeAttachments?: (projectId: string) => Promise<void>;

  /**
   * Frees space in one app, as a team member asks: older undo points (the
   * newest `keepUndo` stay, at least one), and its chat attachments. With
   * `look`, only says what it would free.
   */
  async freeSpace(
    teamId: string,
    projectId: string,
    options: { keepUndo?: number; attachments?: boolean; look?: boolean },
  ): Promise<FreeSpaceResult> {
    const look = options.look === true;
    let freed = 0;
    let undoPointsRemoved = 0;
    if (options.keepUndo !== undefined && this.paths.workspaceDir) {
      const keep = Math.max(1, options.keepUndo);
      const all = await this.store.snapshots.listForProject(projectId, 100_000);
      const dir = path.join(this.paths.workspaceDir, ".snapshots", projectId);
      const before = await folderBytes(dir, false);
      const kept = await foldersBytes(
        all.slice(0, keep).map((snapshot) => path.join(dir, snapshot.id)),
        false,
      );
      const going = Math.max(0, all.length - keep);
      if (look) {
        freed += going > 0 ? Math.max(0, before - kept) : 0;
        undoPointsRemoved = going;
      } else if (going > 0 && this.pruneUndo) {
        undoPointsRemoved = await this.pruneUndo(projectId, keep);
        freed += Math.max(0, before - (await folderBytes(dir, false)));
      }
    }
    let attachmentsRemoved = false;
    if (options.attachments) {
      const dir = path.join(this.paths.attachmentsDir, projectId);
      const size = await folderBytes(dir, false);
      if (look) {
        freed += size;
        attachmentsRemoved = size > 0;
      } else if (size > 0 && this.removeAttachments) {
        await this.removeAttachments(projectId);
        freed += size;
        attachmentsRemoved = true;
      }
    }
    if (!look) await this.measure(teamId).catch(() => undefined);
    return { look, freedMb: freed / MB, undoPointsRemoved, attachmentsRemoved };
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
      const perApp: Measured["perApp"] = [];
      for (const project of projects) {
        const files = this.paths.workspaceDir
          ? await folderBytes(path.join(this.paths.workspaceDir, project.id), true)
          : 0;
        const undo = this.paths.workspaceDir
          ? await folderBytes(path.join(this.paths.workspaceDir, ".snapshots", project.id), false)
          : 0;
        const sent = await folderBytes(path.join(this.paths.attachmentsDir, project.id), false);
        apps += files;
        undoPoints += undo;
        attachments += sent;
        perApp.push({
          id: project.id,
          name: project.name,
          files,
          undoPoints: undo,
          attachments: sent,
        });
      }
      const result = { apps, undoPoints, attachments, at: new Date().toISOString(), perApp };
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
