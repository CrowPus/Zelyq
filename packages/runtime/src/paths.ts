import { realpath } from "node:fs/promises";
import path from "node:path";
import { ZelyqError } from "@zelyq/core";

/**
 * Path containment. Everything a model writes is untrusted input, and the most
 * common way a sandbox leaks is a `../` that nobody checked.
 *
 * `resolveInside` is deliberately strict: it rejects rather than clamps, so a
 * bad path surfaces as an error the agent can see and correct instead of
 * silently writing somewhere unexpected.
 */
export function resolveInside(root: string, relativePath: string): string {
  if (relativePath.includes("\0")) {
    throw ZelyqError.badRequest("Path contains a null byte");
  }

  const normalizedRoot = path.resolve(root);
  const candidate = path.resolve(normalizedRoot, relativePath);

  if (candidate !== normalizedRoot && !candidate.startsWith(normalizedRoot + path.sep)) {
    throw ZelyqError.badRequest(`Path escapes the project root: ${relativePath}`);
  }

  return candidate;
}

/**
 * Second line of defence, for paths that already exist: a symlink can point
 * outside the root even when the textual path looks fine. Resolves the real
 * path and re-checks containment.
 */
export async function assertRealPathInside(root: string, absolutePath: string): Promise<void> {
  const normalizedRoot = await realpath(path.resolve(root)).catch(() => path.resolve(root));

  let real: string;
  try {
    real = await realpath(absolutePath);
  } catch (error) {
    // Missing files are fine here — a write is allowed to create them. Their
    // parent directory is what must be inside the root.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const parent = path.dirname(absolutePath);
      const realParent = await realpath(parent).catch(() => parent);
      if (realParent !== normalizedRoot && !realParent.startsWith(normalizedRoot + path.sep)) {
        throw ZelyqError.badRequest("Path resolves outside the project root");
      }
      return;
    }
    throw error;
  }

  if (real !== normalizedRoot && !real.startsWith(normalizedRoot + path.sep)) {
    throw ZelyqError.badRequest("Path resolves outside the project root via a symlink");
  }
}

/** Normalise to the forward-slash form used by the API and the UI. */
export function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

/** Directories excluded from the file tree unless explicitly requested. */
export const DEFAULT_IGNORED = new Set([
  "node_modules",
  ".git",
  ".zelyq",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  ".DS_Store",
]);

export function isIgnored(name: string): boolean {
  return DEFAULT_IGNORED.has(name);
}
