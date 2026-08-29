import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * The canonical schema. `pg.ts` mirrors it column for column, and a test
 * asserts the two stay identical — see `test/schema-parity.test.ts`.
 *
 * Two deliberate choices keep the dialects interchangeable:
 *   - timestamps are ISO-8601 strings, not native date types;
 *   - structured values are JSON in a text column.
 * Both cost a little query expressiveness and buy exact parity between a
 * laptop's SQLite file and a production PostgreSQL cluster.
 */

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    /** Stored lowercased; uniqueness must not depend on capitalisation. */
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    /**
     * Instance-wide, distinct from team roles: "admin" may change server
     * settings. The first account to register gets it.
     */
    instanceRole: text("instance_role").notNull().default("member"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
  }),
);

export const teams = sqliteTable(
  "teams",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex("teams_slug_idx").on(table.slug),
  }),
);

export const teamMembers = sqliteTable(
  "team_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("editor"),
    joinedAt: text("joined_at").notNull(),
  },
  (table) => ({
    membershipIdx: uniqueIndex("team_members_team_user_idx").on(table.teamId, table.userId),
    userIdx: index("team_members_user_id_idx").on(table.userId),
  }),
);

/**
 * Only the SHA-256 of the session token is stored. A leaked database therefore
 * yields no usable sessions.
 */
export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => ({
    tokenIdx: uniqueIndex("auth_sessions_token_hash_idx").on(table.tokenHash),
    userIdx: index("auth_sessions_user_id_idx").on(table.userId),
  }),
);

export const oidcIdentities = sqliteTable(
  "oidc_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    providerSubjectIdx: uniqueIndex("oidc_identities_issuer_subject_idx").on(
      table.issuer,
      table.subject,
    ),
    userIdx: index("oidc_identities_user_id_idx").on(table.userId),
  }),
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    /**
     * Empty string means "not yet adopted". Existing databases predate teams,
     * and a NOT NULL column with no default cannot be added to a table that
     * already has rows; the first account to register claims these.
     */
    teamId: text("team_id")
      .notNull()
      .default("")
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    template: text("template").notNull().default("vite-react"),
    status: text("status").notNull().default("creating"),
    statusMessage: text("status_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    slugIdx: index("projects_slug_idx").on(table.slug),
    teamIdx: index("projects_team_id_idx").on(table.teamId),
    updatedIdx: index("projects_updated_at_idx").on(table.updatedAt),
  }),
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("idle"),
    provider: text("provider").notNull().default("anthropic"),
    model: text("model").notNull(),
    effort: text("effort").notNull().default("high"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectIdx: index("sessions_project_id_idx").on(table.projectId),
  }),
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull().default(""),
    thinking: text("thinking"),
    /** JSON-encoded ToolCall[]. */
    toolCalls: text("tool_calls").notNull().default("[]"),
    /** JSON-encoded AttachmentRef[]. */
    attachments: text("attachments").notNull().default("[]"),
    /**
     * The project as it stood immediately before this turn ran, so the turn can
     * be undone. Null for user messages, and for assistant turns that predate
     * automatic snapshots.
     */
    snapshotId: text("snapshot_id"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    sessionIdx: index("messages_session_id_idx").on(table.sessionId),
    createdIdx: index("messages_created_at_idx").on(table.createdAt),
  }),
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    fileCount: integer("file_count").notNull().default(0),
    sizeBytes: integer("size_bytes").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectIdx: index("snapshots_project_id_idx").on(table.projectId),
  }),
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    /**
     * No foreign key reference on `teamId`, `projectId`, or `userId` —
     * deliberately, and for the same reason on all three: an audit log that
     * erases an entry (or refuses to insert one) the moment the thing it
     * names is deleted defeats its own purpose. This is not hypothetical —
     * a `project.deleted` entry is written *after* the project row is gone,
     * so a real foreign key here would reject that exact insert outright.
     * Null only for an instance-wide action — none exist at this scope yet.
     */
    teamId: text("team_id"),
    /** Null for a team-membership action, which has no single project. */
    projectId: text("project_id"),
    /** `actorName`/`actorEmail` below are what the log actually displays. */
    userId: text("user_id"),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    /** JSON-encoded, never a secret value. */
    detail: text("detail").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    teamIdx: index("audit_log_team_id_idx").on(table.teamId),
    projectIdx: index("audit_log_project_id_idx").on(table.projectId),
    createdIdx: index("audit_log_created_at_idx").on(table.createdAt),
  }),
);

/**
 * Proposal 058 · Phase A — an instance-wide connection to an external backend
 * provider (Supabase in Phase A), managed from Settings alongside the model
 * API keys. The credential lives in `encryptedBlob`, `SecretBox`-encrypted;
 * it is only ever decrypted inside the server's connection service, never
 * handed to the agent, a tool, or a project runtime.
 */
export const providerConnections = sqliteTable(
  "provider_connections",
  {
    id: text("id").primaryKey(),
    /** Only `"supabase"` in Phase A. */
    provider: text("provider").notNull(),
    /** `"oauth"` | `"pat"`. */
    credentialType: text("credential_type").notNull(),
    /**
     * `SecretBox` ciphertext. For a PAT: the raw token. For OAuth: a JSON
     * `{ access_token, refresh_token }`.
     */
    encryptedBlob: text("encrypted_blob").notNull(),
    /** Space-joined OAuth scopes; empty string for a PAT. */
    grantedScopes: text("granted_scopes").notNull().default(""),
    /** ISO-8601; null for a PAT (does not self-expire). */
    expiresAt: text("expires_at"),
    /** `"active"` | `"expired"` | `"revoked"` | `"orphaned"`. */
    status: text("status").notNull().default("active"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
  },
  (table) => ({
    providerIdx: index("provider_connections_provider_idx").on(table.provider),
    createdByIdx: index("provider_connections_created_by_idx").on(table.createdBy),
  }),
);

/**
 * A concrete provider project reachable through a connection. `publishableKey`
 * is the public browser key and is stored in the clear — it ships to browsers
 * anyway. A provider *secret* key is never stored here or anywhere.
 */
export const providerResources = sqliteTable(
  "provider_resources",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => providerConnections.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    projectRef: text("project_ref").notNull(),
    projectUrl: text("project_url").notNull(),
    publishableKey: text("publishable_key").notNull(),
    /** `"development"` | `"staging"` | `"production"`. v1 mutates development only. */
    environment: text("environment").notNull().default("development"),
    region: text("region"),
    displayName: text("display_name").notNull(),
    /** 1 when Zelyq provisioned it — governs whether delete calls the provider. */
    provisionedByZelyq: integer("provisioned_by_zelyq").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    connectionRefIdx: uniqueIndex("provider_resources_connection_ref_idx").on(
      table.connectionId,
      table.projectRef,
    ),
  }),
);

/** One provider resource linked to one Zelyq project (Phase A: at most one). */
export const projectProviderLinks = sqliteTable(
  "project_provider_links",
  {
    zelyqProjectId: text("zelyq_project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    providerResourceId: text("provider_resource_id")
      .notNull()
      .references(() => providerResources.id, { onDelete: "cascade" }),
    linkedBy: text("linked_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    linkedAt: text("linked_at").notNull(),
  },
  (table) => ({
    resourceIdx: index("project_provider_links_resource_idx").on(table.providerResourceId),
  }),
);

/**
 * An auditable provider action. Like `auditLog`, it carries no foreign keys —
 * a `delete` entry is written after the connection row is gone. `detail` is
 * JSON metadata only: never a token, never SQL with values, never rows.
 */
export const providerOperations = sqliteTable(
  "provider_operations",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id"),
    zelyqProjectId: text("zelyq_project_id"),
    /** `connect` | `provision` | `configure-auth` | `delete` | `link` | `unlink`. */
    action: text("action").notNull(),
    /** `"ok"` | `"error"`. */
    outcome: text("outcome").notNull(),
    detail: text("detail").notNull().default("{}"),
    actorUserId: text("actor_user_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    connectionIdx: index("provider_operations_connection_id_idx").on(table.connectionId),
    createdIdx: index("provider_operations_created_at_idx").on(table.createdAt),
  }),
);

export const schema = {
  users,
  teams,
  teamMembers,
  authSessions,
  oidcIdentities,
  projects,
  sessions,
  messages,
  snapshots,
  settings,
  auditLog,
  providerConnections,
  providerResources,
  projectProviderLinks,
  providerOperations,
};
