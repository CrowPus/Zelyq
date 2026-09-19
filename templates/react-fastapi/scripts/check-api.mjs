// Verify the committed API contract still matches the code, WITHOUT changing it.
//
// An earlier version regenerated in place and then compared. That passes in CI,
// where each run starts from a clean checkout, but it cannot work as a repeated
// check: the first run reports the drift and silently writes it into the working
// tree, so the second run is green and the change has been absorbed with nobody
// reviewing it. The agent's automatic verification runs these checks every turn,
// so a check that edits your source is a check that launders its own failures.
//
// Generate into a temporary directory instead, and diff.
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "api-contract-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "inherit", "inherit"],
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

try {
  const openapi = path.join(scratch, "openapi.json");
  const schema = path.join(scratch, "schema.d.ts");

  // Same two steps as `npm run api:generate`, pointed somewhere disposable.
  run("uv", ["run", "--directory", "backend", "--locked", "python", "-m", "app.openapi"], {
    env: { ...process.env, ZELYQ_OPENAPI_OUT: openapi },
  });
  run("npx", ["openapi-typescript", openapi, "-o", schema]);

  const pairs = [
    ["backend/openapi.json", openapi],
    ["src/lib/api/schema.d.ts", schema],
  ];

  const stale = [];
  for (const [committed, generated] of pairs) {
    const [a, b] = await Promise.all([
      fs.readFile(path.join(root, committed), "utf8").catch(() => null),
      fs.readFile(generated, "utf8"),
    ]);
    if (a !== b) stale.push(committed);
  }

  if (stale.length > 0) {
    console.error(
      `API contract is out of date: ${stale.join(", ")}.\n` +
        "The Python API and the TypeScript client disagree. Run `npm run api:generate`, " +
        "review what changed, and commit it.",
    );
    process.exit(1);
  }
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
