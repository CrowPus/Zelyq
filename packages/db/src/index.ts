import { type DatabaseHandle, createDatabase } from "./client.js";
import { messageRepository } from "./repositories/messages.js";
import { projectRepository } from "./repositories/projects.js";
import { sessionRepository } from "./repositories/sessions.js";
import { snapshotRepository } from "./repositories/snapshots.js";

export * from "./client.js";
export { runMigrations } from "./migrate.js";
export * from "./schema/index.js";
export type { ProjectRepository } from "./repositories/projects.js";
export type { SessionRepository } from "./repositories/sessions.js";
export type { MessageRepository } from "./repositories/messages.js";
export type { SnapshotRepository } from "./repositories/snapshots.js";

export interface Store extends DatabaseHandle {
  projects: ReturnType<typeof projectRepository>;
  sessions: ReturnType<typeof sessionRepository>;
  messages: ReturnType<typeof messageRepository>;
  snapshots: ReturnType<typeof snapshotRepository>;
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
    projects: projectRepository(handle.db),
    sessions: sessionRepository(handle.db),
    messages: messageRepository(handle.db),
    snapshots: snapshotRepository(handle.db),
  };
}
