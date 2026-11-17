import { createHash, randomBytes } from "node:crypto";
import {
  ADMIN_KEY_PREFIX,
  type AdminKeySummary,
  type AdminScope,
  adminScopeSchema,
  type CreateAdminKeyInput,
  type CreatedAdminKey,
  createAdminKeySchema,
  newId,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { AdminKeyRow, Store } from "@zelyq/db";

/** Who is calling the admin API: a key, with what it may reach. */
export interface AdminCaller {
  id: string;
  name: string;
  prefix: string;
  scopes: ReadonlySet<AdminScope>;
}

/** Answers to retried changes are kept this long. */
const KEEP_ANSWERS_MS = 24 * 60 * 60 * 1000;
/** `last used` is written at most this often per key, not on every call. */
const TOUCH_EVERY_MS = 60 * 1000;

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Admin API keys: made by the server's administrator (in Server settings, or
 * on the server's own command line before anyone has signed in), shown once,
 * stored as a hash, revocable. Every change made with one is in the audit log
 * under the key's name.
 */
export class AdminKeyService {
  private readonly touched = new Map<string, number>();
  private lastPrune = 0;

  constructor(private readonly store: Store) {}

  async create(by: User | null, raw: unknown): Promise<CreatedAdminKey> {
    const input: CreateAdminKeyInput = createAdminKeySchema.parse(raw);
    const key = `${ADMIN_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const row: AdminKeyRow = {
      id: newId("adminKey"),
      name: input.name,
      scopes: JSON.stringify([...new Set(input.scopes)].sort()),
      keyPrefix: key.slice(0, ADMIN_KEY_PREFIX.length + 6),
      keyHash: hashKey(key),
      createdBy: by?.id ?? null,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      lastUsedIp: null,
      revokedAt: null,
    };
    await this.store.adminKeys.create(row);
    await this.audit(by, "admin_key.created", {
      key: row.name,
      prefix: row.keyPrefix,
      scopes: JSON.parse(row.scopes),
    });
    return { key, summary: summarize(row) };
  }

  async list(): Promise<AdminKeySummary[]> {
    return (await this.store.adminKeys.list()).map(summarize);
  }

  async revoke(by: User | null, id: string): Promise<AdminKeySummary> {
    const row = await this.store.adminKeys.findById(id);
    if (!row) throw ZelyqError.notFound("Admin key", id);
    if (!row.revokedAt) {
      const at = new Date().toISOString();
      await this.store.adminKeys.revoke(id, at);
      row.revokedAt = at;
      await this.audit(by, "admin_key.revoked", { key: row.name, prefix: row.keyPrefix });
    }
    return summarize(row);
  }

  /** The caller behind `Authorization: Bearer zlq_admin_…`, or a refusal. */
  async authenticate(authorization: string | undefined, ip: string): Promise<AdminCaller> {
    const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
    if (!token?.startsWith(ADMIN_KEY_PREFIX)) {
      throw new ZelyqError(
        "unauthorized",
        "The admin API takes a key: send 'Authorization: Bearer zlq_admin_…'. A signed-in session is not accepted here.",
      );
    }
    const row = await this.store.adminKeys.findByHash(hashKey(token));
    if (!row) throw new ZelyqError("unauthorized", "That admin key is not valid.");
    if (row.revokedAt) throw new ZelyqError("unauthorized", "This admin key has been revoked.");

    const now = Date.now();
    if (now - (this.touched.get(row.id) ?? 0) > TOUCH_EVERY_MS) {
      this.touched.set(row.id, now);
      await this.store.adminKeys.touch(row.id, new Date(now).toISOString(), ip);
    }
    return {
      id: row.id,
      name: row.name,
      prefix: row.keyPrefix,
      scopes: new Set(parseScopes(row.scopes)),
    };
  }

  /** A change made with a key, for the audit log. Nothing from the request body. */
  async recordCall(
    caller: AdminCaller,
    detail: { method: string; path: string; status: number; teamId?: string | null },
  ): Promise<void> {
    await this.store.auditLog.record({
      id: newId("audit"),
      teamId: detail.teamId ?? null,
      projectId: null,
      userId: null,
      actorName: `Admin key "${caller.name}"`,
      actorEmail: `${caller.prefix}…`,
      action: "admin_api.call",
      detail: { method: detail.method, path: detail.path, status: detail.status, key: caller.name },
      createdAt: new Date().toISOString(),
    });
  }

  // ------------------------------------------------------------------ idempotency

  /** `same`: replay this answer. `clash`: the key was used for another request. */
  async findAnswer(
    caller: AdminCaller,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<
    { kind: "none" } | { kind: "clash" } | { kind: "same"; status: number; body: string }
  > {
    const found = await this.store.adminKeys.findAnswer(caller.id, idempotencyKey);
    if (!found || Date.parse(found.createdAt) < Date.now() - KEEP_ANSWERS_MS)
      return { kind: "none" };
    if (found.requestHash !== requestHash) return { kind: "clash" };
    return { kind: "same", status: found.statusCode, body: found.response };
  }

  async saveAnswer(
    caller: AdminCaller,
    idempotencyKey: string,
    requestHash: string,
    status: number,
    body: string,
  ): Promise<void> {
    const now = Date.now();
    await this.store.adminKeys.saveAnswer({
      keyId: caller.id,
      idempotencyKey,
      requestHash,
      statusCode: status,
      response: body,
      createdAt: new Date(now).toISOString(),
    });
    if (now - this.lastPrune > 60 * 60 * 1000) {
      this.lastPrune = now;
      await this.store.adminKeys.forgetAnswersBefore(new Date(now - KEEP_ANSWERS_MS).toISOString());
    }
  }

  private async audit(
    by: User | null,
    action: "admin_key.created" | "admin_key.revoked",
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.store.auditLog.record({
      id: newId("audit"),
      teamId: null,
      projectId: null,
      userId: by?.id ?? null,
      actorName: by?.name ?? "Server command line",
      actorEmail: by?.email ?? "",
      action,
      detail,
      createdAt: new Date().toISOString(),
    });
  }
}

/** The request a retry must match: method, address and body. */
export function requestHash(method: string, url: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method} ${url}\n${JSON.stringify(body ?? null)}`)
    .digest("hex");
}

function parseScopes(json: string): AdminScope[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    // A scope this version does not know (a newer database) is simply not granted.
    return parsed.flatMap((scope) => {
      const known = adminScopeSchema.safeParse(scope);
      return known.success ? [known.data] : [];
    });
  } catch {
    return [];
  }
}

function summarize(row: AdminKeyRow): AdminKeySummary {
  return {
    id: row.id,
    name: row.name,
    scopes: parseScopes(row.scopes),
    prefix: row.keyPrefix,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    lastUsedAt: row.lastUsedAt,
    lastUsedIp: row.lastUsedIp,
    revokedAt: row.revokedAt,
  };
}
