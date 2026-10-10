import { createHash } from "node:crypto";
import {
  newId,
  type Project,
  parseDotEnv,
  type User,
  type VaultActor,
  type VaultEnvironment,
  type VaultImport,
  type VaultImportResult,
  type VaultSecret,
  type VaultSecretCreate,
  type VaultSecretUpdate,
  type VaultSecretVersion,
  vaultImportSchema,
  vaultSecretNameSchema,
  ZelyqError,
} from "@zelyq/core";
import type { Store, VaultSecretRow, VaultSecretSummaryRow } from "@zelyq/db";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { AccessControl } from "./access.js";
import type { SecretBox } from "./secrets.js";

/**
 * A project's secrets. Every path through here is either value-free (lists,
 * history, the agent's view of names) or decrypts for exactly one purpose: an
 * audited reveal to a person, or the project's own runtime environment.
 *
 * Permissions are the project's team roles, as everywhere else: viewers see
 * names, editors change and reveal. Reveal sits at editor rather than admin
 * because an editor can already change the code that reads the variable; a
 * stricter rule would only look stricter. What makes it accountable is that
 * every reveal is in the audit log.
 */
export class VaultService {
  constructor(
    private readonly store: Store,
    private readonly secrets: SecretBox,
    private readonly access: AccessControl,
    private readonly runtime: RuntimeDriver,
  ) {}

  async list(
    user: User,
    projectId: string,
    environment?: VaultEnvironment,
  ): Promise<VaultSecret[]> {
    await this.access.requireProject(user, projectId, "viewer");
    return this.present(await this.store.vault.list(projectId, environment));
  }

  async create(user: User, projectId: string, input: VaultSecretCreate): Promise<VaultSecret> {
    const { project } = await this.access.requireProject(user, projectId, "editor");
    const existing = await this.store.vault.findByName(project.id, input.name, input.environment);
    if (existing) {
      throw new ZelyqError(
        "conflict",
        `${input.name} already exists in ${input.environment}. Edit it to change its value.`,
      );
    }
    let row: VaultSecretRow;
    try {
      row = await this.store.vault.create({
        projectId: project.id,
        name: input.name,
        environment: input.environment,
        value: this.secrets.encrypt(input.value),
        description: input.description ?? null,
        userId: user.id,
        now: new Date().toISOString(),
      });
    } catch (error) {
      // Two people adding the same name at once: the unique index decides.
      if (await this.store.vault.findByName(project.id, input.name, input.environment)) {
        throw new ZelyqError("conflict", `${input.name} already exists in ${input.environment}.`);
      }
      throw error;
    }
    await this.changed(user, project, "vault.secret.created", row);
    return (await this.present([row]))[0] as VaultSecret;
  }

  async update(
    user: User,
    projectId: string,
    secretId: string,
    input: VaultSecretUpdate,
  ): Promise<VaultSecret> {
    const { project } = await this.access.requireProject(user, projectId, "editor");
    let row = await this.find(project.id, secretId);
    const now = new Date().toISOString();
    if (input.description !== undefined) {
      row = (await this.store.vault.setDescription(row.id, input.description, user.id, now)) ?? row;
    }
    if (input.value !== undefined) {
      const written = await this.store.vault.setValue(
        row.id,
        this.secrets.encrypt(input.value),
        user.id,
        now,
      );
      if (!written) throw ZelyqError.notFound("Secret", secretId);
      row = written;
    }
    await this.changed(user, project, "vault.secret.updated", row, {
      valueChanged: input.value !== undefined,
    });
    return (await this.present([row]))[0] as VaultSecret;
  }

  async remove(user: User, projectId: string, secretId: string): Promise<void> {
    const { project } = await this.access.requireProject(user, projectId, "editor");
    const row = await this.find(project.id, secretId);
    await this.store.vault.remove(row.id);
    await this.changed(user, project, "vault.secret.deleted", row);
  }

  async reveal(user: User, projectId: string, secretId: string): Promise<{ value: string }> {
    const { project } = await this.access.requireProject(user, projectId, "editor");
    const row = await this.find(project.id, secretId);
    const value = this.secrets.decrypt(row.value);
    if (value === null) throw this.unreadable(row.name);
    // Recorded only once the value is in hand: a failed reveal revealed nothing.
    await this.access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action: "vault.secret.revealed",
      detail: { name: row.name, environment: row.environment, version: row.version },
    });
    return { value };
  }

  async versions(user: User, projectId: string, secretId: string): Promise<VaultSecretVersion[]> {
    await this.access.requireProject(user, projectId, "viewer");
    const row = await this.find(projectId, secretId);
    const versions = await this.store.vault.listVersions(row.id);
    const actors = await this.actors(versions.map((version) => version.createdBy));
    return versions.map((version) => ({
      version: version.version,
      current: version.version === row.version,
      createdBy: version.createdBy ? (actors.get(version.createdBy) ?? null) : null,
      createdAt: version.createdAt,
    }));
  }

  /** Restoring an old value writes it again as the newest version, so the
   * value being replaced stays in the history too. */
  async rollback(
    user: User,
    projectId: string,
    secretId: string,
    version: number,
  ): Promise<VaultSecret> {
    const { project } = await this.access.requireProject(user, projectId, "editor");
    const row = await this.find(project.id, secretId);
    if (version === row.version) throw ZelyqError.badRequest("That is already the current value.");
    const value = await this.store.vault.versionValue(row.id, version);
    if (value === null) throw ZelyqError.notFound("Version", String(version));
    const written = await this.store.vault.setValue(
      row.id,
      value,
      user.id,
      new Date().toISOString(),
    );
    if (!written) throw ZelyqError.notFound("Secret", secretId);
    await this.changed(user, project, "vault.secret.rolled_back", written, { from: version });
    return (await this.present([written]))[0] as VaultSecret;
  }

  async import(user: User, projectId: string, raw: VaultImport): Promise<VaultImportResult> {
    const { project } = await this.access.requireProject(user, projectId, "editor");
    const input = vaultImportSchema.parse(raw);
    const { entries, invalid } = parseDotEnv(input.content);
    if (entries.length === 0 && invalid.length === 0) {
      throw ZelyqError.badRequest("No KEY=VALUE lines were found.");
    }
    const result: VaultImportResult = { created: [], updated: [], skipped: [] };
    for (const line of invalid) result.skipped.push({ name: line, reason: "Not a KEY=VALUE line" });

    const now = new Date().toISOString();
    for (const { name, value } of entries) {
      const checked = vaultSecretNameSchema.safeParse(name);
      if (!checked.success) {
        result.skipped.push({ name, reason: checked.error.issues[0]?.message ?? "Invalid name" });
        continue;
      }
      if (!value) {
        result.skipped.push({ name, reason: "Empty value" });
        continue;
      }
      const existing = await this.store.vault.findByName(project.id, name, input.environment);
      if (existing && !input.overwrite) {
        result.skipped.push({ name, reason: "Already in Vault" });
        continue;
      }
      const encrypted = this.secrets.encrypt(value);
      if (existing) {
        await this.store.vault.setValue(existing.id, encrypted, user.id, now);
        result.updated.push(name);
      } else {
        await this.store.vault.create({
          projectId: project.id,
          name,
          environment: input.environment,
          value: encrypted,
          description: null,
          userId: user.id,
          now,
        });
        result.created.push(name);
      }
    }

    if (result.created.length + result.updated.length > 0) {
      await this.access.recordChange(user, {
        teamId: project.teamId,
        projectId: project.id,
        action: "vault.imported",
        detail: {
          environment: input.environment,
          created: result.created,
          updated: result.updated,
          skipped: result.skipped.length,
        },
      });
      if (input.environment === "development") await this.restartPreview(project.id);
    }
    return result;
  }

  /**
   * Plaintext for one environment — for the project's own runtime only.
   * There is no user here on purpose: the caller has already decided this
   * project is starting, and nothing it returns may travel back to a client.
   * A value the key can no longer read is left out rather than failing the
   * start: the app sees it as unset, which is what it is.
   */
  async environmentFor(
    projectId: string,
    environment: VaultEnvironment,
  ): Promise<Record<string, string>> {
    const env: Record<string, string> = {};
    for (const { name, value } of await this.store.vault.valuesFor(projectId, environment)) {
      const plain = this.secrets.decrypt(value);
      if (plain !== null) env[name] = plain;
    }
    return env;
  }

  /**
   * Changes whenever a secret in this environment is added, removed or given a
   * new value — built from ids and version numbers, so it says nothing about
   * any value. Empty when there are no secrets, which leaves a project that
   * never used Vault with exactly the revision it had before.
   */
  async fingerprint(projectId: string, environment: VaultEnvironment): Promise<string> {
    const rows = await this.store.vault.list(projectId, environment);
    if (rows.length === 0) return "";
    const material = rows
      .map((row) => `${row.id}:${row.version}`)
      .sort()
      .join(",");
    return createHash("sha256").update(material).digest("hex").slice(0, 16);
  }

  /**
   * Moves secrets saved in a project's backend configuration — where they
   * lived before Vault — into Vault. Runs at every start and does nothing
   * once there is nothing left to move.
   *
   * The order is what makes it safe to interrupt: a secret is written to Vault
   * first and removed from the old configuration only afterwards, so a crash
   * between the two leaves it in both places, never in neither. A name that
   * already exists in Vault is not overwritten — what is in Vault is newer.
   */
  async moveBackendSecrets(log: { warn(message: string): void }): Promise<number> {
    let moved = 0;
    for (const [key, encrypted] of Object.entries(await this.store.settings.all())) {
      const match = /^project-backend:(.+):(development|test|production)$/.exec(key);
      if (!match) continue;
      const projectId = match[1] as string;
      const environment = match[2] as VaultEnvironment;

      const raw = this.secrets.decrypt(encrypted);
      if (raw === null) {
        log.warn(`Vault: could not decrypt ${key}; its secrets were left where they are.`);
        continue;
      }
      const stored = JSON.parse(raw) as {
        config: { secrets?: Record<string, string | null> };
        revision: string;
      };
      const old = stored.config.secrets;
      if (!old || Object.keys(old).length === 0) continue;

      const project = await this.store.projects.findById(projectId);
      if (!project) continue; // The settings row outlived its project; nothing can use it.

      const kept: Record<string, string | null> = {};
      const names: string[] = [];
      for (const [name, value] of Object.entries(old)) {
        if (value === null) continue;
        if (!vaultSecretNameSchema.safeParse(name).success) {
          kept[name] = value;
          log.warn(`Vault: ${name} in ${projectId} is not a valid secret name; left in place.`);
          continue;
        }
        if (!(await this.store.vault.findByName(projectId, name, environment))) {
          await this.store.vault.create({
            projectId,
            name,
            environment,
            value: this.secrets.encrypt(value),
            description: "Moved from the backend configuration",
            userId: null,
            now: new Date().toISOString(),
          });
          names.push(name);
          moved++;
        }
      }

      const remaining = { ...stored, config: { ...stored.config } };
      if (Object.keys(kept).length > 0) remaining.config.secrets = kept;
      else delete remaining.config.secrets;
      await this.store.settings.set(key, this.secrets.encrypt(JSON.stringify(remaining)));

      if (names.length > 0) {
        await this.store.auditLog.record({
          id: newId("audit"),
          teamId: project.teamId,
          projectId,
          userId: null,
          actorName: "Zelyq",
          actorEmail: "",
          action: "vault.migrated",
          detail: { environment, names },
          createdAt: new Date().toISOString(),
        });
      }
    }
    return moved;
  }

  /** What the agent may know: names, and where each is set. Never a value. */
  async namesFor(projectId: string): Promise<{ name: string; environments: VaultEnvironment[] }[]> {
    const byName = new Map<string, VaultEnvironment[]>();
    for (const row of await this.store.vault.list(projectId)) {
      const list = byName.get(row.name) ?? [];
      list.push(row.environment as VaultEnvironment);
      byName.set(row.name, list);
    }
    return [...byName].map(([name, environments]) => ({ name, environments }));
  }

  private async find(projectId: string, secretId: string): Promise<VaultSecretRow> {
    const row = await this.store.vault.findById(secretId);
    // Another project's secret answers exactly like a missing one.
    if (!row || row.projectId !== projectId) throw ZelyqError.notFound("Secret", secretId);
    return row;
  }

  private async changed(
    user: User,
    project: Project,
    action:
      | "vault.secret.created"
      | "vault.secret.updated"
      | "vault.secret.deleted"
      | "vault.secret.rolled_back",
    row: VaultSecretSummaryRow,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action,
      detail: { name: row.name, environment: row.environment, ...extra },
    });
    // Only a change to what the app's environment holds needs the preview
    // restarted; a new description does not.
    if (row.environment === "development" && extra.valueChanged !== false) {
      await this.restartPreview(project.id);
    }
  }

  /**
   * The development values are what the running preview was started with, so
   * a change stops it; the next start picks the new ones up. Same rule as
   * saving the backend configuration.
   */
  private async restartPreview(projectId: string): Promise<void> {
    await this.runtime.stopPreview(projectId).catch(() => undefined);
  }

  private unreadable(name: string): ZelyqError {
    return ZelyqError.badRequest(
      `${name} cannot be decrypted with this instance's encryption key. Set its value again.`,
    );
  }

  private async present(rows: VaultSecretSummaryRow[]): Promise<VaultSecret[]> {
    const actors = await this.actors(rows.flatMap((row) => [row.createdBy, row.updatedBy]));
    const actor = (id: string | null) => (id ? (actors.get(id) ?? null) : null);
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      environment: row.environment as VaultEnvironment,
      description: row.description,
      version: row.version,
      createdBy: actor(row.createdBy),
      updatedBy: actor(row.updatedBy),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  private async actors(ids: (string | null)[]): Promise<Map<string, VaultActor>> {
    const found = new Map<string, VaultActor>();
    for (const id of new Set(ids.filter((id): id is string => Boolean(id)))) {
      const user = await this.store.users.findById(id);
      if (user) found.set(id, { id: user.id, name: user.name });
    }
    return found;
  }
}
