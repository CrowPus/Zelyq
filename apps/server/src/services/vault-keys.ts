import { createHash, randomBytes } from "node:crypto";
import { BlockList, isIP } from "node:net";
import {
  matchesNamePattern,
  newId,
  type User,
  type VaultKeyScope,
  type VaultServiceKey,
  type VaultServiceKeyCreate,
  type VaultServiceKeyCreated,
  vaultServiceKeyCreateSchema,
  ZelyqError,
} from "@zelyq/core";
import type { Store, VaultServiceKeyRow } from "@zelyq/db";
import type { AccessControl } from "./access.js";
import type { VaultService } from "./vault.js";

/** What a request authenticated with a service key may do. */
export interface KeyContext {
  key: VaultServiceKeyRow;
  scopes: VaultKeyScope[];
  namePatterns: string[] | null;
  ip: string;
}

/**
 * Service keys: machine access to one team's Vault from outside Zelyq — a
 * server, a CI job, a Kubernetes cluster. One key per system, never one per
 * secret. A key is shown once and stored only as a SHA-256 hash, which is
 * enough for 256 random bits: there is nothing to guess.
 *
 * Only admins and owners manage keys, because a key can read Protected
 * secrets that match its patterns.
 */
export class VaultKeyService {
  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
    private readonly vault: VaultService,
  ) {}

  async list(user: User, teamId: string): Promise<VaultServiceKey[]> {
    await this.access.requireTeamRole(user, teamId, "admin");
    return this.present(await this.store.vault.keys.listForTeam(teamId));
  }

  async create(
    user: User,
    teamId: string,
    raw: VaultServiceKeyCreate,
  ): Promise<VaultServiceKeyCreated> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const input = vaultServiceKeyCreateSchema.parse(raw);
    for (const entry of input.allowedIps ?? []) {
      if (!parseCidr(entry)) {
        throw ZelyqError.badRequest(
          `${entry} is not an IP address or CIDR range (e.g. 203.0.113.0/24).`,
        );
      }
    }
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
      throw ZelyqError.badRequest("The expiry has to be in the future.");
    }
    const created = await this.insert(user, teamId, {
      name: input.name,
      scopes: [...new Set(input.scopes)],
      namePatterns: input.namePatterns?.length ? input.namePatterns : null,
      allowedIps: input.allowedIps?.length ? input.allowedIps : null,
      expiresAt: input.expiresAt ?? null,
    });
    await this.access.recordChange(user, {
      teamId,
      action: "vault.key.created",
      detail: { label: input.name, key: created.key.keyPrefix, scopes: created.key.scopes },
    });
    return created;
  }

  /** A new key with the same settings; the old one stops working at once. */
  async rotate(user: User, teamId: string, keyId: string): Promise<VaultServiceKeyCreated> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const old = await this.find(teamId, keyId);
    if (old.revokedAt) throw ZelyqError.badRequest("That key is already revoked.");
    const created = await this.insert(user, teamId, {
      name: old.name,
      scopes: JSON.parse(old.scopes),
      namePatterns: old.namePatterns ? JSON.parse(old.namePatterns) : null,
      allowedIps: old.allowedIps ? JSON.parse(old.allowedIps) : null,
      expiresAt: old.expiresAt,
    });
    await this.store.vault.keys.revoke(old.id, new Date().toISOString());
    await this.access.recordChange(user, {
      teamId,
      action: "vault.key.rotated",
      detail: { label: old.name, key: created.key.keyPrefix, replaced: old.keyPrefix },
    });
    return created;
  }

  async revoke(user: User, teamId: string, keyId: string): Promise<VaultServiceKey> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const key = await this.find(teamId, keyId);
    const revoked = await this.store.vault.keys.revoke(key.id, new Date().toISOString());
    await this.access.recordChange(user, {
      teamId,
      action: "vault.key.revoked",
      detail: { label: key.name, key: key.keyPrefix },
    });
    return (await this.present([revoked ?? key]))[0] as VaultServiceKey;
  }

  /**
   * Who is calling. Every refusal says why — a person setting up CI needs to
   * know whether to fix the key, the IP or the clock — and none of them says
   * anything about which secrets exist.
   */
  async authenticate(header: string | undefined, ip: string): Promise<KeyContext> {
    const token = header?.replace(/^Bearer\s+/i, "").trim();
    if (!token?.startsWith("zvk_")) {
      throw new ZelyqError(
        "unauthorized",
        "Send a Vault service key as 'Authorization: Bearer zvk_…'.",
      );
    }
    const key = await this.store.vault.keys.findByHash(hashKey(token));
    if (!key) throw new ZelyqError("unauthorized", "That service key is not valid.");
    if (key.revokedAt) throw new ZelyqError("unauthorized", "That service key has been revoked.");
    if (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) {
      throw new ZelyqError("unauthorized", "That service key has expired.");
    }
    const allowedIps: string[] | null = key.allowedIps ? JSON.parse(key.allowedIps) : null;
    if (allowedIps && !ipAllowed(ip, allowedIps)) {
      throw new ZelyqError("forbidden", `This service key may not be used from ${ip}.`);
    }
    await this.store.vault.keys.touch(key.id, new Date().toISOString(), ip);
    return {
      key,
      scopes: JSON.parse(key.scopes),
      namePatterns: key.namePatterns ? JSON.parse(key.namePatterns) : null,
      ip,
    };
  }

  requireScope(context: KeyContext, scope: VaultKeyScope): void {
    if (!context.scopes.includes(scope)) {
      throw new ZelyqError("forbidden", `This service key does not have the '${scope}' scope.`);
    }
  }

  allows(context: KeyContext, name: string): boolean {
    return !context.namePatterns || context.namePatterns.some((p) => matchesNamePattern(name, p));
  }

  requireName(context: KeyContext, name: string): void {
    if (!this.allows(context, name)) {
      throw new ZelyqError("forbidden", `This service key may not access '${name}'.`);
    }
  }

  // --------------------------------------------- what an outside system does

  async names(context: KeyContext): Promise<{ name: string; description: string | null }[]> {
    this.requireScope(context, "list");
    return (await this.store.vault.list(context.key.teamId))
      .filter((row) => this.allows(context, row.name))
      .map((row) => ({ name: row.name, description: row.description }));
  }

  async read(
    context: KeyContext,
    names: string[],
  ): Promise<{ secrets: { name: string; value: string }[]; missing: string[] }> {
    this.requireScope(context, "read");
    for (const name of names) this.requireName(context, name);
    const values = await this.vault.resolve(context.key.teamId, names);
    const secrets = names.flatMap((name) => {
      const value = values.get(name);
      return value === undefined ? [] : [{ name, value }];
    });
    const missing = names.filter((name) => !values.has(name));
    if (secrets.length > 0) {
      await this.recordByKey(context, "vault.secret.fetched", {
        ...(secrets.length === 1
          ? { name: secrets[0]?.name }
          : { names: secrets.map((s) => s.name) }),
      });
    }
    return { secrets, missing };
  }

  /** A value set by a machine — a pipeline rotating its own token, say. A
   * Protected secret is never changed this way: that is a person's job. */
  async write(
    context: KeyContext,
    name: string,
    value: string,
    description: string | null | undefined,
  ): Promise<{ name: string; version: number; created: boolean }> {
    this.requireScope(context, "write");
    this.requireName(context, name);
    const teamId = context.key.teamId;
    const existing = await this.store.vault.findByName(teamId, name);
    if (existing?.protected) {
      throw new ZelyqError(
        "forbidden",
        `${name} is Protected; only an admin or owner can change it.`,
      );
    }
    const now = new Date().toISOString();
    const encrypted = this.vault.encrypt(value);
    const row = existing
      ? await this.store.vault.setValue(existing.id, encrypted, null, now)
      : await this.store.vault.create({
          scopeKey: teamId,
          teamId,
          name,
          value: encrypted,
          description: description ?? null,
          protected: false,
          userId: null,
          now,
        });
    if (!row) throw ZelyqError.notFound("Secret", name);
    await this.recordByKey(context, "vault.secret.written_by_key", { name });
    if (existing) await this.vault.listeners.teamEntryChanged?.(teamId, name);
    return { name, version: row.version, created: !existing };
  }

  // ---------------------------------------------------------------- helpers

  private async insert(
    user: User,
    teamId: string,
    settings: {
      name: string;
      scopes: VaultKeyScope[];
      namePatterns: string[] | null;
      allowedIps: string[] | null;
      expiresAt: string | null;
    },
  ): Promise<VaultServiceKeyCreated> {
    const prefix = `zvk_${randomBytes(4).toString("hex")}`;
    const secret = `${prefix}_${randomBytes(32).toString("base64url")}`;
    const row = await this.store.vault.keys.create({
      id: newId("vaultServiceKey"),
      teamId,
      name: settings.name,
      keyPrefix: prefix,
      keyHash: hashKey(secret),
      scopes: JSON.stringify(settings.scopes),
      namePatterns: settings.namePatterns ? JSON.stringify(settings.namePatterns) : null,
      allowedIps: settings.allowedIps ? JSON.stringify(settings.allowedIps) : null,
      expiresAt: settings.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      lastUsedIp: null,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    });
    return { key: (await this.present([row]))[0] as VaultServiceKey, secret };
  }

  private async find(teamId: string, keyId: string): Promise<VaultServiceKeyRow> {
    const key = await this.store.vault.keys.findById(keyId);
    if (!key || key.teamId !== teamId) throw ZelyqError.notFound("Service key", keyId);
    return key;
  }

  /** The audit entry for something a key did: no person, so the key names itself. */
  private async recordByKey(
    context: KeyContext,
    action: "vault.secret.fetched" | "vault.secret.written_by_key",
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.store.auditLog.record({
      id: newId("audit"),
      teamId: context.key.teamId,
      projectId: null,
      userId: null,
      actorName: `Service key “${context.key.name}”`,
      actorEmail: "",
      action,
      detail: { ...detail, key: context.key.keyPrefix, ip: context.ip },
      createdAt: new Date().toISOString(),
    });
  }

  private async present(rows: VaultServiceKeyRow[]): Promise<VaultServiceKey[]> {
    const actors = await this.vault.actors(rows.map((row) => row.createdBy));
    return rows.map((row) => ({
      id: row.id,
      teamId: row.teamId,
      name: row.name,
      keyPrefix: row.keyPrefix,
      scopes: JSON.parse(row.scopes),
      namePatterns: row.namePatterns ? JSON.parse(row.namePatterns) : null,
      allowedIps: row.allowedIps ? JSON.parse(row.allowedIps) : null,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      lastUsedAt: row.lastUsedAt,
      lastUsedIp: row.lastUsedIp,
      createdBy: row.createdBy ? (actors.get(row.createdBy) ?? null) : null,
      createdAt: row.createdAt,
    }));
  }
}

export function hashKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** An address or a CIDR range, as BlockList understands it — or null. */
function parseCidr(
  entry: string,
): { address: string; prefix: number; family: "ipv4" | "ipv6" } | null {
  const [address, bits] = entry.trim().split("/");
  const version = address ? isIP(address) : 0;
  if (!address || version === 0) return null;
  const max = version === 4 ? 32 : 128;
  const prefix = bits === undefined ? max : Number(bits);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return { address, prefix, family: version === 4 ? "ipv4" : "ipv6" };
}

function ipAllowed(ip: string, allowed: string[]): boolean {
  // An IPv4 client can arrive as ::ffff:203.0.113.9 on a dual-stack socket.
  const client = ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  const family = isIP(client) === 6 ? "ipv6" : "ipv4";
  const list = new BlockList();
  for (const entry of allowed) {
    const cidr = parseCidr(entry);
    if (cidr) list.addSubnet(cidr.address, cidr.prefix, cidr.family);
  }
  return isIP(client) !== 0 && list.check(client, family);
}
