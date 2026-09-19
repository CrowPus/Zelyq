// Run exactly the checks this project declares, in one go:
//
//   npm run check
//
// The same list Zelyq runs when a turn ends — `checks` in zelyq.runtime.json —
// so a pass here means a pass there. Nothing stricter is added: a check that is
// not in the manifest (formatting, type-checking the tests) is not a check this
// project has, and failing it proves nothing about whether the app works.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("zelyq.runtime.json", "utf8"));
const results = [];

for (const check of manifest.checks) {
  const started = Date.now();
  const run = spawnSync(check.command, {
    cwd: check.cwd ?? ".",
    shell: true,
    encoding: "utf8",
    timeout: check.timeoutMs ?? 120_000,
  });
  const ok = run.status === 0;
  results.push({ name: check.name, ok, seconds: ((Date.now() - started) / 1000).toFixed(1) });
  if (!ok) {
    // Only the tail: the part that says what broke.
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split("\n").slice(-25).join("\n");
    console.log(`\n✗ ${check.name}\n${output}\n`);
  }
}

console.log("");
for (const { name, ok, seconds } of results) {
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(20)} ${seconds}s`);
}
process.exit(results.every((result) => result.ok) ? 0 : 1);
