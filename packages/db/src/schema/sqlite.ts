import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
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

export const schema = { projects, sessions, messages, snapshots, settings };
