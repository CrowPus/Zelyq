import { type DatabaseHandle, createDatabase } from "./client.js";
import { authSessionRepository } from "./repositories/auth-sessions.js";
import { messageRepository } from "./repositories/messages.js";
import { projectRepository } from "./repositories/projects.js";
import { sessionRepository } from "./repositories/sessions.js";
import { settingsRepository } from "./repositories/settings.js";
import { snapshotRepository } from "./repositories/snapshots.js";
import { teamRepository } from "./repositories/teams.js";
import { userRepository } from "./repositories/users.js";

export * from "./client.js";
export { runMigrations } from "./migrate.js";
export * from "./schema/index.js";
export type { ProjectRepository } from "./repositories/projects.js";
export type { SessionRepository } from "./repositories/sessions.js";
export type { MessageRepository } from "./repositories/messages.js";
export type { SnapshotRepository } from "./repositories/snapshots.js";
export type { UserRepository } from "./repositories/users.js";
export type { TeamRepository } from "./repositories/teams.js";
export type { AuthSessionRepository } from "./repositories/auth-sessions.js";
export type { SettingsRepository } from "./repositories/settings.js";

export interface Store extends DatabaseHandle {
  users: ReturnType<typeof userRepository>;
  teams: ReturnType<typeof teamRepository>;
  authSessions: ReturnType<typeof authSessionRepository>;
  projects: ReturnType<typeof projectRepository>;
  sessions: ReturnType<typeof sessionRepository>;
  messages: ReturnType<typeof messageRepository>;
  snapshots: ReturnType<typeof snapshotRepository>;
  settings: ReturnType<typeof settingsRepository>;
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
    projects: projectRepository(handle.db),
    sessions: sessionRepository(handle.db),
    messages: messageRepository(handle.db),
    snapshots: snapshotRepository(handle.db),
    settings: settingsRepository(handle.db),
  };
}
