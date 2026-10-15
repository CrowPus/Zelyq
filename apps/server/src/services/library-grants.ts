import { randomBytes } from "node:crypto";

const TOKEN_TTL_MS = 12 * 60 * 60_000;

export interface LibraryGrant {
  projectId: string;
  projectName: string;
  userId: string;
  sessionId: string;
}

/**
 * Tokens that let an agent session READ a person's Studio library — list what
 * is there and copy it into the project — and nothing else.
 *
 * Kept apart from the generation grants in `ImageBridge` and `VideoBridge` on
 * purpose. Those authorise spending: they exist only while a project has
 * generation switched on and a provider is configured, and they are revoked the
 * moment the switch goes off. Reusing an image or a clip someone already made
 * costs nothing, so it should not hide behind that switch — a project with
 * video generation off could not even place a video its owner made in Studio.
 * A library token never reaches a route that calls a provider.
 */
export class LibraryGrants {
  private readonly grants = new Map<string, LibraryGrant & { expiresAt: number }>();

  /** The session's token, renewed rather than replaced — a reused agent
   *  session keeps the token it was created with. */
  mint(grant: LibraryGrant): string {
    for (const [token, existing] of this.grants) {
      if (existing.sessionId !== grant.sessionId) continue;
      if (existing.projectId === grant.projectId && existing.userId === grant.userId) {
        existing.projectName = grant.projectName;
        existing.expiresAt = Date.now() + TOKEN_TTL_MS;
        return token;
      }
      this.grants.delete(token);
    }
    const token = randomBytes(32).toString("base64url");
    this.grants.set(token, { ...grant, expiresAt: Date.now() + TOKEN_TTL_MS });
    return token;
  }

  resolve(token: string): LibraryGrant | null {
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
