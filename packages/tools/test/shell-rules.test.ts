import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { LocalRuntimeDriver } from "@zelyq/runtime";
import { executeTool } from "../src/index.js";
import { refuseCommand, simpleCommands } from "../src/shell-rules.js";

describe("refuseCommand", () => {
  it("allows commands that only mention a dev tool", () => {
    // All six refusals in the recorded history were of this kind.
    for (const command of [
      "cat vite.config.ts",
      "grep -n vite package.json",
      "npm install vite@latest",
      "pnpm add -D vite @vitejs/plugin-react",
      "npx vite build",
      "pnpm vite build && ls dist",
      "npm run build",
      "npm test",
      "sed -n 1,20p src/watch-list.tsx",
      "echo 'npm run dev'",
      "tail -n 50 preview.log",
      "python3 -m pytest",
      "rm -rf node_modules dist",
      "rm -rf ./build",
      "git status && git diff",
      "git checkout -b feature",
      "git branch --list",
      "find src -name '*.test.ts'",
      "find . -name '*.log' -not -path './.git/*'",
    ]) {
      assert.equal(refuseCommand(command), null, command);
    }
  });

  it("refuses commands that never return", () => {
    for (const command of [
      "npm run dev",
      "pnpm dev",
      "yarn start",
      "npx vite",
      "vite --port 4000",
      "npm run build && npx vite preview",
      "cd backend && uvicorn app.main:app --reload",
      "python -m uvicorn app.main:app",
      "fastapi dev app/main.py",
      "python manage.py runserver",
      "tail -f preview.log",
      "FOO=1 nodemon server.js",
    ]) {
      assert.equal(refuseCommand(command)?.kind, "blocking", command);
    }
  });

  it("refuses destruction that used to slip past the old patterns", () => {
    for (const command of [
      "rm -rf ./*",
      "rm -rf .",
      "rm -fr /",
      "sudo rm -r ~/projects",
      "rm -rf .git",
      "find .git -delete",
      "find . -path './.git/*' -delete",
      "git -C . reset --hard",
      "git -c core.x=y reset --hard HEAD~1",
      "git clean -fdx",
      "git checkout -- .",
      "git checkout --force main",
      "git restore .",
      "git push origin main",
      "git remote set-url origin x",
      "git branch -D feature",
      "npm test; git reset --hard",
      "true && (git push)",
    ]) {
      assert.equal(refuseCommand(command)?.kind, "destructive", command);
    }
  });

  it("reads quotes and separators", () => {
    assert.deepEqual(simpleCommands(`echo "a && b" && ls -la | wc -l`), [
      ["echo", "a && b"],
      ["ls", "-la"],
      ["wc", "-l"],
    ]);
    assert.deepEqual(simpleCommands("echo $(git rev-parse HEAD)"), [
      ["echo"],
      ["git", "rev-parse", "HEAD"],
    ]);
  });
});

describe("run_command", () => {
  it("a failure inside a pipe is reported, not hidden by the last command", async () => {
    const workspace = path.join(os.tmpdir(), `zelyq-pipefail-${Date.now()}`);
    const runtime = new LocalRuntimeDriver({
      kind: "local",
      workspaceDir: workspace,
      execTimeoutMs: 30_000,
      previewPortRange: [4909, 4910],
      previewHost: "127.0.0.1",
    });
    try {
      await runtime.ensureProject("prj_pipe");
      const context = {
        projectId: "prj_pipe",
        runtime,
        signal: new AbortController().signal,
        onFileChanged: () => undefined,
        log: () => undefined,
      };
      const failed = await executeTool(context, "run_command", {
        command: "echo 'error TS2304' && false | tail -n 5",
      });
      assert.equal(failed.isError, true, failed.output);
      const ok = await executeTool(context, "run_command", { command: "echo hi | tail -n 1" });
      assert.equal(ok.isError, false, ok.output);
      assert.match(ok.output, /hi/);
    } finally {
      await runtime.dispose();
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
