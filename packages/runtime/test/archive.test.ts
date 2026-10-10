import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { tarGz } from "../src/archive.js";

test("the archive unpacks with the system tar, long and non-ASCII names included", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-archive-"));
  const long = `${"deep/".repeat(30)}file.txt`;
  const files = {
    "package.json": '{"name":"app"}',
    "src/main.ts": "console.log(1)\n",
    [long]: "x",
    "src/café.md": "é",
  };
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  await fs.chmod(path.join(root, "src/main.ts"), 0o755);
  await fs.symlink("/etc/passwd", path.join(root, "link"));
  const archive = await tarGz(
    root,
    [...Object.keys(files), "link"].map((name) => ({ path: name })),
  );

  const out = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-unpacked-"));
  execFileSync("tar", ["-xzf", "-", "-C", out], { input: archive });
  for (const [name, content] of Object.entries(files)) {
    assert.equal(await fs.readFile(path.join(out, name), "utf8"), content, name);
  }
  assert.equal((await fs.stat(path.join(out, "src/main.ts"))).mode & 0o777, 0o755);
  await assert.rejects(() => fs.lstat(path.join(out, "link")), "symlinks are not sent");
});
