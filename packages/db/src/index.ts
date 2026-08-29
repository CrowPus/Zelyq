import { createDatabase, type DatabaseHandle } from "./client.js";
import { auditLogRepository } from "./repositories/audit-log.js";
import { authSessionRepository } from "./repositories/auth-sessions.js";
import { messageRepository } from "./repositories/messages.js";
import { oidcIdentityRepository } from "./repositories/oidc-identities.js";
import { projectRepository } from "./repositories/projects.js";
import { providerConnectionRepository } from "./repositories/provider-connections.js";
import { sessionRepository } from "./repositories/sessions.js";
import { settingsRepository } from "./repositories/settings.js";
import { snapshotRepository } from "./repositories/snapshots.js";
import { teamRepository } from "./repositories/teams.js";
import { userRepository } from "./repositories/users.js";

export * from "./client.js";
export { runMigrations } from "./migrate.js";
export type { AuditLogRepository } from "./repositories/audit-log.js";
export type { AuthSessionRepository } from "./repositories/auth-sessions.js";
export type { MessageRepository } from "./repositories/messages.js";
export type { OidcIdentityRepository } from "./repositories/oidc-identities.js";
export type { ProjectRepository } from "./repositories/projects.js";
export type { ProviderConnectionRepository } from "./repositories/provider-connections.js";
export type { SessionRepository } from "./repositories/sessions.js";
export type { SettingsRepository } from "./repositories/settings.js";
export type { SnapshotRepository } from "./repositories/snapshots.js";
export type { TeamRepository } from "./repositories/teams.js";
export type { UserRepository } from "./repositories/users.js";
export * from "./schema/index.js";
export { resolveSetting, type SettingsReader } from "./settings-resolver.js";

export interface Store extends DatabaseHandle {
  users: ReturnType<typeof userRepository>;
  teams: ReturnType<typeof teamRepository>;
  authSessions: ReturnType<typeof authSessionRepository>;
  oidcIdentities: ReturnType<typeof oidcIdentityRepository>;
  projects: ReturnType<typeof projectRepository>;
  sessions: ReturnType<typeof sessionRepository>;
  messages: ReturnType<typeof messageRepository>;
  snapshots: ReturnType<typeof snapshotRepository>;
  settings: ReturnType<typeof settingsRepository>;
  auditLog: ReturnType<typeof auditLogRepository>;
  providerConnections: ReturnType<typeof providerConnectionRepository>;
}

/**
 * The application's entire persistence surface. Handing services a `Store`
 * rather than a Drizzle client keeps SQL in this package, where the dialect
 * difference is already handled.
 */
export function createStore(url: string): Store {
  const handle = createDatabase(url);
  return {
    ...handle,
    users: userRepository(handle.db),
    teams: teamRepository(handle.db),
    authSessions: authSessionRepository(handle.db),
    oidcIdentities: oidcIdentityRepository(handle.db),
    projects: projectRepository(handle.db),
    sessions: sessionRepository(handle.db),
    messages: messageRepository(handle.db),
    snapshots: snapshotRepository(handle.db),
    settings: settingsRepository(handle.db),
    auditLog: auditLogRepository(handle.db),
    providerConnections: providerConnectionRepository(handle.db),
  };
}
