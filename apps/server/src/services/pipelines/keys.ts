import { createHash } from "node:crypto";
import { newId, type TeamSshKeySummary, type User, ZelyqError } from "@zelyq/core";
import type { Store, TeamSshKeyRow } from "@zelyq/db";
import ssh2 from "ssh2";

const { utils } = ssh2;

import type { AccessControl } from "../access.js";
import type { SecretBox } from "../secrets.js";

export type SshKeyAlgorithm = "ed25519" | "rsa";

/** How long the previous key keeps working after a rotation. */
export const ROTATION_GRACE_DAYS = 7;

/** OpenSSH's fingerprint of a public key line ("ssh-ed25519 AAAA… comment"). */
export function publicKeyFingerprint(publicKey: string): string {
  const blob = Buffer.from(publicKey.trim().split(/\s+/)[1] ?? "", "base64");
  return `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;
}

/**
 * The team's SSH key: what every runner VM trusts. A team has one, made the
 * first time someone asks for it; the private half is encrypted with the
 * instance key and never leaves the server. Admins see and copy the public
 * half into each VM's authorized_keys.
 *
 * Rotation makes a new key and gives the old one {@link ROTATION_GRACE_DAYS}
 * more days, so VMs can be moved over one at a time without a run failing.
 */
export class TeamSshKeyService {
  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
    private readonly box: SecretBox,
  ) {}

  /** The team's keys, newest first, creating the first one if there is none. */
  async list(user: User, teamId: string): Promise<TeamSshKeySummary[]> {
    await this.access.requireTeamRole(user, teamId, "admin");
    let rows = await this.usable(teamId);
    if (rows.length === 0) {
      await this.create(user, teamId, "ed25519");
      rows = await this.usable(teamId);
    }
    return rows.map(present);
  }

  /** A new key; the current one keeps working for the grace period. */
  async rotate(
    user: User,
    teamId: string,
    algorithm: SshKeyAlgorithm,
  ): Promise<TeamSshKeySummary[]> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const current = await this.usable(teamId);
    const retiresAt = new Date(Date.now() + ROTATION_GRACE_DAYS * 86_400_000).toISOString();
    for (const row of current) {
      if (!row.retiresAt) await this.store.pipelines.keys.setRetiresAt(row.id, retiresAt);
    }
    const created = await this.create(user, teamId, algorithm, current.length > 0);
    return [
      present(created),
      ...(await this.usable(teamId)).filter((row) => row.id !== created.id).map(present),
    ];
  }

  /** Ends the grace period now: only the newest key works from here. */
  async retireOld(user: User, teamId: string): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const [newest, ...older] = await this.usable(teamId);
    if (!newest) return;
    for (const row of older) await this.store.pipelines.keys.remove(row.id);
  }

  /** The private keys a connection may offer, newest first. Server-internal. */
  async credentials(teamId: string): Promise<{ privateKey: string; fingerprint: string }[]> {
    const rows = await this.usable(teamId);
    const keys: { privateKey: string; fingerprint: string }[] = [];
    for (const row of rows) {
      const privateKey = this.box.decrypt(row.privateKey);
      if (privateKey) keys.push({ privateKey, fingerprint: row.fingerprint });
    }
    if (rows.length > 0 && keys.length === 0) {
      throw ZelyqError.badRequest(
        "The team's SSH key cannot be read — the instance encryption key changed. Rotate the key in Runners and add the new public key to each machine.",
      );
    }
    return keys;
  }

  /** Keys still in use, newest first; keys past their grace period are removed. */
  private async usable(teamId: string): Promise<TeamSshKeyRow[]> {
    const now = new Date().toISOString();
    const rows = await this.store.pipelines.keys.listForTeam(teamId);
    const keep: TeamSshKeyRow[] = [];
    for (const row of rows) {
      if (row.retiresAt && row.retiresAt <= now) await this.store.pipelines.keys.remove(row.id);
      else keep.push(row);
    }
    return keep;
  }

  private async create(
    user: User,
    teamId: string,
    algorithm: SshKeyAlgorithm,
    rotated = false,
  ): Promise<TeamSshKeyRow> {
    const team = await this.store.teams.findById(teamId);
    const comment = `zelyq-${team?.slug ?? teamId}`;
    const pair =
      algorithm === "rsa"
        ? utils.generateKeyPairSync("rsa", { bits: 4096, comment })
        : utils.generateKeyPairSync("ed25519", { comment });
    const row: TeamSshKeyRow = {
      id: newId("teamSshKey"),
      teamId,
      algorithm,
      publicKey: pair.public.trim(),
      privateKey: this.box.encrypt(pair.private),
      fingerprint: publicKeyFingerprint(pair.public),
      retiresAt: null,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    };
    await this.store.pipelines.keys.create(row);
    await this.access.recordChange(user, {
      teamId,
      action: rotated ? "ssh_key.rotated" : "ssh_key.created",
      detail: { algorithm, fingerprint: row.fingerprint },
    });
    return row;
  }
}

function present(row: TeamSshKeyRow): TeamSshKeySummary {
  return {
    id: row.id,
    algorithm: row.algorithm === "rsa" ? "rsa" : "ed25519",
    publicKey: row.publicKey,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt,
    retiresAt: row.retiresAt,
  };
}
