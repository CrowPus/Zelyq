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

export const schema = {
  users,
  teams,
  teamMembers,
  authSessions,
  projects,
  sessions,
  messages,
  snapshots,
  settings,
};
