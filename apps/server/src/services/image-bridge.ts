import { randomBytes } from "node:crypto";
import type { Store } from "@zelyq/db";

/**
 * The capability channel that lets the build agent generate images **without
 * ever holding the image API key**, and without reaching the database.
 *
 * Same shape as `SupabaseBridge`, for the same reasons. The server mints a
 * random token bound to one session, project and user; the agent presents it to
 * `/api/internal/images/*`; the server performs the generation itself and
 * records the row against that user. The token grants nothing but "generate,
 * list, or read an image for THIS user" and expires with the session.
 *
 * Carrying `userId` is what makes agent images appear in the person's Image
 * Studio: the row is owned by them, not by the project or the agent, so every
 * ownership check and every library query already written applies unchanged.
 *
 * `mint` returns null when the project has not been given permission, which is
 * the whole enforcement of that permission — no token means the session never
 * receives the tools.
 */

const TOKEN_TTL_MS = 12 * 60 * 60_000;

interface Grant {
  projectId: string;
  projectName: string;
  userId: string;
  sessionId: string;
  expiresAt: number;
}

export class ImageBridge {
  private readonly grants = new Map<string, Grant>();

  constructor(
    private readonly store: Store,
    private readonly images: { capabilities(): Promise<{ configured: boolean }> },
  ) {}

  /**
   * A token for this session, or null when the project has not enabled agent
   * image generation or the instance has no configured provider. Replaces any
   * prior token for the session.
   */
  async mint(sessionId: string, projectId: string, userId: string): Promise<string | null> {
    const project = await this.store.projects.findById(projectId);
    if (!project?.imageGenerationEnabled) return null;
    // A permission granted against an instance with no image key would hand the
    // model tools that can only fail. Check before minting, not at call time.
    if (!(await this.images.capabilities()).configured) return null;

    for (const [token, grant] of this.grants) {
      if (grant.sessionId === sessionId) this.grants.delete(token);
    }
    const token = randomBytes(32).toString("base64url");
    this.grants.set(token, {
      projectId,
      projectName: project.name,
      userId,
      sessionId,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
    return token;
  }

  /** The project, user and session a token stands for, or null if unknown/expired. */
  resolve(
    token: string,
  ): { projectId: string; projectName: string; userId: string; sessionId: string } | null {
    const grant = this.grants.get(token);
    if (!grant) return null;
    if (Date.now() > grant.expiresAt) {
      this.grants.delete(token);
      return null;
    }
    const { projectId, projectName, userId, sessionId } = grant;
    return { projectId, projectName, userId, sessionId };
  }

  /** Drop every token for a session (called when it ends). */
  revokeSession(sessionId: string): void {
    for (const [token, grant] of this.grants) {
      if (grant.sessionId === sessionId) this.grants.delete(token);
    }
  }
}
