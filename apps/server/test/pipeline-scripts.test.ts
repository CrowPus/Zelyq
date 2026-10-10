import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { PipelineShell } from "@zelyq/core";
import { Masker } from "../src/services/pipelines/mask.js";
import { shellCommand, stepScript, stopCommand } from "../src/services/pipelines/scripts.js";

/**
 * The step scripts, run for real: the exact command a runner is given, with
 * the script on stdin. These are the properties a pipeline depends on, on the
 * shells we can run here; macOS and Windows run the same checks in CI.
 */

const SECRET = "s3cr3t-value-for-the-test";

function run(
  command: string,
  stdin: string,
  options: { cwd?: string; onSpawn?: (pid: number) => void } = {},
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], { cwd: options.cwd, detached: true });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      out += chunk;
    });
    child.on("close", (code) => resolve({ code, out }));
    if (child.pid) options.onSpawn?.(child.pid);
    child.stdin.end(stdin);
  });
}

async function workspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "zelyq-step-"));
}

for (const shell of ["bash", "sh"] as PipelineShell[]) {
  test(`${shell}: variables, folder and exit codes`, async () => {
    const ws = await workspace();
    await fs.mkdir(path.join(ws, "sub"));
    const ok = await run(
      shellCommand(shell),
      stepScript({
        shell,
        workspace: ws,
        workingDirectory: "sub",
        env: { GREETING: 'it\'s "quoted" $HOME', TOKEN: SECRET },
        commands: 'echo "$GREETING"; pwd; printf %s "$TOKEN" | wc -c',
      }),
    );
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /it's "quoted" \$HOME/);
    assert.match(ok.out, new RegExp(`${path.join(ws, "sub").replaceAll("/", "\\/")}`));
    assert.match(ok.out, new RegExp(`\\s${SECRET.length}\\s`));

    const failed = await run(
      shellCommand(shell),
      stepScript({ shell, workspace: ws, env: {}, commands: "echo before\nfalse\necho after" }),
    );
    assert.equal(failed.code, 1);
    assert.match(failed.out, /before/);
    assert.doesNotMatch(failed.out, /after/, "a failing command stops the step");
  });

  test(`${shell}: a command that reads input does not swallow the rest of the step`, async () => {
    const ws = await workspace();
    const result = await run(
      shellCommand(shell),
      stepScript({ shell, workspace: ws, env: {}, commands: "cat\necho still-running" }),
    );
    assert.equal(result.code, 0);
    assert.match(result.out, /still-running/);
  });

  test(`${shell}: a secret is never in the process list`, async () => {
    const ws = await workspace();
    let seen = "";
    const done = run(
      shellCommand(shell),
      stepScript({ shell, workspace: ws, env: { TOKEN: SECRET }, commands: "sleep 1" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    seen = execFileSync("ps", ["-eo", "args"]).toString();
    await done;
    assert.ok(seen.includes("eval"), "the step was running when the list was taken");
    assert.ok(!seen.includes(SECRET), "the secret appeared in ps");
  });

  test(`${shell}: stopping a step stops its whole process tree`, async () => {
    // Unique to this test: the host's process list also shows other tests' containers.
    const marker = shell === "bash" ? 317 : 327;
    const ws = await workspace();
    const started = Date.now();
    const done = run(
      shellCommand(shell),
      stepScript({ shell, workspace: ws, env: {}, commands: `sleep ${marker} &\nsleep ${marker}` }),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    execFileSync("sh", ["-c", stopCommand("linux", ws, false)]);
    const result = await done;
    assert.ok(Date.now() - started < 10_000, "the step did not stop");
    assert.notEqual(result.code, 0);
    const left = execFileSync("ps", ["-eo", "args"])
      .toString()
      .split("\n")
      .filter((l) => l.trim() === `sleep ${marker}`);
    assert.equal(left.length, 0, "a background child outlived the step");
  });
}

const docker = (() => {
  try {
    execFileSync(
      "docker",
      ["image", "inspect", "mcr.microsoft.com/powershell:lts-7.4-ubuntu-22.04"],
      {
        stdio: "ignore",
      },
    );
    return true;
  } catch {
    return false;
  }
})();

test("pwsh: variables, failing native commands, exit and throw", {
  skip: !docker && "no PowerShell image",
}, async () => {
  const pwsh = (commands: string, env: Record<string, string> = {}) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const script = stepScript({ shell: "pwsh", workspace: "/tmp", env, commands });
      // The same arguments the runner command gives pwsh; here without cmd.exe.
      const child = spawn("docker", [
        "run",
        "--rm",
        "-i",
        "mcr.microsoft.com/powershell:lts-7.4-ubuntu-22.04",
        "pwsh",
        "-NoProfile",
        "-NonInteractive",
        "-OutputFormat",
        "Text",
        "-Command",
        "& ([scriptblock]::Create([Console]::In.ReadToEnd()))",
      ]);
      let out = "";
      child.stdout.on("data", (chunk) => {
        out += chunk;
      });
      child.stderr.on("data", (chunk) => {
        out += chunk;
      });
      child.on("close", (code) => resolve({ code, out }));
      child.stdin.end(script);
    });
  const ok = await pwsh('Write-Output "hello $env:NAME"', { NAME: "it's ok" });
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /hello it's ok/);
  assert.ok(
    !ok.out.includes("CLIXML") && !ok.out.includes("\u001b["),
    "plain output, no CLIXML or colour codes",
  );

  const native = await pwsh("sh -c 'exit 7'\nWrite-Output after");
  assert.equal(native.code, 7, native.out);
  assert.doesNotMatch(native.out, /after/, "a failing program stops the step");

  const exits = await pwsh("exit 3");
  assert.equal(exits.code, 3);

  const throws = await pwsh('throw "boom"\nWrite-Output after');
  assert.notEqual(throws.code, 0);
  assert.doesNotMatch(throws.out, /after/);
});

test("the masker hides a secret in any form, even split across output chunks", () => {
  const masker = new Masker([SECRET, "multi\nline-secret-part", "ab"]);
  const lines = [
    ...masker.push(`token=${SECRET.slice(0, 5)}`),
    ...masker.push(`${SECRET.slice(5)} done\n`),
    ...masker.push(
      `b64=${Buffer.from(SECRET).toString("base64")}\nurl=${encodeURIComponent("p@ss w0rd!")}\n`,
    ),
    ...masker.push("line-secret-part appears\nab is too short to mask\n"),
    ...masker.flush(),
  ];
  assert.equal(lines[0], "token=*** done");
  assert.equal(lines[1], "b64=***==", "padding is not secret");
  assert.equal(lines[3], "*** appears");
  assert.equal(lines[4], "ab is too short to mask");
  const url = new Masker(["p@ss w0rd!"]).push(`url=${encodeURIComponent("p@ss w0rd!")}\n`);
  assert.deepEqual(url, ["url=***"]);
});
