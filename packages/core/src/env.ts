import fs from "node:fs";
import path from "node:path";

/**
 * Loads the repository's `.env` into `process.env`.
 *
 * Every process is started from a different working directory — `pnpm dev`
 * runs each app with its own package as the cwd — so the file is found by
 * walking up rather than assumed to be next to the process.
 *
 * Uses Node's built-in loader, which does **not** overwrite variables that are
 * already set. A real environment variable therefore always beats the file,
 * which is what a deployment expects.
 */
export function loadEnvFile(startDir: string = process.cwd()): string | null {
  const envPath = findUp(".env", startDir);
  if (!envPath) return null;

  try {
    process.loadEnvFile(envPath);
    return envPath;
  } catch {
    // A malformed or unreadable .env should not stop the process from booting
    // with whatever the real environment already provides.
    return null;
  }
}

function findUp(fileName: string, startDir: string): string | null {
  let directory = path.resolve(startDir);

  while (true) {
    const candidate = path.join(directory, fileName);
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}
