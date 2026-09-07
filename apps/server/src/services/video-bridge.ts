import { randomBytes } from "node:crypto";
import type { Store } from "@zelyq/db";

/**
 * The capability channel that lets the build agent generate video **without
 * ever holding the video API key**, and without reaching the database.
 *
 * Same shape as `ImageBridge`, for the same reasons — but a separate
 * permission and a separate grant, because they authorise different amounts of
 * money. A project allowed to make pictures has not thereby been allowed to
 * make films.
 *
 * `mint` returns null when the project has not been given permission, or when
 * the instance has no video provider configured. That is the whole enforcement:
 * no token means the session is never offered the video tools.
 */

const TOKEN_TTL_MS = 12 * 60 * 60_000;

interface Grant {
  projectId: string;
  projectName: string;
  userId: string;
  sessionId: string;
  expiresAt: number;
}

export class VideoBridge {
  private readonly grants = new Map<string, Grant>();

  constructor(
    private readonly store: Store,
    private readonly videos: {
      capabilities(): Promise<{ providers: { configured: boolean }[] }>;
    },
  ) {}

  async mint(sessionId: string, projectId: string, userId: string): Promise<string | null> {
    const project = await this.store.projects.findById(projectId);
    if (!project?.videoGenerationEnabled) return null;
    // A permission granted on an instance with no video key would hand the
    // model tools that can only fail. Unlike images there is no single default
    // flag — a provider is configured or it is not, and any one will do.
    const { providers } = await this.videos.capabilities();
    if (!providers.some((provider) => provider.configured)) return null;

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

  revokeSession(sessionId: string): void {
    for (const [token, grant] of this.grants) {
      if (grant.sessionId === sessionId) this.grants.delete(token);
    }
  }
}
