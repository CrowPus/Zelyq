import { desc, eq } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import {
  projectProviderLinks,
  projects,
  providerConnections,
  providerOperations,
  providerResources,
} from "../schema/sqlite.js";

/**
 * All persistence for the instance-wide external-backend
 * connection lives here. The stored `encryptedBlob` is opaque to this layer —
 * it is only ever decrypted inside `SupabaseConnectionService`.
 */
export function providerConnectionRepository(db: ZelyqDb) {
  return {
    // — connections —

    async createConnection(input: {
      id: string;
      provider: string;
      credentialType: "oauth" | "pat";
      encryptedBlob: string;
      grantedScopes?: string;
      expiresAt?: string | null;
      createdBy: string;
    }): Promise<void> {
      await db.insert(providerConnections).values({
        id: input.id,
        provider: input.provider,
        credentialType: input.credentialType,
        encryptedBlob: input.encryptedBlob,
        grantedScopes: input.grantedScopes ?? "",
        expiresAt: input.expiresAt ?? null,
        status: "active",
        createdBy: input.createdBy,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      });
    },

    async getConnection(id: string) {
      const rows = await db
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async listConnections(provider = "supabase") {
      return db
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.provider, provider))
        .orderBy(desc(providerConnections.createdAt));
    },

    async updateConnectionCredential(
      id: string,
      patch: { encryptedBlob: string; expiresAt?: string | null; grantedScopes?: string },
    ): Promise<void> {
      await db
        .update(providerConnections)
        .set({
          encryptedBlob: patch.encryptedBlob,
          ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
          ...(patch.grantedScopes !== undefined ? { grantedScopes: patch.grantedScopes } : {}),
        })
        .where(eq(providerConnections.id, id));
    },

    async setConnectionStatus(
      id: string,
      status: "active" | "expired" | "revoked" | "orphaned",
    ): Promise<void> {
      await db.update(providerConnections).set({ status }).where(eq(providerConnections.id, id));
    },

    async markConnectionUsed(id: string): Promise<void> {
      await db
        .update(providerConnections)
        .set({ lastUsedAt: new Date().toISOString() })
        .where(eq(providerConnections.id, id));
    },

    /** Any connection whose creator is `userId`, for the leaving-user flow. */
    async listConnectionsCreatedBy(userId: string) {
      return db.select().from(providerConnections).where(eq(providerConnections.createdBy, userId));
    },

    // — resources —

    async createResource(input: {
      id: string;
      connectionId: string;
      orgId: string;
      projectRef: string;
      projectUrl: string;
      publishableKey: string;
      environment?: "development" | "staging" | "production";
      region?: string | null;
      displayName: string;
      provisionedByZelyq?: boolean;
    }): Promise<void> {
      await db.insert(providerResources).values({
        id: input.id,
        connectionId: input.connectionId,
        orgId: input.orgId,
        projectRef: input.projectRef,
        projectUrl: input.projectUrl,
        publishableKey: input.publishableKey,
        environment: input.environment ?? "development",
        region: input.region ?? null,
        displayName: input.displayName,
        provisionedByZelyq: input.provisionedByZelyq ? 1 : 0,
        createdAt: new Date().toISOString(),
      });
    },

    async getResource(id: string) {
      const rows = await db
        .select()
        .from(providerResources)
        .where(eq(providerResources.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async listResourcesForConnection(connectionId: string) {
      return db
        .select()
        .from(providerResources)
        .where(eq(providerResources.connectionId, connectionId))
        .orderBy(desc(providerResources.createdAt));
    },

    async deleteResource(id: string): Promise<void> {
      await db.delete(providerResources).where(eq(providerResources.id, id));
    },

    // — project links —

    async linkProject(input: {
      zelyqProjectId: string;
      providerResourceId: string;
      linkedBy: string;
    }): Promise<void> {
      await db
        .insert(projectProviderLinks)
        .values({ ...input, linkedAt: new Date().toISOString() })
        .onConflictDoUpdate({
          target: projectProviderLinks.zelyqProjectId,
          set: {
            providerResourceId: input.providerResourceId,
            linkedBy: input.linkedBy,
            linkedAt: new Date().toISOString(),
          },
        });
    },

    async unlinkProject(zelyqProjectId: string): Promise<void> {
      await db
        .delete(projectProviderLinks)
        .where(eq(projectProviderLinks.zelyqProjectId, zelyqProjectId));
    },

    /**
     * The linked resource for a Zelyq project, joined to its connection and the
     * project's own team (for audit scoping). Public fields only.
     */
    async getLinkForProject(zelyqProjectId: string) {
      const rows = await db
        .select({
          resource: providerResources,
          connectionId: providerConnections.id,
          connectionStatus: providerConnections.status,
          teamId: projects.teamId,
        })
        .from(projectProviderLinks)
        .innerJoin(
          providerResources,
          eq(projectProviderLinks.providerResourceId, providerResources.id),
        )
        .innerJoin(providerConnections, eq(providerResources.connectionId, providerConnections.id))
        .innerJoin(projects, eq(projectProviderLinks.zelyqProjectId, projects.id))
        .where(eq(projectProviderLinks.zelyqProjectId, zelyqProjectId))
        .limit(1);
      return rows[0] ?? null;
    },

    // — operations audit (provider-specific; metadata only) —

    async recordOperation(input: {
      id: string;
      connectionId: string | null;
      zelyqProjectId?: string | null;
      action:
        | "connect"
        | "provision"
        | "configure-auth"
        | "delete"
        | "link"
        | "unlink"
        | "migrate"
        | "deploy_function"
        | "extract";
      outcome: "ok" | "error";
      detail?: Record<string, unknown>;
      actorUserId: string | null;
    }): Promise<void> {
      await db.insert(providerOperations).values({
        id: input.id,
        connectionId: input.connectionId,
        zelyqProjectId: input.zelyqProjectId ?? null,
        action: input.action,
        outcome: input.outcome,
        detail: JSON.stringify(input.detail ?? {}),
        actorUserId: input.actorUserId,
        createdAt: new Date().toISOString(),
      });
    },

    async listOperationsForConnection(connectionId: string, limit = 100) {
      const rows = await db
        .select()
        .from(providerOperations)
        .where(eq(providerOperations.connectionId, connectionId))
        .orderBy(desc(providerOperations.createdAt))
        .limit(limit);
      return rows.map((row) => ({
        ...row,
        detail: JSON.parse(row.detail) as Record<string, unknown>,
      }));
    },
  };
}

export type ProviderConnectionRepository = ReturnType<typeof providerConnectionRepository>;
