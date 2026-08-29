import { randomBytes } from "node:crypto";
import type { Store } from "@zelyq/db";

/**
 * Proposal 058 · Phase C — the capability channel that lets a build agent apply
 * a Supabase migration and verify the backend **without ever holding the
 * Management credential**.
 *
 * The server mints a random, short-lived token bound to one session and one
 * project. The agent presents it to `/api/internal/supabase/*`; the server
 * resolves the project, loads the connecting user for the audit trail, and
 * performs the Supabase call itself. The token grants nothing but "apply a
 * migration / read the schema for THIS project" and expires with the session.
 */

const TOKEN_TTL_MS = 12 * 60 * 60_000;

interface Grant {
  projectId: string;
  userId: string;
  sessionId: string;
  expiresAt: number;
}

export class SupabaseBridge {
  private readonly grants = new Map<string, Grant>();

  constructor(private readonly store: Store) {}

  /**
   * A token for this session, or null when the project has no linked Supabase
   * resource (nothing to bridge). Replaces any prior token for the session.
   */
  async mint(sessionId: string, projectId: string, userId: string): Promise<string | null> {
    const link = await this.store.providerConnections.getLinkForProject(projectId);
    if (!link || link.connectionStatus === "revoked") return null;

    for (const [token, grant] of this.grants) {
      if (grant.sessionId === sessionId) this.grants.delete(token);
    }
    const token = randomBytes(32).toString("base64url");
    this.grants.set(token, { projectId, userId, sessionId, expiresAt: Date.now() + TOKEN_TTL_MS });
    return token;
  }

  /** The project + user a token stands for, or null if unknown/expired. */
  resolve(token: string): { projectId: string; userId: string } | null {
    const grant = this.grants.get(token);
    if (!grant) return null;
    if (Date.now() > grant.expiresAt) {
      this.grants.delete(token);
      return null;
    }
    return { projectId: grant.projectId, userId: grant.userId };
  }

  /** Drop every token for a session (called when it ends). */
  revokeSession(sessionId: string): void {
    for (const [token, grant] of this.grants) {
      if (grant.sessionId === sessionId) this.grants.delete(token);
    }
  }
}
