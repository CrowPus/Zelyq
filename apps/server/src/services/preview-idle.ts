import type { Preview } from "@zelyq/core";
import { listPreviewRecords } from "@zelyq/runtime";

/**
 * Previews nobody uses are stopped, and wake on the next visit.
 *
 * A running preview holds its container's memory (on Zelyq Cloud up to
 * 1.5 GB each). One left running after its person went home holds it all
 * night, and enough of them fill the server. So a preview with no visit, no
 * edit and no AI work for the set number of minutes ("Stop previews nobody
 * uses after", `ZELYQ_PREVIEW_IDLE_MINUTES`) is stopped.
 *
 * What counts as use: a request to the preview's address (not the
 * dev server's own reconnect pings, which a page left open sends forever), a
 * chat message or AI turn, opening or starting it in Zelyq, and an editor
 * that has the app open. What does not: nothing else — a tab left open on
 * the preview alone does not keep it running.
 *
 * Only a preview stopped here wakes when its address is opened again: one
 * its person stopped stays stopped. The mark is kept in settings, so it
 * survives a restart; it is cleared when the preview starts or is stopped by
 * hand.
 */
export interface PreviewIdleDeps {
  /** The setting, read each sweep; 0 is off. */
  minutes: () => Promise<number>;
  workspaceDir: string;
  stopPreview: (projectId: string) => Promise<unknown>;
  /** Starts a preview as Zelyq would for its person (limits, env, backend). */
  startPreview: (projectId: string) => Promise<Preview>;
  /** Busy right now: an AI turn running, or the app open in an editor. */
  inUse?: (projectId: string) => boolean;
  /** A preview stopped or started here: whatever remembered its address forgets it. */
  changed?: (projectId: string) => void;
  settings: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  log?: { info(message: string): void; error(error: unknown, message: string): void };
  now?: () => number;
}

const markKey = (projectId: string) => `project:${projectId}:preview-idle-stopped`;
/** After a failed wake, the next visit only says so for this long, rather than trying again. */
const WAKE_RETRY_MS = 60_000;

export class PreviewIdle {
  private readonly seenAt = new Map<string, number>();
  private readonly began: number;
  private timer: NodeJS.Timeout | undefined;
  private readonly waking = new Map<string, Promise<void>>();
  private readonly wakeFailed = new Map<string, number>();
  /** One sweep at a time: a slow one (many stops) is never overtaken by the next. */
  private sweeping: Promise<string[]> | undefined;

  constructor(private readonly deps: PreviewIdleDeps) {
    this.began = this.now();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Someone used the app or its preview just now. */
  seen(projectId: string): void {
    this.seenAt.set(projectId, this.now());
  }

  /** Checks once a minute. */
  start(everyMs = 60_000): void {
    this.stop();
    this.timer = setInterval(() => {
      void this.sweep().catch((error) => this.deps.log?.error(error, "idle preview sweep failed"));
    }, everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Stops each preview unused for longer than the setting; returns the ones it stopped. */
  async sweep(now = this.now()): Promise<string[]> {
    if (this.sweeping) return [];
    this.sweeping = this.sweepOnce(now);
    try {
      return await this.sweeping;
    } finally {
      this.sweeping = undefined;
    }
  }

  private async sweepOnce(now: number): Promise<string[]> {
    const minutes = await this.deps.minutes();
    if (!(minutes > 0)) return [];
    const limit = minutes * 60_000;
    const stopped: string[] = [];
    for (const { projectId, record } of await listPreviewRecords(this.deps.workspaceDir)) {
      // Running again, however it was started: no longer one stopped for being unused.
      if (!this.waking.has(projectId) && (await this.stoppedForIdle(projectId))) {
        await this.deps.settings.remove(markKey(projectId)).catch(() => undefined);
      }
      if (this.deps.inUse?.(projectId)) {
        this.seen(projectId);
        continue;
      }
      // Counted from the latest of: last use, the preview's start, and this
      // process's start (a restart forgets who was looking, so everyone gets
      // the full time again).
      const last = Math.max(
        this.seenAt.get(projectId) ?? 0,
        Date.parse(record.startedAt) || 0,
        this.began,
      );
      if (now - last < limit) continue;
      try {
        await this.deps.stopPreview(projectId);
        await this.deps.settings.set(markKey(projectId), new Date(now).toISOString());
        this.deps.changed?.(projectId);
        this.seenAt.delete(projectId);
        stopped.push(projectId);
      } catch (error) {
        this.deps.log?.error(error, `could not stop idle preview ${projectId}`);
      }
    }
    if (stopped.length > 0) {
      this.deps.log?.info(`stopped ${stopped.length} preview(s) unused for ${minutes} min`);
    }
    return stopped;
  }

  /** Started or stopped by its person: no longer one to wake. */
  async forget(projectId: string): Promise<void> {
    this.wakeFailed.delete(projectId);
    this.deps.changed?.(projectId);
    await this.deps.settings.remove(markKey(projectId)).catch(() => undefined);
  }

  /** Whether this preview was stopped here for being unused (and so may wake). */
  async stoppedForIdle(projectId: string): Promise<boolean> {
    return (await this.deps.settings.get(markKey(projectId)).catch(() => null)) !== null;
  }

  /**
   * A visit to a preview stopped for being unused: start it, once, in the
   * background. "starting" while it starts, "failed" for a minute after a
   * start that did not work (limits, a broken app), "no" when it is not one
   * to wake.
   */
  async wake(projectId: string): Promise<"starting" | "failed" | "no"> {
    if (this.waking.has(projectId)) return "starting";
    const failedAt = this.wakeFailed.get(projectId);
    if (failedAt !== undefined && this.now() - failedAt < WAKE_RETRY_MS) return "failed";
    if (!(await this.stoppedForIdle(projectId))) return "no";
    this.seen(projectId);
    const work = this.deps
      .startPreview(projectId)
      .then(async (preview) => {
        this.deps.changed?.(projectId);
        if (preview.status === "running" || preview.status === "starting") {
          this.wakeFailed.delete(projectId);
          await this.deps.settings.remove(markKey(projectId)).catch(() => undefined);
        } else {
          this.wakeFailed.set(projectId, this.now());
        }
      })
      .catch((error) => {
        this.wakeFailed.set(projectId, this.now());
        this.deps.log?.error(error, `could not wake preview ${projectId}`);
      })
      .finally(() => this.waking.delete(projectId));
    this.waking.set(projectId, work);
    return "starting";
  }

  /** For tests: the wake in progress for a project, if any. */
  wakeInProgress(projectId: string): Promise<void> | undefined {
    return this.waking.get(projectId);
  }
}
