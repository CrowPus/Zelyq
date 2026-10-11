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
    /** Whether this project's agent may generate images. Off until a person
     * turns it on: generating spends real money against the instance's key. */
    imageGenerationEnabled: integer("image_generation_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Whether this project's agent may generate video. Separate from the
     * image permission on purpose: an image costs cents, a clip costs
     * dollars, so one does not imply the other. */
    videoGenerationEnabled: integer("video_generation_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
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
     * JSON `{ skills, agents, plugins }` — what the composer's `/` menu named
     * on this message, for the transcript to show. Null when nothing was named.
     */
    mentions: text("mentions"),
    /**
     * The project as it stood immediately before this turn ran, so the turn can
     * be undone. Null for user messages, and for assistant turns that predate
     * automatic snapshots.
     */
    snapshotId: text("snapshot_id"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    /**
     * Prompt tokens this turn read from / wrote to the provider's cache. A
     * cache read bills at ~0.1x and a write at ~1.25x, so without these two the
     * stored `tokens_in` cannot be turned into money at all.
     */
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    /**
     * 0 = written before the R1 fix, when `tokens_in` held a session-cumulative
     * running total instead of this turn's usage. Those rows are inflated and
     * must be excluded from any baseline; there is no backfill. 1 = per-turn,
     * trustworthy.
     */
    usageSchema: integer("usage_schema").notNull().default(1),
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

/**
 * Vault: a team's (or the instance's) secrets — one value per name. `value`
 * is `SecretBox` ciphertext, decrypted only for an audited reveal or for the
 * place a reference is resolved, never for a list.
 *
 * `scopeKey` is the team id, or "instance" for Zelyq's own credentials. It
 * exists so one unique index covers both kinds: a nullable `teamId` would
 * not, because SQL treats every NULL as distinct.
 */
export const vaultEntries = sqliteTable(
  "vault_entries",
  {
    id: text("id").primaryKey(),
    scopeKey: text("scope_key").notNull(),
    teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: text("value").notNull(),
    description: text("description"),
    /** Only admins and owners may reveal, change or point anything at it. */
    protected: integer("protected", { mode: "boolean" }).notNull().default(false),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    nameIdx: uniqueIndex("vault_entries_scope_name_idx").on(table.scopeKey, table.name),
  }),
);

export const vaultEntryVersions = sqliteTable(
  "vault_entry_versions",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => vaultEntries.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    value: text("value").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    versionIdx: uniqueIndex("vault_entry_versions_entry_version_idx").on(
      table.entryId,
      table.version,
    ),
  }),
);

/**
 * What a coding project's app is given. Each variable is either typed for
 * this project (`source = "direct"`, ciphertext in `value`) or points at an
 * entry in the project's team Vault (`source = "vault"`, by `vaultName`), so
 * a change in Vault reaches every app that uses it.
 */
export const projectVariables = sqliteTable(
  "project_variables",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: text("source").notNull(),
    value: text("value"),
    vaultName: text("vault_name"),
    description: text("description"),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    nameIdx: uniqueIndex("project_variables_project_name_idx").on(table.projectId, table.name),
    vaultIdx: index("project_variables_vault_name_idx").on(table.vaultName),
  }),
);

/** Every typed value a variable has held. A Vault-sourced variable keeps its
 * history in Vault, so it adds nothing here. */
export const projectVariableVersions = sqliteTable(
  "project_variable_versions",
  {
    id: text("id").primaryKey(),
    variableId: text("variable_id")
      .notNull()
      .references(() => projectVariables.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    value: text("value").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    versionIdx: uniqueIndex("project_variable_versions_variable_version_idx").on(
      table.variableId,
      table.version,
    ),
  }),
);

/**
 * Machine access to a team's Vault from outside Zelyq. The key itself is
 * shown once and never stored — only its SHA-256, which is enough for a
 * 256-bit random token. JSON columns hold string arrays; null means "any".
 */
export const vaultServiceKeys = sqliteTable(
  "vault_service_keys",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").notNull(),
    namePatterns: text("name_patterns"),
    allowedIps: text("allowed_ips"),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    lastUsedAt: text("last_used_at"),
    lastUsedIp: text("last_used_ip"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    hashIdx: uniqueIndex("vault_service_keys_hash_idx").on(table.keyHash),
    teamIdx: index("vault_service_keys_team_idx").on(table.teamId),
  }),
);

/**
 * Pipelines. A team's SSH key logs into its SSH runners (VMs); pipelines run
 * there or on the local runner. The private key is `SecretBox` ciphertext and
 * is decrypted only to open a connection.
 */
export const teamSshKeys = sqliteTable(
  "team_ssh_keys",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    algorithm: text("algorithm").notNull(),
    publicKey: text("public_key").notNull(),
    privateKey: text("private_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    /** Set on the older key during rotation: it keeps working until then. */
    retiresAt: text("retires_at"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({ teamIdx: index("team_ssh_keys_team_idx").on(table.teamId) }),
);

export const runners = sqliteTable(
  "runners",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull().default(22),
    username: text("username").notNull(),
    labels: text("labels").notNull().default("[]"),
    description: text("description"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    maxConcurrent: integer("max_concurrent").notNull().default(1),
    os: text("os"),
    shells: text("shells").notNull().default("[]"),
    tools: text("tools").notNull().default("[]"),
    /** The machine's host key (base64), pinned when an admin confirms it. */
    hostKey: text("host_key"),
    hostKeyFingerprint: text("host_key_fingerprint"),
    lastTestAt: text("last_test_at"),
    lastTestOk: integer("last_test_ok", { mode: "boolean" }),
    lastLatencyMs: integer("last_latency_ms"),
    lastTestMessage: text("last_test_message"),
    acceptedKeyFingerprint: text("accepted_key_fingerprint"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({ nameIdx: uniqueIndex("runners_team_name_idx").on(table.teamId, table.name) }),
);

export const pipelines = sqliteTable(
  "pipelines",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: text("source").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({ nameIdx: uniqueIndex("pipelines_team_name_idx").on(table.teamId, table.name) }),
);

export const pipelineRuns = sqliteTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey(),
    pipelineId: text("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    teamId: text("team_id").notNull(),
    number: integer("number").notNull(),
    status: text("status").notNull(),
    trigger: text("trigger").notNull(),
    triggeredBy: text("triggered_by").references(() => users.id, { onDelete: "set null" }),
    runnerId: text("runner_id").references(() => runners.id, { onDelete: "set null" }),
    runnerName: text("runner_name"),
    /** The pipeline file exactly as it was when the run was created. */
    source: text("source").notNull(),
    /** A git ref to check out instead of the default (a pushed commit). */
    ref: text("ref"),
    /** The branch the run is for (a push's branch), which a cache belongs to. */
    branch: text("branch"),
    /** JSON: the input values it was started with. */
    inputs: text("inputs").notNull().default("{}"),
    /** The run that started it (another pipeline), if any. */
    upstreamRunId: text("upstream_run_id"),
    /** Re-run from this stage: earlier stages are skipped. */
    fromStage: integer("from_stage"),
    error: text("error"),
    logBytes: integer("log_bytes").notNull().default(0),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => ({
    numberIdx: uniqueIndex("pipeline_runs_pipeline_number_idx").on(table.pipelineId, table.number),
    teamIdx: index("pipeline_runs_team_idx").on(table.teamId, table.createdAt),
    statusIdx: index("pipeline_runs_status_idx").on(table.status),
  }),
);

export const pipelineSteps = sqliteTable(
  "pipeline_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    stageIndex: integer("stage_index").notNull(),
    stepIndex: integer("step_index").notNull(),
    stage: text("stage").notNull(),
    name: text("name").notNull(),
    /** run, checkout, setup, cache, docker or approval. */
    kind: text("kind").notNull().default("run"),
    /** Which attempt (above 1 after a retry). */
    attempt: integer("attempt").notNull().default(1),
    /** For a `pipeline` step: the run it started. */
    childRunId: text("child_run_id"),
    /** JSON: values the step wrote to $ZELYQ_OUTPUT. */
    outputs: text("outputs").notNull().default("{}"),
    /** JSON: its test report summary, when it has `tests:`. */
    tests: text("tests"),
    status: text("status").notNull(),
    exitCode: integer("exit_code"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => ({ runIdx: index("pipeline_steps_run_idx").on(table.runId) }),
);

export const pipelineLogs = sqliteTable(
  "pipeline_logs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    stepId: text("step_id"),
    stream: text("stream").notNull(),
    text: text("text").notNull(),
    at: text("at").notNull(),
  },
  (table) => ({ seqIdx: uniqueIndex("pipeline_logs_run_seq_idx").on(table.runId, table.seq) }),
);

export const pipelineArtifacts = sqliteTable(
  "pipeline_artifacts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    storagePath: text("storage_path").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({ runIdx: index("pipeline_artifacts_run_idx").on(table.runId) }),
);

/** A named place a team's apps run (staging, production), on one of its runners. */
export const deployEnvironments = sqliteTable(
  "deploy_environments",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    runnerId: text("runner_id").references(() => runners.id, { onDelete: "set null" }),
    address: text("address"),
    protected: integer("protected", { mode: "boolean" }).notNull().default(false),
    frozen: integer("frozen", { mode: "boolean" }).notNull().default(false),
    frozenReason: text("frozen_reason"),
    /** JSON: name → typed value (SecretBox ciphertext) or vault://NAME */
    variables: text("variables").notNull().default("{}"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    nameIdx: uniqueIndex("deploy_environments_team_name_idx").on(table.teamId, table.name),
  }),
);

/** Every deploy and roll back of an app to an environment. */
export const deployments = sqliteTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    environmentId: text("environment_id")
      .notNull()
      .references(() => deployEnvironments.id, { onDelete: "cascade" }),
    app: text("app").notNull(),
    number: integer("number").notNull(),
    /** deploying, live, failed, rolled_back, replaced */
    status: text("status").notNull(),
    /** deploy or rollback */
    kind: text("kind").notNull(),
    /** The image on the machine: zelyq-<app>:<number> */
    image: text("image").notNull(),
    /** For a roll back: the deploy whose image it used. */
    rolledBackTo: integer("rolled_back_to"),
    runId: text("run_id").references(() => pipelineRuns.id, { onDelete: "set null" }),
    triggeredBy: text("triggered_by").references(() => users.id, { onDelete: "set null" }),
    url: text("url"),
    port: integer("port").notNull(),
    hostPort: integer("host_port").notNull(),
    healthPath: text("health_path").notNull(),
    error: text("error"),
    /** What happened, one JSON line per log line ({"s": stream, "t": text}). */
    log: text("log").notNull().default(""),
    createdAt: text("created_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (table) => ({
    numberIdx: uniqueIndex("deployments_env_app_number_idx").on(
      table.environmentId,
      table.app,
      table.number,
    ),
  }),
);

/** A run waiting for a person, kept in the database so a restart does not lose it. */
export const pipelineApprovals = sqliteTable(
  "pipeline_approvals",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    stepId: text("step_id")
      .notNull()
      .references(() => pipelineSteps.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    /** admins or editors */
    approvers: text("approvers").notNull(),
    allowSelf: integer("allow_self", { mode: "boolean" }).notNull(),
    deadline: text("deadline").notNull(),
    /** null while waiting; approved or rejected */
    decision: text("decision"),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    comment: text("comment"),
    createdAt: text("created_at").notNull(),
    decidedAt: text("decided_at"),
  },
  (table) => ({ stepIdx: uniqueIndex("pipeline_approvals_step_idx").on(table.stepId) }),
);

export const pipelineTriggers = sqliteTable(
  "pipeline_triggers",
  {
    id: text("id").primaryKey(),
    pipelineId: text("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** JSON: {"branches": [...]} for push, {"cron": "..."} for schedule. */
    config: text("config").notNull(),
    /** Push only: the webhook secret, `SecretBox` ciphertext (needed to check signatures). */
    secret: text("secret"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastFiredAt: text("last_fired_at"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({ pipelineIdx: index("pipeline_triggers_pipeline_idx").on(table.pipelineId) }),
);

/** A pipeline plugin a team installed: one exact version, kept on this server. */
export const pipelinePlugins = sqliteTable(
  "pipeline_plugins",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    /** publisher/name, as a pipeline names it. */
    pluginId: text("plugin_id").notNull(),
    version: text("version").notNull(),
    /** JSON: the package's zelyq-plugin.yml, checked. */
    manifest: text("manifest").notNull(),
    /** SHA-256 of the package file; installing the same version again must match it. */
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    installedBy: text("installed_by").references(() => users.id, { onDelete: "set null" }),
    installedAt: text("installed_at").notNull(),
  },
  (table) => ({
    versionIdx: uniqueIndex("pipeline_plugins_team_version_idx").on(
      table.teamId,
      table.pluginId,
      table.version,
    ),
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
 * An instance-wide connection to an external backend
 * provider (Supabase, for now), managed from Settings alongside the model
 * API keys. The credential lives in `encryptedBlob`, `SecretBox`-encrypted;
 * it is only ever decrypted inside the server's connection service, never
 * handed to the agent, a tool, or a project runtime.
 */
export const providerConnections = sqliteTable(
  "provider_connections",
  {
    id: text("id").primaryKey(),
    /** `"supabase"` or `"figma"`. */
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

/** One provider resource linked to one Zelyq project (for now: at most one). */
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

export const imageGenerations = sqliteTable(
  "image_generations",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    prompt: text("prompt").notNull(),
    provider: text("provider").notNull().default("openai"),
    model: text("model").notNull(),
    size: text("size").notNull(),
    quality: text("quality").notNull(),
    referenceCount: integer("reference_count").notNull().default(0),
    referenceDigest: text("reference_digest").notNull().default(""),
    /** "studio" when a person asked, "agent" when the build agent did. */
    source: text("source").notNull().default("studio"),
    /**
     * Where an agent generation came from. Deliberately NOT a foreign key, and
     * `projectName` is a snapshot rather than a join: a user's library is their
     * own and outlives any project, so deleting a project must not delete their
     * images or erase where they came from.
     */
    projectId: text("project_id").notNull().default(""),
    projectName: text("project_name").notNull().default(""),
    sessionId: text("session_id").notNull().default(""),
    status: text("status").notNull().default("queued"),
    // One outstanding request per user; NULL releases the slot.
    activeOwner: text("active_owner"),
    // Two instance-wide worker slots, protected by a unique index.
    workerSlot: integer("worker_slot"),
    leaseUntil: text("lease_until"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    deletedAt: text("deleted_at"),
    error: text("error"),
    providerRequestId: text("provider_request_id"),
    usage: text("usage"),
    width: integer("width"),
    height: integer("height"),
    sizeBytes: integer("size_bytes"),
  },
  (table) => ({
    requestIdx: uniqueIndex("image_generations_request_idx").on(
      table.ownerId,
      table.idempotencyKey,
    ),
    activeIdx: uniqueIndex("image_generations_active_idx").on(table.activeOwner),
    slotIdx: uniqueIndex("image_generations_slot_idx").on(table.workerSlot),
    historyIdx: index("image_generations_history_idx").on(table.ownerId, table.createdAt),
  }),
);

export const videoAccounts = sqliteTable("video_accounts", {
  ownerId: text("owner_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lock: text("lock").notNull(),
});
export const videoReferences = sqliteTable("video_references", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  digest: text("digest").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at"),
});
export const videoFrameSets = sqliteTable("video_frame_sets", {
  /** One set per video, so the generation IS the key. Re-extracting replaces
   *  it rather than accumulating sets nobody deletes. */
  generationId: text("generation_id")
    .primaryKey()
    .references(() => videoGenerations.id, { onDelete: "cascade" }),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  format: text("format").notNull(),
  count: integer("count").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  fps: text("fps").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: text("created_at").notNull(),
});

export const videoGenerations = sqliteTable(
  "video_generations",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    input: text("input").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    credentialDigest: text("credential_digest").notNull(),
    referenceId: text("reference_id"),
    status: text("status").notNull().default("queued"),
    activeOwner: text("active_owner"),
    workerSlot: integer("worker_slot"),
    leaseToken: text("lease_token"),
    leaseUntil: text("lease_until"),
    nextPollAt: text("next_poll_at").notNull(),
    operation: text("operation"),
    /** Who asked: a person in Video Studio, or the build agent in a project.
     *  `projectName` is a snapshot and there is no foreign key — a user's
     *  library outlives any project, exactly as it does for images. */
    source: text("source").notNull().default("studio"),
    projectId: text("project_id").notNull().default(""),
    projectName: text("project_name").notNull().default(""),
    sessionId: text("session_id").notNull().default(""),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    deletedAt: text("deleted_at"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    storageBytes: integer("storage_bytes").notNull(),
    metadata: text("metadata"),
  },
  (table) => ({
    requestIdx: uniqueIndex("video_generations_request_idx").on(
      table.ownerId,
      table.idempotencyKey,
    ),
    activeIdx: uniqueIndex("video_generations_active_idx").on(table.activeOwner),
    slotIdx: uniqueIndex("video_generations_slot_idx").on(table.workerSlot),
    historyIdx: index("video_generations_history_idx").on(table.ownerId, table.createdAt),
  }),
);

export const schema = {
  videoAccounts,
  videoFrameSets,
  videoReferences,
  videoGenerations,
  imageGenerations,
  users,
  teams,
  teamMembers,
  authSessions,
  oidcIdentities,
  projects,
  sessions,
  messages,
  snapshots,
  vaultEntries,
  vaultEntryVersions,
  projectVariables,
  projectVariableVersions,
  vaultServiceKeys,
  teamSshKeys,
  runners,
  pipelines,
  pipelineRuns,
  pipelineSteps,
  pipelineLogs,
  pipelineArtifacts,
  pipelineApprovals,
  pipelineTriggers,
  deployEnvironments,
  deployments,
  settings,
  auditLog,
  providerConnections,
  providerResources,
  projectProviderLinks,
  providerOperations,
};
