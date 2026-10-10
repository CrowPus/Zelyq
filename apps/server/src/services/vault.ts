import {
  parseDotEnv,
  type Role,
  roleAtLeast,
  type User,
  type VaultActor,
  type VaultEntry,
  type VaultEntryCreate,
  type VaultEntryUpdate,
  type VaultImport,
  type VaultImportResult,
  type VaultScope,
  type VaultUsage,
  type VaultVersion,
  vaultImportSchema,
  vaultNameSchema,
  ZelyqError,
} from "@zelyq/core";
import type { Store, VaultEntryRow, VaultEntrySummaryRow, VersionRow } from "@zelyq/db";
import type { AccessControl } from "./access.js";
import type { SecretBox } from "./secrets.js";

type VaultAction =
  | "vault.secret.created"
  | "vault.secret.updated"
  | "vault.secret.deleted"
  | "vault.secret.revealed"
  | "vault.secret.rolled_back"
  | "vault.imported";

/** What the caller may do in one Vault, decided once per request. */
interface Grant {
  scopeKey: string;
  teamId: string | null;
  /** May create and change unprotected secrets, and reveal them. */
  canWrite: boolean;
  /** May delete, and do anything at all to a Protected secret. */
  canAdmin: boolean;
}

/** Hooks other modules attach so Vault can say where a secret is used and
 * tell them when one changes. Set once at start-up. */
export interface VaultListeners {
  /** Settings credentials pointing into a Vault ("instance" or a team id). */
  settingUsages?: (scope: string) => Promise<{ key: string; label: string; vaultName: string }[]>;
  /** A team secret's value changed or it was removed. */
  teamEntryChanged?: (teamId: string, name: string) => Promise<void>;
}

/**
 * Vault: a team's secrets, and the instance's own credentials, as a module of
 * its own. Everything here is either value-free (lists, history, where-used)
 * or decrypts for exactly one purpose: an audited reveal to a person, or a
 * reference being resolved for the place that uses it.
 *
 * Permissions are team roles, as everywhere else in Zelyq:
 *   viewer   — names, history, where each secret is used
 *   editor   — create and change unprotected secrets; reveal them (audited)
 *   admin+   — delete; anything at all on a Protected secret
 * The instance Vault is for instance administrators only.
 */
export class VaultService {
  readonly listeners: VaultListeners = {};

  constructor(
    private readonly store: Store,
    private readonly secrets: SecretBox,
    private readonly access: AccessControl,
  ) {}

  async list(user: User, scope: VaultScope): Promise<VaultEntry[]> {
    const grant = await this.grant(user, scope, "viewer");
    return this.present(grant, await this.store.vault.list(grant.scopeKey));
  }

  async create(user: User, scope: VaultScope, input: VaultEntryCreate): Promise<VaultEntry> {
    const grant = await this.grant(user, scope, "editor");
    if (input.protected && !grant.canAdmin) throw this.adminOnly("mark a secret Protected");
    if (await this.store.vault.findByName(grant.scopeKey, input.name)) {
      throw new ZelyqError(
        "conflict",
        `${input.name} is already in this Vault. Change it instead.`,
      );
    }
    let row: VaultEntryRow;
    try {
      row = await this.store.vault.create({
        scopeKey: grant.scopeKey,
        teamId: grant.teamId,
        name: input.name,
        value: this.secrets.encrypt(input.value),
        description: input.description ?? null,
        protected: input.protected ?? false,
        userId: user.id,
        now: new Date().toISOString(),
      });
    } catch (error) {
      // Two people adding the same name at once: the unique index decides.
      if (await this.store.vault.findByName(grant.scopeKey, input.name)) {
        throw new ZelyqError("conflict", `${input.name} is already in this Vault.`);
      }
      throw error;
    }
    await this.record(user, grant, "vault.secret.created", row);
    return (await this.present(grant, [row]))[0] as VaultEntry;
  }

  async update(
    user: User,
    scope: VaultScope,
    entryId: string,
    input: VaultEntryUpdate,
  ): Promise<VaultEntry> {
    const grant = await this.grant(user, scope, "editor");
    let row = await this.find(grant, entryId);
    this.requireWrite(grant, row);
    if (input.protected !== undefined && input.protected !== row.protected && !grant.canAdmin) {
      throw this.adminOnly("change whether a secret is Protected");
    }
    const now = new Date().toISOString();
    if (input.description !== undefined || input.protected !== undefined) {
      row =
        (await this.store.vault.setDetails(
          row.id,
          {
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.protected !== undefined ? { protected: input.protected } : {}),
          },
          user.id,
          now,
        )) ?? row;
    }
    if (input.value !== undefined) {
      const written = await this.store.vault.setValue(
        row.id,
        this.secrets.encrypt(input.value),
        user.id,
        now,
      );
      if (!written) throw ZelyqError.notFound("Secret", entryId);
      row = written;
    }
    await this.record(user, grant, "vault.secret.updated", row, {
      valueChanged: input.value !== undefined,
      ...(input.protected !== undefined ? { protected: input.protected } : {}),
    });
    if (input.value !== undefined) await this.changed(grant, row.name);
    return (await this.present(grant, [row]))[0] as VaultEntry;
  }

  async remove(user: User, scope: VaultScope, entryId: string): Promise<void> {
    const grant = await this.grant(user, scope, "viewer");
    if (!grant.canAdmin) throw this.adminOnly("delete a secret");
    const row = await this.find(grant, entryId);
    await this.store.vault.remove(row.id);
    await this.record(user, grant, "vault.secret.deleted", row);
    await this.changed(grant, row.name);
  }

  async reveal(user: User, scope: VaultScope, entryId: string): Promise<{ value: string }> {
    const grant = await this.grant(user, scope, "editor");
    const row = await this.find(grant, entryId);
    this.requireWrite(grant, row);
    const value = this.secrets.decrypt(row.value);
    if (value === null) throw this.unreadable(row.name);
    // Recorded once the value is in hand: a failed reveal revealed nothing.
    await this.record(user, grant, "vault.secret.revealed", row, { version: row.version });
    return { value };
  }

  async versions(user: User, scope: VaultScope, entryId: string): Promise<VaultVersion[]> {
    const grant = await this.grant(user, scope, "viewer");
    const row = await this.find(grant, entryId);
    return this.presentVersions(await this.store.vault.listVersions(row.id), row.version);
  }

  /** Restoring writes the old value again as the newest version, so the value
   * being replaced stays in the history too. */
  async rollback(
    user: User,
    scope: VaultScope,
    entryId: string,
    version: number,
  ): Promise<VaultEntry> {
    const grant = await this.grant(user, scope, "editor");
    const row = await this.find(grant, entryId);
    this.requireWrite(grant, row);
    if (version === row.version) throw ZelyqError.badRequest("That is already the current value.");
    const value = await this.store.vault.versionValue(row.id, version);
    if (value === null) throw ZelyqError.notFound("Version", String(version));
    const written = await this.store.vault.setValue(
      row.id,
      value,
      user.id,
      new Date().toISOString(),
    );
    if (!written) throw ZelyqError.notFound("Secret", entryId);
    await this.record(user, grant, "vault.secret.rolled_back", written, { from: version });
    await this.changed(grant, written.name);
    return (await this.present(grant, [written]))[0] as VaultEntry;
  }

  /** A one-time way to move existing keys in. Protected secrets are never
   * overwritten from a paste unless the person may change them anyway. */
  async import(user: User, scope: VaultScope, raw: VaultImport): Promise<VaultImportResult> {
    const grant = await this.grant(user, scope, "editor");
    const input = vaultImportSchema.parse(raw);
    const { entries, invalid } = parseDotEnv(input.content);
    if (entries.length === 0 && invalid.length === 0) {
      throw ZelyqError.badRequest("No KEY=VALUE lines were found.");
    }
    const result: VaultImportResult = { created: [], updated: [], skipped: [] };
    for (const line of invalid) result.skipped.push({ name: line, reason: "Not a KEY=VALUE line" });

    const now = new Date().toISOString();
    for (const { name, value } of entries) {
      const checked = vaultNameSchema.safeParse(name);
      if (!checked.success) {
        result.skipped.push({ name, reason: checked.error.issues[0]?.message ?? "Invalid name" });
        continue;
      }
      if (!value) {
        result.skipped.push({ name, reason: "Empty value" });
        continue;
      }
      const existing = await this.store.vault.findByName(grant.scopeKey, name);
      if (existing && !input.overwrite) {
        result.skipped.push({ name, reason: "Already in Vault" });
        continue;
      }
      if (existing?.protected && !grant.canAdmin) {
        result.skipped.push({ name, reason: "Protected: only an admin or owner can change it" });
        continue;
      }
      const encrypted = this.secrets.encrypt(value);
      if (existing) {
        await this.store.vault.setValue(existing.id, encrypted, user.id, now);
        result.updated.push(name);
        await this.changed(grant, name);
      } else {
        await this.store.vault.create({
          scopeKey: grant.scopeKey,
          teamId: grant.teamId,
          name,
          value: encrypted,
          description: null,
          protected: false,
          userId: user.id,
          now,
        });
        result.created.push(name);
      }
    }
    if (result.created.length + result.updated.length > 0) {
      await this.access.recordChange(user, {
        teamId: grant.teamId,
        action: "vault.imported",
        detail: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped.length,
        },
      });
    }
    return result;
  }

  async activity(user: User, scope: VaultScope) {
    const grant = await this.grant(user, scope, "viewer");
    return this.store.auditLog.listVaultActivity(grant.teamId);
  }

  /** The names a person may pick in a "From Vault" dropdown, with whether each
   * is Protected — for the place they are picking from. */
  async choices(
    user: User,
    scope: VaultScope,
  ): Promise<{ name: string; protected: boolean; selectable: boolean }[]> {
    const grant = await this.grant(user, scope, "viewer");
    return (await this.store.vault.list(grant.scopeKey)).map((row) => ({
      name: row.name,
      protected: row.protected,
      selectable: row.protected ? grant.canAdmin : grant.canWrite,
    }));
  }

  /**
   * Plaintext for references being resolved — no user here on purpose: the
   * caller has already decided the place asking (a project's runtime, a
   * Settings field, a service key) may use these, and nothing it returns goes
   * back to a person. A missing name, or one the key can no longer read, is
   * absent from the result rather than failing the caller.
   */
  async resolve(scopeKey: string, names: string[]): Promise<Map<string, string>> {
    const values = new Map<string, string>();
    for (const row of await this.store.vault.findByNames(scopeKey, [...new Set(names)])) {
      const plain = this.secrets.decrypt(row.value);
      if (plain !== null) values.set(row.name, plain);
    }
    return values;
  }

  /** Ciphertext for a value arriving some other way than a person's form —
   * a service key's write. Same box, same format. */
  encrypt(value: string): string {
    return this.secrets.encrypt(value);
  }

  /** Whether `user` may point something at this secret: editor for an
   * ordinary one, admin or owner for a Protected one. Throws otherwise. */
  async requireUse(user: User, scope: VaultScope, name: string): Promise<VaultEntrySummaryRow> {
    const grant = await this.grant(user, scope, "editor");
    const row = await this.store.vault.findByName(grant.scopeKey, name);
    if (!row) throw ZelyqError.badRequest(`${name} is not in Vault.`);
    this.requireWrite(grant, row);
    return row;
  }

  // ---------------------------------------------------------------- helpers

  private async grant(user: User, scope: VaultScope, minimum: Role): Promise<Grant> {
    if (scope.kind === "instance") {
      if (user.instanceRole !== "admin") {
        throw new ZelyqError(
          "forbidden",
          "Only an instance administrator can use the instance Vault.",
        );
      }
      return { scopeKey: "instance", teamId: null, canWrite: true, canAdmin: true };
    }
    const role = await this.access.requireTeamRole(user, scope.teamId, minimum);
    return {
      scopeKey: scope.teamId,
      teamId: scope.teamId,
      canWrite: roleAtLeast(role, "editor"),
      canAdmin: roleAtLeast(role, "admin"),
    };
  }

  private requireWrite(grant: Grant, row: VaultEntrySummaryRow): void {
    if (row.protected && !grant.canAdmin) {
      throw this.adminOnly(`use ${row.name}, which is Protected`);
    }
    if (!grant.canWrite) {
      throw new ZelyqError("forbidden", "This needs the editor role or higher.");
    }
  }

  private async find(grant: Grant, entryId: string): Promise<VaultEntryRow> {
    const row = await this.store.vault.findById(entryId);
    // Another Vault's secret answers exactly like a missing one.
    if (!row || row.scopeKey !== grant.scopeKey) throw ZelyqError.notFound("Secret", entryId);
    return row;
  }

  private adminOnly(what: string): ZelyqError {
    return new ZelyqError("forbidden", `Only an admin or owner can ${what}.`);
  }

  private unreadable(name: string): ZelyqError {
    return ZelyqError.badRequest(
      `${name} cannot be decrypted with this instance's encryption key. Set its value again.`,
    );
  }

  private async record(
    user: User,
    grant: Grant,
    action: VaultAction,
    row: VaultEntrySummaryRow,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.access.recordChange(user, {
      teamId: grant.teamId,
      action,
      detail: { name: row.name, scope: grant.teamId ? "team" : "instance", ...extra },
    });
  }

  private async changed(grant: Grant, name: string): Promise<void> {
    if (grant.teamId) await this.listeners.teamEntryChanged?.(grant.teamId, name);
  }

  private async usages(grant: Grant): Promise<Map<string, VaultUsage[]>> {
    const byName = new Map<string, VaultUsage[]>();
    const add = (name: string, usage: VaultUsage) =>
      byName.set(name, [...(byName.get(name) ?? []), usage]);
    if (grant.teamId) {
      for (const use of await this.store.vault.teamUsages(grant.teamId)) {
        add(use.vaultName, {
          kind: "project",
          projectId: use.projectId,
          projectName: use.projectName,
          variable: use.variable,
        });
      }
    }
    for (const use of (await this.listeners.settingUsages?.(grant.scopeKey)) ?? []) {
      add(use.vaultName, { kind: "setting", key: use.key, label: use.label });
    }
    return byName;
  }

  private async present(grant: Grant, rows: VaultEntrySummaryRow[]): Promise<VaultEntry[]> {
    const [actors, usages] = await Promise.all([
      this.actors(rows.flatMap((row) => [row.createdBy, row.updatedBy])),
      this.usages(grant),
    ]);
    const actor = (id: string | null) => (id ? (actors.get(id) ?? null) : null);
    return rows.map((row) => ({
      id: row.id,
      scope: grant.teamId ? "team" : "instance",
      teamId: grant.teamId,
      name: row.name,
      description: row.description,
      protected: row.protected,
      version: row.version,
      usedBy: usages.get(row.name) ?? [],
      createdBy: actor(row.createdBy),
      updatedBy: actor(row.updatedBy),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async presentVersions(versions: VersionRow[], current: number): Promise<VaultVersion[]> {
    const actors = await this.actors(versions.map((version) => version.createdBy));
    return versions.map((version) => ({
      version: version.version,
      current: version.version === current,
      createdBy: version.createdBy ? (actors.get(version.createdBy) ?? null) : null,
      createdAt: version.createdAt,
    }));
  }

  async actors(ids: (string | null)[]): Promise<Map<string, VaultActor>> {
    const found = new Map<string, VaultActor>();
    for (const id of new Set(ids.filter((id): id is string => Boolean(id)))) {
      const user = await this.store.users.findById(id);
      if (user) found.set(id, { id: user.id, name: user.name });
    }
    return found;
  }
}
