import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  PluginManifest,
  RegistryPluginDetail,
  RegistryPluginSummary,
  RegistryPluginVersion,
} from "@zelyq/core";
import { readPluginPackage } from "@zelyq/core/node";
import type { RegistryDb } from "./db.js";
import type { Signer } from "./signing.js";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  length: number,
) => Promise<Buffer>;

/** Only our own plugins, for now: the publisher part of every id. */
export const OUR_PUBLISHER = "zelyq";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface VersionRow {
  plugin_id: string;
  version: string;
  sha256: string;
  signature: string;
  key_id: string;
  size_bytes: number;
  manifest: string;
  readme: string;
  changelog: string | null;
  published_at: string;
  yanked_at: string | null;
  yanked_reason: string | null;
}

interface PluginRow {
  id: string;
  name: string;
  description: string;
  category: string;
  updated_at: string;
}

/** Compares two versions like 1.10.0 and 1.9.2, numerically. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class RegistryStore {
  constructor(
    private readonly db: RegistryDb,
    private readonly signer: Signer,
    private readonly dataDir: string,
  ) {}

  private packageFile(sha256: string): string {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new RegistryError("Invalid package.");
    return path.join(this.dataDir, "packages", `${sha256}.tar.gz`);
  }

  async event(actor: string, action: string, detail: Record<string, unknown>): Promise<void> {
    await this.db.run("INSERT INTO events (actor, action, detail, at) VALUES (?, ?, ?, ?)", [
      actor,
      action,
      JSON.stringify(detail),
      new Date().toISOString(),
    ]);
  }

  // ------------------------------------------------------------ publishing

  /**
   * Checks a package exactly as Zelyq will, adds what a catalog needs (a
   * README and a licence), signs it and publishes it. A version, once
   * published, never changes: a fix is a new version.
   */
  async publish(body: Buffer, admin: string): Promise<{ id: string; version: string }> {
    let manifest: PluginManifest;
    let sha256: string;
    let files: Map<string, Buffer>;
    try {
      ({ manifest, sha256, files } = readPluginPackage(body));
    } catch (error) {
      throw new RegistryError((error as Error).message);
    }
    const [publisher] = manifest.id.split("/");
    if (publisher !== OUR_PUBLISHER) {
      throw new RegistryError(
        `Only our own plugins are published here: the id must start with ${OUR_PUBLISHER}/.`,
      );
    }
    const readme = files.get("README.md")?.toString("utf8");
    if (!readme?.trim()) throw new RegistryError("A plugin needs a README.md at its top.");
    if (!files.has("LICENSE")) throw new RegistryError("A plugin needs a LICENSE at its top.");
    const existing = await this.db.get<{ version: string }>(
      "SELECT version FROM versions WHERE plugin_id = ? AND version = ?",
      [manifest.id, manifest.version],
    );
    if (existing) {
      throw new RegistryError(
        `${manifest.id} ${manifest.version} is already published. A version never changes: publish a new one.`,
      );
    }
    const newest = await this.newestVersion(manifest.id);
    if (newest && compareVersions(manifest.version, newest) <= 0) {
      throw new RegistryError(`The newest published version is ${newest}; this must be higher.`);
    }
    const changelog = files.get("CHANGELOG.md")?.toString("utf8") ?? null;
    if (newest && !changelog?.trim()) {
      throw new RegistryError("From the second version on, a plugin needs a CHANGELOG.md.");
    }

    const file = this.packageFile(sha256);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, body, { mode: 0o600 });
    await fs.rename(temp, file);

    const now = new Date().toISOString();
    await this.db.run(
      `INSERT INTO plugins (id, name, description, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
         category = excluded.category, updated_at = excluded.updated_at`,
      [manifest.id, manifest.name, manifest.description, manifest.category, now, now],
    );
    await this.db.run(
      `INSERT INTO versions (plugin_id, version, sha256, signature, key_id, size_bytes, manifest,
         readme, changelog, published_by, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        manifest.id,
        manifest.version,
        sha256,
        this.signer.sign(manifest.id, manifest.version, sha256),
        this.signer.keyId,
        body.length,
        JSON.stringify(manifest),
        readme,
        changelog,
        admin,
        now,
      ],
    );
    await this.event(admin, "published", { id: manifest.id, version: manifest.version, sha256 });
    return { id: manifest.id, version: manifest.version };
  }

  /** Withdraws a version: installations are warned, and it cannot be installed again. */
  async yank(id: string, version: string, reason: string, admin: string): Promise<void> {
    if (!reason.trim()) throw new RegistryError("Say why, for the people who installed it.");
    const changed = await this.db.run(
      "UPDATE versions SET yanked_at = ?, yanked_reason = ? WHERE plugin_id = ? AND version = ? AND yanked_at IS NULL",
      [new Date().toISOString(), reason.trim().slice(0, 500), id, version],
    );
    if (!changed) throw new RegistryError("No such version, or it was already withdrawn.", 404);
    await this.event(admin, "yanked", { id, version, reason });
  }

  // --------------------------------------------------------------- reading

  private async newestVersion(id: string, includeYanked = true): Promise<string | null> {
    const rows = await this.db.all<{ version: string }>(
      `SELECT version FROM versions WHERE plugin_id = ? ${includeYanked ? "" : "AND yanked_at IS NULL"}`,
      [id],
    );
    return (
      rows
        .map((row) => row.version)
        .sort(compareVersions)
        .at(-1) ?? null
    );
  }

  private async latestRow(id: string): Promise<VersionRow | null> {
    const version = await this.newestVersion(id, false);
    return version
      ? this.db.get<VersionRow>("SELECT * FROM versions WHERE plugin_id = ? AND version = ?", [
          id,
          version,
        ])
      : null;
  }

  private summary(plugin: PluginRow, latest: VersionRow): RegistryPluginSummary {
    const manifest = JSON.parse(latest.manifest) as PluginManifest;
    return {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      category: plugin.category,
      latestVersion: latest.version,
      os: manifest["runs-on"]?.os ?? ["linux", "macos", "windows"],
      updatedAt: plugin.updated_at,
    };
  }

  /** Plugins with at least one version that is not withdrawn. */
  async list(query: { q?: string; category?: string } = {}): Promise<RegistryPluginSummary[]> {
    const plugins = await this.db.all<PluginRow>("SELECT * FROM plugins ORDER BY name");
    const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const result: RegistryPluginSummary[] = [];
    for (const plugin of plugins) {
      if (query.category && plugin.category !== query.category) continue;
      const text = `${plugin.id} ${plugin.name} ${plugin.description}`.toLowerCase();
      if (!words.every((word) => text.includes(word))) continue;
      const latest = await this.latestRow(plugin.id);
      if (latest) result.push(this.summary(plugin, latest));
    }
    return result;
  }

  async detail(id: string): Promise<RegistryPluginDetail | null> {
    const plugin = await this.db.get<PluginRow>("SELECT * FROM plugins WHERE id = ?", [id]);
    const latest = plugin ? await this.latestRow(id) : null;
    if (!plugin || !latest) return null;
    const manifest = JSON.parse(latest.manifest) as PluginManifest;
    const rows = await this.db.all<VersionRow>("SELECT * FROM versions WHERE plugin_id = ?", [id]);
    return {
      ...this.summary(plugin, latest),
      readme: latest.readme,
      inputs: Object.fromEntries(
        Object.entries(manifest.inputs).map(([name, input]) => [
          name,
          {
            description: input.description ?? "",
            required: Boolean(input.required),
            secret: Boolean(input.secret),
          },
        ]),
      ),
      versions: rows
        .sort((a, b) => compareVersions(b.version, a.version))
        .map(
          (row): RegistryPluginVersion => ({
            version: row.version,
            sha256: row.sha256,
            signature: row.signature,
            keyId: row.key_id,
            sizeBytes: row.size_bytes,
            changelog: row.changelog,
            publishedAt: row.published_at,
            yanked: row.yanked_at ? { at: row.yanked_at, reason: row.yanked_reason ?? "" } : null,
          }),
        ),
    };
  }

  /** A version's package and its signature; refused once withdrawn. */
  async package(
    id: string,
    version: string,
  ): Promise<{ body: Buffer; sha256: string; signature: string; keyId: string }> {
    const row = await this.db.get<VersionRow>(
      "SELECT * FROM versions WHERE plugin_id = ? AND version = ?",
      [id, version],
    );
    if (!row) throw new RegistryError("No such plugin version.", 404);
    if (row.yanked_at) {
      throw new RegistryError(`This version was withdrawn: ${row.yanked_reason}`, 410);
    }
    return {
      body: await fs.readFile(this.packageFile(row.sha256)),
      sha256: row.sha256,
      signature: row.signature,
      keyId: row.key_id,
    };
  }

  async yanked(): Promise<{ id: string; version: string; reason: string; at: string }[]> {
    const rows = await this.db.all<VersionRow>(
      "SELECT * FROM versions WHERE yanked_at IS NOT NULL ORDER BY yanked_at DESC",
    );
    return rows.map((row) => ({
      id: row.plugin_id,
      version: row.version,
      reason: row.yanked_reason ?? "",
      at: row.yanked_at ?? "",
    }));
  }

  async recordDownload(id: string, version: string, installationId: string): Promise<void> {
    await this.db.run(
      "INSERT INTO downloads (plugin_id, version, installation_id, at) VALUES (?, ?, ?, ?)",
      [id, version, installationId, new Date().toISOString()],
    );
  }

  /** For the admin page: every plugin with every version, withdrawn ones too. */
  async adminOverview() {
    const plugins = await this.db.all<PluginRow>("SELECT * FROM plugins ORDER BY name");
    const counts = new Map(
      (
        await this.db.all<{ plugin_id: string; version: string; n: number }>(
          "SELECT plugin_id, version, COUNT(*) AS n FROM downloads GROUP BY plugin_id, version",
        )
      ).map((row) => [`${row.plugin_id}@${row.version}`, Number(row.n)]),
    );
    return Promise.all(
      plugins.map(async (plugin) => ({
        ...plugin,
        versions: (
          await this.db.all<VersionRow>("SELECT * FROM versions WHERE plugin_id = ?", [plugin.id])
        )
          .sort((a, b) => compareVersions(b.version, a.version))
          .map((row) => ({
            version: row.version,
            publishedAt: row.published_at,
            yankedReason: row.yanked_reason,
            installs: counts.get(`${plugin.id}@${row.version}`) ?? 0,
          })),
      })),
    );
  }

  // --------------------------------------------------------- installations

  /** A Zelyq installation introduces itself and gets its key, shown once. */
  async registerInstallation(zelyqVersion: string | null): Promise<{ id: string; key: string }> {
    const id = `zri_${randomBytes(12).toString("hex")}`;
    const key = `zrk_${randomBytes(32).toString("base64url")}`;
    await this.db.run(
      "INSERT INTO installations (id, key_hash, zelyq_version, created_at) VALUES (?, ?, ?, ?)",
      [id, hash(key), zelyqVersion?.slice(0, 40) ?? null, new Date().toISOString()],
    );
    return { id, key };
  }

  async installationFor(key: string): Promise<{ id: string }> {
    const row = await this.db.get<{ id: string; blocked_at: string | null }>(
      "SELECT id, blocked_at FROM installations WHERE key_hash = ?",
      [hash(key)],
    );
    if (!row) throw new RegistryError("Unknown installation. Zelyq registers itself again.", 401);
    if (row.blocked_at) throw new RegistryError("This installation is blocked.", 403);
    await this.db.run("UPDATE installations SET last_seen_at = ? WHERE id = ?", [
      new Date().toISOString(),
      row.id,
    ]);
    return { id: row.id };
  }

  async installationCount(): Promise<number> {
    const row = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM installations");
    return Number(row?.n ?? 0);
  }

  // ---------------------------------------------------------------- admins

  /** Adds an admin, or sets a new password for one and signs them out everywhere. */
  async addAdmin(email: string, password: string): Promise<"added" | "updated"> {
    if (password.length < 12) throw new RegistryError("Use a password of at least 12 characters.");
    const salt = randomBytes(16);
    const derived = await scryptAsync(password, salt, 64);
    const hash = `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
    const address = email.trim().toLowerCase();
    const existing = await this.db.get<{ id: string }>("SELECT id FROM admins WHERE email = ?", [
      address,
    ]);
    if (existing) {
      await this.db.run("UPDATE admins SET password_hash = ? WHERE id = ?", [hash, existing.id]);
      await this.db.run("DELETE FROM admin_sessions WHERE admin_id = ?", [existing.id]);
      return "updated";
    }
    await this.db.run(
      "INSERT INTO admins (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
      [`adm_${randomBytes(8).toString("hex")}`, address, hash, new Date().toISOString()],
    );
    return "added";
  }

  /** A session token for a correct email and password, or null. */
  async signIn(email: string, password: string): Promise<string | null> {
    const admin = await this.db.get<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM admins WHERE email = ?",
      [email.trim().toLowerCase()],
    );
    // Always derive, so a wrong email takes as long as a wrong password.
    const [, saltHex = "00", hashHex = "00"] = (admin?.password_hash ?? "scrypt$00$00").split("$");
    const derived = await scryptAsync(password, Buffer.from(saltHex, "hex"), 64);
    const expected = Buffer.from(hashHex, "hex");
    if (!admin || expected.length !== derived.length || !timingSafeEqual(expected, derived)) {
      return null;
    }
    const token = randomBytes(32).toString("base64url");
    await this.db.run(
      "INSERT INTO admin_sessions (token_hash, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      [
        hash(token),
        admin.id,
        new Date(Date.now() + 12 * 3600_000).toISOString(),
        new Date().toISOString(),
      ],
    );
    await this.event(email, "signed_in", {});
    return token;
  }

  async adminFor(token: string | undefined): Promise<{ email: string } | null> {
    if (!token) return null;
    return this.db.get<{ email: string }>(
      `SELECT admins.email FROM admin_sessions JOIN admins ON admins.id = admin_sessions.admin_id
       WHERE admin_sessions.token_hash = ? AND admin_sessions.expires_at > ?`,
      [hash(token), new Date().toISOString()],
    );
  }

  async signOut(token: string | undefined): Promise<void> {
    if (token) await this.db.run("DELETE FROM admin_sessions WHERE token_hash = ?", [hash(token)]);
  }
}
