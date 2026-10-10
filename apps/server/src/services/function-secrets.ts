import type { User } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { AccessControl } from "./access.js";
import type { ProjectVariableService } from "./project-variables.js";
import type { SupabaseConnectionService } from "./supabase-connections.js";

export interface FunctionSecretsStatus {
  /** Whether the project is linked to a Supabase resource at all. */
  linked: boolean;
  /** Names last set in Supabase — never values. */
  names: string[];
  at: string | null;
  error: string | null;
}

/**
 * A browser-only app (plain React, Expo) has no server of its own; its
 * server side is a Supabase Edge Function. This keeps the linked Supabase
 * project's function secrets equal to the project's variables, so a function
 * reads `Deno.env.get("STRIPE_KEY")` and gets what Variables says — typed or
 * from Vault. It runs after every change, and on request.
 *
 * What was set last is remembered by name only, so a variable that is
 * deleted is removed from Supabase too, while secrets someone set there by
 * hand are left alone.
 */
export class FunctionSecretSync {
  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
    private readonly supabase: SupabaseConnectionService,
    private readonly variables: ProjectVariableService,
  ) {}

  private key(projectId: string): string {
    return `function-secrets:${projectId}`;
  }

  async status(user: User, projectId: string): Promise<FunctionSecretsStatus> {
    await this.access.requireProject(user, projectId, "viewer");
    return this.read(projectId);
  }

  /** On request, by a person — the same sync the automatic one runs. */
  async syncNow(user: User, projectId: string): Promise<FunctionSecretsStatus> {
    await this.access.requireProject(user, projectId, "editor");
    await this.sync(projectId);
    return this.read(projectId);
  }

  /** Never throws: a failure is recorded where the panel shows it. */
  async sync(projectId: string): Promise<void> {
    const previous = await this.read(projectId);
    try {
      const values = await this.variables.environmentFor(projectId);
      const result = await this.supabase.syncFunctionSecrets(projectId, values, previous.names);
      if (!result) {
        if (previous.at) await this.store.settings.remove(this.key(projectId));
        return;
      }
      await this.write(projectId, { names: result.set, at: new Date().toISOString(), error: null });
    } catch (error) {
      await this.write(projectId, {
        names: previous.names,
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Sync failed.",
      });
    }
  }

  private async read(projectId: string): Promise<FunctionSecretsStatus> {
    const linked = (await this.supabase.getLinkedResource(projectId)) !== null;
    const raw = await this.store.settings.get(this.key(projectId));
    const stored = raw
      ? (JSON.parse(raw) as Omit<FunctionSecretsStatus, "linked">)
      : { names: [], at: null, error: null };
    return { linked, ...stored };
  }

  private async write(projectId: string, value: Omit<FunctionSecretsStatus, "linked">) {
    await this.store.settings.set(this.key(projectId), JSON.stringify(value));
  }
}
