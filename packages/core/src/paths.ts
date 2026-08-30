import path from "node:path";
import { fileURLToPath } from "node:url";

// `packages/core/src` (tsx) or `packages/core/dist` (built) — the repo root is
// three directories up either way, the same anchor `apps/*/config.ts` and
// `packages/db` use.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Resolve a filesystem path against the **repo root**, not `process.cwd()`.
 *
 * `pnpm --filter <app> <script>` runs each app with its own package directory
 * as the cwd, so a relative `ZELYQ_WORKSPACE_DIR` or data directory would name
 * a different place for the server and the agent — files one process writes
 * would not be visible to the other. An absolute path is returned unchanged.
 */
export function resolveFromRepoRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
}
