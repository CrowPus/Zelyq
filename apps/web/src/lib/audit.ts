import type { AuditAction } from "@zelyq/core";

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "project.created": "created the project",
  "project.updated": "updated the project",
  "project.backend.updated": "updated backend configuration",
  "project.backend.disconnected": "disconnected backend configuration",
  "vault.secret.created": "added a secret to Vault",
  "vault.secret.updated": "changed a Vault secret",
  "vault.secret.deleted": "deleted a Vault secret",
  "vault.secret.revealed": "revealed a Vault secret",
  "vault.secret.rolled_back": "restored an earlier value of a Vault secret",
  "vault.imported": "imported a .env file into Vault",
  "vault.secret.fetched": "fetched a Vault secret",
  "vault.secret.written_by_key": "set a Vault secret",
  "vault.key.created": "created a service key",
  "vault.key.rotated": "rotated a service key",
  "vault.key.revoked": "revoked a service key",
  "pipeline.created": "created a pipeline",
  "pipeline.updated": "changed a pipeline",
  "pipeline.deleted": "deleted a pipeline",
  "pipeline.run_started": "started a pipeline run",
  "pipeline.run_cancelled": "cancelled a pipeline run",
  "pipeline.trigger_added": "added a pipeline trigger",
  "pipeline.trigger_removed": "removed a pipeline trigger",
  "runner.added": "added a runner",
  "runner.updated": "changed a runner",
  "runner.removed": "removed a runner",
  "runner.host_key_confirmed": "confirmed a runner's fingerprint",
  "ssh_key.created": "created the team's SSH key",
  "ssh_key.rotated": "rotated the team's SSH key",
  "project.variable.created": "added a variable",
  "project.variable.updated": "changed a variable",
  "project.variable.deleted": "deleted a variable",
  "project.variable.revealed": "revealed a variable",
  "project.variable.rolled_back": "restored an earlier value of a variable",
  "project.variables_imported": "imported a .env file into variables",
  "project.variables_migrated": "moved backend secrets into variables",
  "settings.credential_source_changed": "changed where a Settings key comes from",
  "project.deleted": "deleted the project",
  "project.pushed": "pushed to a remote",
  "project.git_remote_set": "changed where the project pushes to",
  "project.git_fetched": "checked the remote for changes",
  "project.git_pulled": "pulled changes from the remote",
  "project.git_branch_switched": "switched branch",
  "project.pull_request_opened": "opened a pull request",
  "file.written": "edited a file",
  "file.deleted": "deleted a file",
  "snapshot.created": "saved a snapshot",
  "snapshot.restored": "restored a snapshot",
  "team.member_added": "added a member",
  "team.member_role_changed": "changed a member's role",
  "team.member_removed": "removed a member",
  "provider.connected": "connected a Supabase account",
  "provider.disconnected": "disconnected a Supabase account",
  "provider.resource_linked": "linked a Supabase project",
  "provider.resource_unlinked": "unlinked a Supabase project",
  "provider.resource_provisioned": "provisioned a Supabase project",
  "provider.resource_deleted": "deleted a Supabase project",
  "provider.auth_configured": "configured Supabase auth",
  "provider.migration_applied": "applied a Supabase migration",
  "provider.function_deployed": "deployed a Supabase Edge Function",
};

/** A short, human phrase for what `detail` actually says — never the raw JSON. */
export function auditDetailSummary(detail: Record<string, unknown>): string | null {
  if (typeof detail.path === "string") return detail.path;
  // Vault: which secret — and, for a fetch by a service key, which key.
  if (typeof detail.name === "string" && typeof detail.key === "string") {
    return `${detail.name} · key ${detail.key}`;
  }
  if (typeof detail.name === "string") return detail.name;
  if (Array.isArray(detail.names)) return detail.names.join(", ");
  if (Array.isArray(detail.created) && Array.isArray(detail.updated)) {
    const count = detail.created.length + detail.updated.length;
    return `${count} secret${count === 1 ? "" : "s"}`;
  }
  if (typeof detail.email === "string" && typeof detail.role === "string") {
    return `${detail.email} · ${detail.role}`;
  }
  if (typeof detail.email === "string") return detail.email;
  if (typeof detail.label === "string") return detail.label;
  if (Array.isArray(detail.fields)) return detail.fields.join(", ");
  return null;
}
