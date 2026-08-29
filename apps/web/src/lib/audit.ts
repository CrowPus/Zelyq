import type { AuditAction } from "@zelyq/core";

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "project.created": "created the project",
  "project.updated": "updated the project",
  "project.deleted": "deleted the project",
  "project.pushed": "pushed to a remote",
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
  if (typeof detail.name === "string") return detail.name;
  if (typeof detail.email === "string" && typeof detail.role === "string") {
    return `${detail.email} · ${detail.role}`;
  }
  if (typeof detail.email === "string") return detail.email;
  if (typeof detail.label === "string") return detail.label;
  if (Array.isArray(detail.fields)) return detail.fields.join(", ");
  return null;
}
