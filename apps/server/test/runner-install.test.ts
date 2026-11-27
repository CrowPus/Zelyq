import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { type RunnerOs, runnerAgentSetupScript } from "@zelyq/core";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { runnerProgram } from "./helpers/agent-runner.js";

/**
 * The install command for a runner that connects out to Zelyq, pasted for real: on Linux, macOS
 * and Windows it must make the runner's user, install Node and the runner, register, start the
 * service, and come online. It changes the machine (a user, a service), so it runs only where
 * ZELYQ_TEST_RUNNER_INSTALL=1: CI's throwaway Linux, macOS and Windows machines.
 */

const enabled = process.env.ZELYQ_TEST_RUNNER_INSTALL === "1";
const here: RunnerOs =
  process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const tmp = path.join(os.tmpdir(), `zelyq-install-${Date.now()}`);
const USER = "zelyqci";

let server: ZelyqServer;
let origin: string;
let owner: string;
let teamId: string;

function call(method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) {
  return server.app.inject({
    method,
    url,
    headers: { cookie: owner, origin },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}
const team = (suffix: string) => `/api/teams/${teamId}${suffix}`;

async function until<T>(what: () => Promise<T | null | undefined | false>, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await what();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("timed out");
}

/**
 * Runs the command the way a person pastes it: a shell on Linux and macOS, PowerShell on Windows.
 * Not spawnSync: the Zelyq it installs from runs in this process and must keep answering.
 */
async function paste(script: string): Promise<{ code: number | null; out: string }> {
  let child: ReturnType<typeof spawn>;
  if (here === "windows") {
    // A file, not standard input: PowerShell reads input line by line and would not run the block.
    const file = path.join(tmp, `install-${Date.now()}.ps1`);
    await fs.writeFile(file, script);
    child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file]);
  } else {
    child = spawn("bash", ["-c", script]);
  }
  let out = "";
  child.stdout?.on("data", (chunk) => {
    out += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    out += chunk;
  });
  child.stdin?.end();
  const timer = setTimeout(() => child.kill(), 600_000);
  return new Promise((resolve) => {
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

function uninstall(): void {
  if (here === "linux") {
    spawnSync("sudo", ["systemctl", "disable", "--now", "zelyq-runner"]);
  } else if (here === "macos") {
    spawnSync("sudo", ["launchctl", "bootout", "system/dev.zelyq.runner"]);
  } else {
    spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Stop-ScheduledTask -TaskName 'Zelyq runner' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'Zelyq runner' -Confirm:$false -ErrorAction SilentlyContinue",
    ]);
  }
}

/** What the runner wrote, to show when it does not come online. */
function runnerLog(): string {
  const read =
    here === "linux"
      ? spawnSync("sudo", ["journalctl", "-u", "zelyq-runner", "--no-pager", "-n", "50"], {
          encoding: "utf8",
        })
      : here === "macos"
        ? spawnSync("sudo", ["cat", `/Users/${USER}/.zelyq-runner/runner.log`], {
            encoding: "utf8",
          })
        : spawnSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-Command",
              `Get-ScheduledTask -TaskName 'Zelyq runner' | Get-ScheduledTaskInfo | Format-List; Get-Content "C:\\Users\\${USER}\\.zelyq-runner\\runner.log" -ErrorAction SilentlyContinue`,
            ],
            { encoding: "utf8" },
          );
  return `${read.stdout ?? ""}${read.stderr ?? ""}`;
}

before(async () => {
  if (!enabled) return;
  runnerProgram();
  await fs.mkdir(tmp, { recursive: true });
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, "zelyq.db")}`,
    agentUrl: "http://127.0.0.1:59999",
    provider: "anthropic",
    model: "claude-opus-5",
    effort: "high",
    allowRegistration: true,
    sessionTtlDays: 30,
    templatesDir: path.join(repoRoot, "templates"),
    webDir: null,
    secretKey: undefined,
    secretKeyFile: path.join(tmp, "secret.key"),
    attachmentsDir: path.join(tmp, "attachments"),
    uploadedSkillsDir: path.join(tmp, "skills"),
    pipelinesDir: path.join(tmp, "pipelines"),
    runtime: {
      kind: "local",
      workspaceDir: path.join(tmp, "workspace"),
      execTimeoutMs: 30_000,
      previewPortRange: [4976, 4979],
      previewHost: "127.0.0.1",
    },
  };
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  origin = `http://127.0.0.1:${(server.app.server.address() as { port: number }).port}`;
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: "correct-horse-battery" },
  });
  owner = String(registered.headers["set-cookie"]).split(";")[0] as string;
  teamId = (await call("GET", "/api/teams")).json().teams[0].id;
});

after(async () => {
  if (!enabled) return;
  uninstall();
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
});

test(`the install command makes this ${here} machine a runner`, { skip: !enabled }, async () => {
  const added = await call("POST", team("/runners/agent"), { name: "installed-01" });
  assert.equal(added.statusCode, 201, added.body);
  const { runner, install } = added.json();

  const pasted = await paste(
    runnerAgentSetupScript({ os: here, user: USER, admin: false, install }),
  );
  assert.equal(pasted.code, 0, pasted.out);
  assert.match(pasted.out, /Done\. The runner is connecting to Zelyq/);

  try {
    await until(async () => {
      const list = (await call("GET", team("/runners"))).json().runners as Array<{
        name: string;
        online: boolean;
      }>;
      return list.find((r) => r.name === "installed-01" && r.online);
    }, 90_000);
  } catch {
    assert.fail(`The runner did not come online.\n${runnerLog()}`);
  }

  // It is this machine, running as the user the command made.
  const tested = (await call("POST", team(`/runners/${runner.id}/test`))).json();
  assert.equal(tested.ok, true, tested.message);
  assert.equal(tested.os, here);

  // A pipeline runs on it, in the machine's own shell.
  const created = await call("POST", team("/pipelines"), {
    source: [
      "name: On the installed runner",
      "runs-on: installed-01",
      "stages:",
      "  - name: Work",
      "    steps:",
      "      - name: Say who runs it",
      "        run: echo ran-as-runner",
      "",
    ].join("\n"),
  });
  assert.equal(created.statusCode, 201, created.body);
  const started = await call("POST", team(`/pipelines/${created.json().pipeline.id}/runs`), {});
  assert.equal(started.statusCode, 201, started.body);
  const runId = started.json().run.id;
  const done = await until(async () => {
    const run = (await call("GET", team(`/pipeline-runs/${runId}`))).json().run;
    if (["queued", "running"].includes(run.status)) return null;
    const log = (await call("GET", team(`/pipeline-runs/${runId}/logs?after=0`))).json();
    return { run, log: log.lines.map((line: { text: string }) => line.text).join("\n") as string };
  }, 180_000);
  assert.equal(done.run.status, "passed", done.log);
  assert.match(done.log, /ran-as-runner/);

  // Pasting it again (a new code) reinstalls it over the one already there.
  const again = (await call("POST", team(`/runners/${runner.id}/install-code`))).json();
  const repasted = await paste(
    runnerAgentSetupScript({ os: here, user: USER, admin: false, install: again.install }),
  );
  assert.equal(repasted.code, 0, repasted.out);
  await until(async () => {
    const list = (await call("GET", team("/runners"))).json().runners as Array<{
      name: string;
      online: boolean;
    }>;
    return list.find((r) => r.name === "installed-01" && r.online);
  }, 90_000);
});
