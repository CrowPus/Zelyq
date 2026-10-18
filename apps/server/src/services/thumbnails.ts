import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Project } from "@zelyq/core";
import sharp from "sharp";

/** Card size in the app list, at 2x for sharp screens. 16:10, like the viewport. */
const WIDTH = 800;
const HEIGHT = 500;
/** A failed or skipped capture is not retried sooner than this. The editor
 *  polls preview status every 15 seconds, and a page that cannot be
 *  captured should not cost a browser launch on every poll. */
const RETRY_AFTER_MS = 5 * 60_000;

/**
 * The picture of each app on its card in the app list: the app's own running
 * preview, taken by the agent's browser. Taken after a turn that changed the
 * app, and the first time an app without one is previewed. Never a reason
 * anything else fails: every capture is best-effort.
 *
 * Application data beside the database, like images and videos. The file's
 * modified time is the thumbnail's version, so no database column is needed.
 */
export class ThumbnailStore {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly lastTried = new Map<string, number>();

  constructor(
    private readonly root: string,
    private readonly shoot: (projectId: string) => Promise<Buffer>,
    private readonly log: { warn: (data: unknown, message: string) => void },
  ) {}

  private file(projectId: string): string {
    if (!/^prj_[A-Za-z0-9]+$/.test(projectId)) throw new Error("Invalid project ID.");
    return path.join(this.root, `${projectId}.webp`);
  }

  /** When the thumbnail was taken, or null when there is none. */
  async takenAt(projectId: string): Promise<string | null> {
    try {
      return (await fs.stat(this.file(projectId))).mtime.toISOString();
    } catch {
      return null;
    }
  }

  /** Projects as the list returns them, each with `thumbnailAt`. */
  async stamp(projects: Project[]): Promise<Project[]> {
    return Promise.all(
      projects.map(async (project) => ({
        ...project,
        thumbnailAt: await this.takenAt(project.id),
      })),
    );
  }

  async read(projectId: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.file(projectId));
    } catch {
      return null;
    }
  }

  async remove(projectId: string): Promise<void> {
    this.lastTried.delete(projectId);
    await fs.rm(this.file(projectId), { force: true });
  }

  /**
   * Take a new thumbnail now. `delayMs` gives a dev server's hot reload time
   * to pick up files the agent just wrote. Resolves once done or given up;
   * never rejects.
   */
  capture(projectId: string, delayMs = 0): Promise<void> {
    const running = this.inFlight.get(projectId);
    if (running) return running;
    this.lastTried.set(projectId, Date.now());
    const work = (async () => {
      try {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        const shot = await this.shoot(projectId);
        const image = await sharp(shot)
          .resize(WIDTH, HEIGHT, { fit: "cover", position: "top" })
          .webp({ quality: 80 })
          .toBuffer();
        const target = this.file(projectId);
        await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
        const temp = `${target}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temp, image, { mode: 0o600, flag: "wx" });
          await fs.rename(temp, target);
        } finally {
          await fs.rm(temp, { force: true });
        }
      } catch (error) {
        this.log.warn({ err: error, projectId }, "could not take the app's thumbnail");
      } finally {
        this.inFlight.delete(projectId);
      }
    })();
    this.inFlight.set(projectId, work);
    return work;
  }

  /** Take one for an app that has none yet, unless one was tried recently. */
  async captureIfMissing(projectId: string): Promise<void> {
    const tried = this.lastTried.get(projectId);
    if (tried && Date.now() - tried < RETRY_AFTER_MS) return;
    if (this.inFlight.has(projectId) || (await this.takenAt(projectId))) return;
    void this.capture(projectId);
  }
}
