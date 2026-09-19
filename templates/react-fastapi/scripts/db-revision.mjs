// Create a migration from the models and apply it, in one step:
//
//   npm run db:revision -- "add leads table"
//
// Autogenerate compares the models against the database, so the database has to
// be at the latest revision first — skip that and Alembic stops with "Target
// database is not up to date" instead of writing anything. This does the three
// steps in the order that works: bring the project's own database current,
// generate the revision (Alembic's post-write hook tidies it so it passes lint),
// then apply it.
//
// Read the generated file before committing it. Autogenerate is a first draft:
// it guesses at renames, and misses server defaults and some type changes.
import { spawnSync } from "node:child_process";

const message = process.argv.slice(2).join(" ").trim();
if (!message) {
  console.error('Say what the migration does: npm run db:revision -- "add leads table"');
  process.exit(2);
}

function alembic(...args) {
  const result = spawnSync("uv", ["run", "--locked", "alembic", ...args], {
    cwd: "backend",
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

alembic("upgrade", "head");
alembic("revision", "--autogenerate", "-m", message);
alembic("upgrade", "head");
