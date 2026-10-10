import { createHash } from "node:crypto";
import {
  newId,
  type Project,
  type ProjectVariable,
  type ProjectVariableCreate,
  type ProjectVariableUpdate,
  parseDotEnv,
  type User,
  type VaultImport,
  type VaultImportResult,
  type VaultVersion,
  variableNameSchema,
  vaultImportSchema,
  ZelyqError,
} from "@zelyq/core";
import type { ProjectVariableRow, ProjectVariableSummaryRow, Store } from "@zelyq/db";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { AccessControl } from "./access.js";
import type { BackendSecretSource } from "./project-backend.js";
import type { SecretBox } from "./secrets.js";
import type { VaultService } from "./vault.js";

type VariableAction =
  | "project.variable.created"
  | "project.variable.updated"
  | "project.variable.deleted"
  | "project.variable.revealed"
  | "project.variable.rolled_back";

/**
 * What a coding project's app is given. Each variable is typed for this
 * project, or points at a secret in the project's team Vault — the user's
 * choice, per variable. A Vault variable is resolved when the app starts, so
 * a change in Vault reaches every app that uses it.
 *
 * Project roles decide who may change a project's variables (editor) and see
 * them (viewer). Pointing a variable at Vault, or revealing one that points
 * there, additionally needs what Vault itself asks for that secret: editor
 * for an ordinary one, admin or owner for a Protected one.
 */
export class ProjectVariableService implements BackendSecretSource {
  /** Called after a project's variables change — the Supabase sync hangs here. */
  onChanged?: (projectId: string) => Promise<void>;

  constructor(
    private readonly store: Store,
    private readonly secrets: SecretBox,
    private readonly access: AccessControl,
    private readonly vault: VaultService,
    private readonly runtime: RuntimeDriver,
  ) {}

  async list(user: User, projectId: string): Promise<ProjectVariable[]> {
    const { project } = await this.access.requireProject(user, projectId, "viewer");
    return this.present(project, await this.store.vault.variables.list(project.id));
  }

  async create(
    user: User,
    projectId: string,
    input: ProjectVariableCreate,
  ): Promise<ProjectVariable> {
    const { project } = await this.access.requireProject(user, projectId, "editor");
    if (await this.store.vault.variables.findByName(project.id, input.name)) {
      throw new ZelyqError("conflict", `${input.name} already exists in this project. Change it.`);
    }
    const fromVault = "vaultName" in input;
    if (fromVault) await this.vault.requireUse(user, teamScope(project), input.vaultName);
    const row = await this.store.vault.variables.create({
      projectId: project.id,
      name: input.name,
      source: fromVault ? "vault" : "direct",
      value: fromVault ? null : this.secrets.encrypt(input.value),
      vaultName: fromVault ? input.vaultName : null,
      description: input.description ?? null,
      userId: user.id,
      now: new Date().toISOString(),
    });
    await this.changed(user, project, "project.variable.created", row);
    return (await this.present(project, [row]))[0] as ProjectVariable;
  }

  async update(
    user: User,
    projectId: string,
    variableId: string,
    input: ProjectVariableUpdate,
  ): Promise<ProjectVariable> {
    const { project } = await this.access.requireProject(user, projectId, "editor");
    let row = await this.find(project.id, variableId);
    const now = new Date().toISOString();
    if (input.description !== undefined) {
      row =
        (await this.store.vault.variables.setDescription(
          row.id,
          input.description,
          user.id,
          now,
        )) ?? row;
    }
    let valueChanged = false;
    if (input.value !== undefined) {
      row =
        (await this.store.vault.variables.setDirectValue(
          row.id,
          this.secrets.encrypt(input.value),
          user.id,
          now,
        )) ?? row;
      valueChanged = true;
    }
    if (input.vaultName !== undefined) {
      await this.vault.requireUse(user, teamScope(project), input.vaultName);
      row =
        (await this.store.vault.variables.setVaultSource(row.id, input.vaultName, user.id, now)) ??
        row;
      valueChanged = true;
    }
    await this.changed(user, project, "project.variable.updated", row, {
      valueChanged,
      source: row.source,
      ...(row.vaultName ? { vaultName: row.vaultName } : {}),
    });
    return (await this.present(project, [row]))[0] as ProjectVariable;
  }

  async remove(user: User, projectId: string, variableId: string): Promise<void> {
    const { project } = await this.access.requireProject(user, projectId, "editor");
    const row = await this.find(project.id, variableId);
    await this.store.vault.variables.remove(row.id);
    await this.changed(user, project, "project.variable.deleted", row);
  }

  async reveal(user: User, projectId: string, variableId: string): Promise<{ value: string }> {
    const { project } = await this.access.requireProject(user, projectId, "editor");
    const row = await this.find(project.id, variableId);
    let value: string | null;
    if (row.source === "vault" && row.vaultName) {
      // Seeing a Vault secret through a project is still seeing a Vault
      // secret: the same rule as revealing it in Vault.
      await this.vault.requireUse(user, teamScope(project), row.vaultName);
      value =
        (await this.vault.resolve(project.teamId, [row.vaultName])).get(row.vaultName) ?? null;
      if (value === null) throw ZelyqError.badRequest(`${row.vaultName} is no longer in Vault.`);
    } else {
      value = row.value === null ? null : this.secrets.decrypt(row.value);
      if (value === null) {
        throw ZelyqError.badRequest(
          `${row.name} cannot be decrypted with this instance's encryption key. Set it again.`,
        );
      }
    }
    await this.audit(user, project, "project.variable.revealed", row, { source: row.source });
    return { value };
  }

  async versions(user: User, projectId: string, variableId: string): Promise<VaultVersion[]> {
    const { project } = await this.access.requireProject(user, projectId, "viewer");
    const row = await this.find(project.id, variableId);
    const current = row.source === "direct" ? row.version : -1;
    return this.vault.presentVersions(
      await this.store.vault.variables.listVersions(row.id),
      current,
    );
  }

  /** Restores a typed value as the newest version — also how a variable that
   * was switched to Vault goes back to the value it had. */
  async rollback(
    user: User,
    projectId: string,
    variableId: string,
    version: number,
  ): Promise<ProjectVariable> {
    const { project } = await this.access.requireProject(user, projectId, "editor");
    const row = await this.find(project.id, variableId);
    if (row.source === "direct" && version === row.version) {
      throw ZelyqError.badRequest("That is already the current value.");
    }
    const value = await this.store.vault.variables.versionValue(row.id, version);
    if (value === null) throw ZelyqError.notFound("Version", String(version));
    const written = await this.store.vault.variables.setDirectValue(
      row.id,
      value,
      user.id,
      new Date().toISOString(),
    );
    if (!written) throw ZelyqError.notFound("Variable", variableId);
    await this.changed(user, project, "project.variable.rolled_back", written, { from: version });
    return (await this.present(project, [written]))[0] as ProjectVariable;
  }

  /** Typed variables from a pasted `.env` — a one-time way to move keys in. */
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
      const checked = variableNameSchema.safeParse(name);
      if (!checked.success) {
        result.skipped.push({ name, reason: checked.error.issues[0]?.message ?? "Invalid name" });
        continue;
      }
      if (!value) {
        result.skipped.push({ name, reason: "Empty value" });
        continue;
      }
      const existing = await this.store.vault.variables.findByName(project.id, name);
      if (existing && !input.overwrite) {
        result.skipped.push({ name, reason: "Already a variable in this project" });
        continue;
      }
      const encrypted = this.secrets.encrypt(value);
      if (existing) {
        await this.store.vault.variables.setDirectValue(existing.id, encrypted, user.id, now);
        result.updated.push(name);
      } else {
        await this.store.vault.variables.create({
          projectId: project.id,
          name,
          source: "direct",
          value: encrypted,
          vaultName: null,
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
        action: "project.variables_imported",
        detail: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped.length,
        },
      });
      await this.afterChange(project.id);
    }
    return result;
  }

  // ------------------------------------------------- the running app's side

  /**
   * Plaintext for the project's own runtime. No user here on purpose: the
   * project is already starting, and nothing returned goes back to a client.
   * A Vault variable whose secret is gone, or a value the key cannot read, is
   * left out — the app sees it as unset, which is what it is.
   */
  async environmentFor(projectId: string): Promise<Record<string, string>> {
    const project = await this.store.projects.findById(projectId);
    if (!project) return {};
    const rows = await this.store.vault.variables.listWithValues(projectId);
    const fromVault = await this.vault.resolve(
      project.teamId,
      rows.flatMap((row) => (row.source === "vault" && row.vaultName ? [row.vaultName] : [])),
    );
    const env: Record<string, string> = {};
    for (const row of rows) {
      const value =
        row.source === "vault"
          ? (row.vaultName && fromVault.get(row.vaultName)) || null
          : row.value === null
            ? null
            : this.secrets.decrypt(row.value);
      if (value !== null) env[row.name] = value;
    }
    return env;
  }

  /**
   * Changes whenever what the app would be given changes: a variable added,
   * removed, retyped or repointed, or a Vault secret it points at given a new
   * value. Built from ids and version numbers — it says nothing about values.
   * Empty when there is nothing, so a project with no variables keeps the
   * revision it had.
   */
  async fingerprint(projectId: string): Promise<string> {
    const project = await this.store.projects.findById(projectId);
    if (!project) return "";
    const rows = await this.store.vault.variables.list(projectId);
    if (rows.length === 0) return "";
    const names = rows.flatMap((row) =>
      row.source === "vault" && row.vaultName ? [row.vaultName] : [],
    );
    const entries = await this.store.vault.findByNames(project.teamId, names);
    const material = [
      ...rows.map((row) => `v:${row.id}:${row.version}:${row.source}:${row.vaultName ?? ""}`),
      ...entries.map((entry) => `e:${entry.id}:${entry.version}`),
    ]
      .sort()
      .join(",");
    return createHash("sha256").update(material).digest("hex").slice(0, 16);
  }

  /** What the agent may know: names, and whether each will reach the app. */
  async namesFor(projectId: string): Promise<{ name: string; source: string; missing: boolean }[]> {
    const project = await this.store.projects.findById(projectId);
    if (!project) return [];
    return (await this.present(project, await this.store.vault.variables.list(projectId))).map(
      (variable) => ({ name: variable.name, source: variable.source, missing: variable.missing }),
    );
  }

  /** A team Vault secret changed: every app of that team pointing at it is
   * stale, so its preview stops and any sync runs. */
  async vaultEntryChanged(teamId: string, name: string): Promise<void> {
    const projectIds = new Set(
      (await this.store.vault.teamUsages(teamId))
        .filter((use) => use.vaultName === name)
        .map((use) => use.projectId),
    );
    for (const projectId of projectIds) await this.afterChange(projectId);
  }

  /**
   * Moves secrets saved in a project's backend configuration — where they
   * lived before Vault — into that project's typed variables. Runs at every
   * start and does nothing once there is nothing left to move.
   *
   * The order is what makes it safe to interrupt: a variable is written first
   * and the old copy removed afterwards, so a crash between the two leaves it
   * in both places, never in neither. A name that already exists is not
   * overwritten — it is newer.
   *
   * Only development values ever reached an app, so those become the
   * project's variables. Test and production values reached nothing; they go
   * into the team Vault as Protected secrets (kept, given to no app, visible
   * to admins and owners only), named `NAME__PRODUCTION__<project>-<id>`.
   */
  async moveBackendSecrets(log: { warn(message: string): void }): Promise<number> {
    let moved = 0;
    for (const [key, encrypted] of Object.entries(await this.store.settings.all())) {
      const match = /^project-backend:(.+):(development|test|production)$/.exec(key);
      if (!match) continue;
      const projectId = match[1] as string;
      const environment = match[2] as string;
      const raw = this.secrets.decrypt(encrypted);
      if (raw === null) {
        log.warn(`Variables: could not decrypt ${key}; its secrets were left where they are.`);
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

      const team = await this.store.teams.findById(project.teamId);
      const kept: Record<string, string | null> = {};
      const names: string[] = [];
      const now = new Date().toISOString();
      for (const [oldName, value] of Object.entries(old)) {
        if (value === null) continue;
        if (!variableNameSchema.safeParse(oldName).success) {
          kept[oldName] = value;
          log.warn(
            `Variables: ${oldName} in ${projectId} is not a valid variable name; left in place.`,
          );
          continue;
        }
        const suffix = environment.toUpperCase();
        const idPart = project.id.replace(/^[a-z]+_/, "").slice(0, 8);
        if (environment !== "development" && team) {
          const name = `${oldName}__${suffix}__${project.slug}-${idPart}`;
          if (!(await this.store.vault.findByName(team.id, name))) {
            await this.store.vault.create({
              scopeKey: team.id,
              teamId: team.id,
              name,
              value: this.secrets.encrypt(value),
              description: `Moved from ${environment} in project ${project.name}`,
              protected: true,
              userId: null,
              now,
            });
            names.push(name);
            moved++;
          }
          continue;
        }
        // Development — or a project no team has adopted yet, which has no
        // team Vault, so its other values stay with it under a suffixed name.
        const name =
          environment === "development" ? oldName : `${oldName}__${suffix}_${idPart.toUpperCase()}`;
        if (!(await this.store.vault.variables.findByName(projectId, name))) {
          await this.store.vault.variables.create({
            projectId,
            name,
            source: "direct",
            value: this.secrets.encrypt(value),
            vaultName: null,
            description: "Moved from the backend configuration",
            userId: null,
            now,
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
          action: "project.variables_migrated",
          detail: { names },
          createdAt: new Date().toISOString(),
        });
      }
    }
    return moved;
  }

  // ---------------------------------------------------------------- helpers

  private async find(projectId: string, variableId: string): Promise<ProjectVariableRow> {
    const row = await this.store.vault.variables.findById(variableId);
    if (!row || row.projectId !== projectId) throw ZelyqError.notFound("Variable", variableId);
    return row;
  }

  private async audit(
    user: User,
    project: Project,
    action: VariableAction,
    row: ProjectVariableSummaryRow,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action,
      detail: { name: row.name, ...extra },
    });
  }

  private async changed(
    user: User,
    project: Project,
    action: VariableAction,
    row: ProjectVariableSummaryRow,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit(user, project, action, row, extra);
    // A new note changes nothing the app is given.
    if (extra.valueChanged !== false) await this.afterChange(project.id);
  }

  /** What the app was started with is stale: stop its preview (the next
   * start picks the new values up) and let listeners sync. */
  private async afterChange(projectId: string): Promise<void> {
    await this.runtime.stopPreview(projectId).catch(() => undefined);
    await this.onChanged?.(projectId).catch(() => undefined);
  }

  private async present(
    project: Project,
    rows: ProjectVariableSummaryRow[],
  ): Promise<ProjectVariable[]> {
    const names = rows.flatMap((row) =>
      row.source === "vault" && row.vaultName ? [row.vaultName] : [],
    );
    const entries = new Map(
      (await this.store.vault.findByNames(project.teamId, names)).map((entry) => [
        entry.name,
        entry,
      ]),
    );
    const actors = await this.vault.actors(rows.flatMap((row) => [row.createdBy, row.updatedBy]));
    const actor = (id: string | null) => (id ? (actors.get(id) ?? null) : null);
    return rows.map((row) => {
      const entry = row.vaultName ? entries.get(row.vaultName) : undefined;
      return {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        source: row.source === "vault" ? "vault" : "direct",
        vaultName: row.vaultName,
        missing: row.source === "vault" && !entry,
        protected: Boolean(entry?.protected),
        description: row.description,
        version: row.version,
        createdBy: actor(row.createdBy),
        updatedBy: actor(row.updatedBy),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }
}

function teamScope(project: Project) {
  return { kind: "team", teamId: project.teamId } as const;
}
