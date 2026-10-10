import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { resolveToolVersion, type ToolPlatform } from "@zelyq/core";
import { tarGz } from "@zelyq/runtime";
import ssh2 from "ssh2";
import { publicKeyFingerprint } from "../src/services/pipelines/keys.js";
import {
  cleanupCommand,
  defaultShell,
  prepareCommand,
  shellCommand,
  stepScript,
  stopCommand,
  unpackCommand,
  workspacePath,
} from "../src/services/pipelines/scripts.js";
import {
  type MachineFacts,
  probeMachine,
  SshSession,
  type SshTarget,
} from "../src/services/pipelines/ssh.js";
import { cacheRestoreScript, cacheSaveScript } from "../src/services/pipelines/steps.js";
import { posixInstallScript, windowsInstallScript } from "../src/services/pipelines/tools.js";
import { type SshServer, sshImageAvailable, startSshServer } from "./helpers/ssh-server.js";

/**
 * Everything a runner does to a machine, against a real one: find out what it
 * is, make the run's folder, copy an app in, run steps in its default shell,
 * stop a step, clean up.
 *
 * CI points this at macOS and Windows runners through ZELYQ_TEST_SSH_HOST,
 * ZELYQ_TEST_SSH_USER and ZELYQ_TEST_SSH_KEY_FILE; without them it uses the
 * Linux OpenSSH container.
 */

const { utils } = ssh2;
const external = process.env.ZELYQ_TEST_SSH_HOST;
const enabled = Boolean(external) || sshImageAvailable();
let container: SshServer | null = null;
let target: SshTarget;
let session: SshSession;
let facts: MachineFacts;
let ws: string;

async function run(commands: string, env: Record<string, string> = {}) {
  let out = "";
  const shell = defaultShell(facts.os);
  const result = await session.exec(shellCommand(shell), {
    stdin: stepScript({ shell, workspace: ws, env, commands }),
    onStdout: (chunk) => {
      out += chunk;
    },
    onStderr: (chunk) => {
      out += chunk;
    },
  });
  return { code: result.code, out };
}

before(async () => {
  if (!enabled) return;
  if (external) {
    const privateKey = fs.readFileSync(process.env.ZELYQ_TEST_SSH_KEY_FILE ?? "", "utf8");
    target = {
      host: external,
      port: Number(process.env.ZELYQ_TEST_SSH_PORT ?? 22),
      username: process.env.ZELYQ_TEST_SSH_USER ?? os.userInfo().username,
      keys: [{ privateKey, fingerprint: "test" }],
      pinnedHostKey: null,
    };
  } else {
    const pair = utils.generateKeyPairSync("ed25519");
    container = await startSshServer([pair.public]);
    target = {
      host: container.host,
      port: container.port,
      username: container.username,
      keys: [{ privateKey: pair.private, fingerprint: publicKeyFingerprint(pair.public) }],
      pinnedHostKey: null,
    };
  }
  session = await SshSession.open(target);
  facts = await probeMachine(session);
  ws = workspacePath(facts.os, facts.home, `run_contract${Date.now()}`);
});

after(async () => {
  session?.close();
  container?.stop();
});

test("the machine says what it is, and has its default shell", { skip: !enabled }, () => {
  if (process.env.ZELYQ_TEST_EXPECT_OS) assert.equal(facts.os, process.env.ZELYQ_TEST_EXPECT_OS);
  assert.ok(facts.home.length > 1, "home folder found");
  assert.ok(
    facts.shells.includes(defaultShell(facts.os)),
    `${defaultShell(facts.os)} is on the machine: ${facts.shells}`,
  );
  assert.ok(facts.tools.includes("tar"), "tar is on the machine");
});

test("the run's folder is made, an app is copied in, and steps run there", {
  skip: !enabled,
}, async () => {
  assert.equal((await session.exec(prepareCommand(facts.os, ws))).code, 0);
  const local = fs.mkdtempSync(path.join(os.tmpdir(), "zelyq-contract-"));
  fs.mkdirSync(path.join(local, "src"));
  fs.writeFileSync(path.join(local, "src", "hello.txt"), "from the app");
  const archive = await tarGz(local, [{ path: "src/hello.txt" }]);
  let unpackErr = "";
  const unpacked = await session.exec(unpackCommand(facts.os, ws), {
    stdin: archive,
    onStderr: (chunk) => {
      unpackErr += chunk;
    },
  });
  assert.equal(unpacked.code, 0, unpackErr);

  const read = await run(
    facts.os === "windows" ? "Get-Content src/hello.txt" : "cat src/hello.txt",
  );
  assert.equal(read.code, 0, read.out);
  assert.match(read.out, /from the app/);
});

test("variables arrive intact, and exit codes come back", { skip: !enabled }, async () => {
  const value = `it's "quoted" $HOME %PATH% and spaces`;
  const echoed = await run(facts.os === "windows" ? "Write-Output $env:VALUE" : 'echo "$VALUE"', {
    VALUE: value,
  });
  assert.equal(echoed.code, 0, echoed.out);
  assert.ok(echoed.out.includes(value), echoed.out);

  const failing = await run(
    facts.os === "windows" ? "cmd /c exit 7\nWrite-Output after" : "sh -c 'exit 7'\necho after",
  );
  assert.equal(failing.code, 7, failing.out);
  assert.doesNotMatch(failing.out, /after/);
});

test("Stop ends a step and what it started", { skip: !enabled }, async () => {
  const started = Date.now();
  const long = run(
    facts.os === "windows"
      ? "Start-Process -NoNewWindow ping -ArgumentList '-n','300','127.0.0.1'\nStart-Sleep -Seconds 300"
      : "sleep 300 &\nsleep 300",
  );
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const stop = await session.capture(stopCommand(facts.os, ws, facts.os === "windows"));
  assert.equal(stop.code, 0, stop.stderr);
  const result = await long;
  assert.ok(Date.now() - started < 30_000, "the step did not stop");
  assert.notEqual(result.code, 0);
});

test("setup: Node from the approved list is downloaded, checked against its checksum, and runs", {
  skip: !enabled,
}, async (t) => {
  const windows = facts.os === "windows";
  const sep = windows ? "\\" : "/";
  if (!windows) {
    const libc = await session.capture("ldd --version 2>&1 | head -1");
    if (/musl/i.test(libc.stdout)) return t.skip("musl machine: setup needs glibc");
  }
  const arch = (await session.capture(windows ? "echo %PROCESSOR_ARCHITECTURE%" : "uname -m"))
    .stdout;
  const cpu = /arm64|aarch64/i.test(arch) ? "arm64" : "x64";
  const platform = `${facts.os}-${cpu}` as ToolPlatform;
  const release = resolveToolVersion("node", "22");
  const file = release?.files[platform];
  assert.ok(release && file, `an approved Node 22 for ${platform}`);
  const dir = [facts.home, "zelyq", "tools-test", "node", release.version, platform].join(sep);
  const extension = file.url.endsWith(".zip") ? ".zip" : ".tar.gz";
  let out = "";
  const installed = await session.exec(shellCommand(windows ? "powershell" : "sh"), {
    stdin: windows
      ? windowsInstallScript(dir, file, extension)
      : posixInstallScript(dir, file, extension, true, "node"),
    onStdout: (chunk) => {
      out += chunk;
    },
    onStderr: (chunk) => {
      out += chunk;
    },
  });
  assert.equal(installed.code, 0, out);

  const home = [dir, ...file.home.split("/")].join(sep);
  const bins = file.bins.map((bin) => (bin ? [home, ...bin.split("/")].join(sep) : home));
  const shell = defaultShell(facts.os);
  let version = "";
  const ran = await session.exec(shellCommand(shell), {
    stdin: stepScript({ shell, workspace: ws, env: {}, path: bins, commands: "node --version" }),
    onStdout: (chunk) => {
      version += chunk;
    },
  });
  assert.equal(ran.code, 0, version);
  assert.equal(version.trim(), `v${release.version}`);

  // A file that does not match the approved checksum is thrown away.
  const forged = { ...file, sha256: "0".repeat(64) };
  const refused = await session.exec(shellCommand(windows ? "powershell" : "sh"), {
    stdin: windows
      ? windowsInstallScript(`${dir}-forged`, forged, extension)
      : posixInstallScript(`${dir}-forged`, forged, extension, true, "node"),
  });
  assert.notEqual(refused.code, 0, "a file with the wrong checksum was installed");
  await session.exec(cleanupCommand(facts.os, [facts.home, "zelyq", "tools-test"].join(sep)));
});

test("cache: a folder is saved, removed, and restored as it was", { skip: !enabled }, async () => {
  const windows = facts.os === "windows";
  const sep = windows ? "\\" : "/";
  const shell = defaultShell(facts.os);
  const target = [ws, "deps"].join(sep);
  const made = await session.exec(shellCommand(shell), {
    stdin: stepScript({
      shell,
      workspace: ws,
      env: {},
      commands: windows
        ? "New-Item -ItemType Directory -Force -Path deps\\inner | Out-Null; Set-Content -Path deps\\inner\\marker.txt -Value cached"
        : "mkdir -p deps/inner && echo cached > deps/inner/marker.txt",
    }),
  });
  assert.equal(made.code, 0);
  const folder = [facts.home, "zelyq", "cache-test", "p1", "main", "deps"].join(sep);
  const destination = [folder, "key1.tar.gz"].join(sep);
  const install = shellCommand(windows ? "powershell" : "sh");

  const saved = await session.exec(install, {
    stdin: cacheSaveScript(facts.os, target, "deps", folder, destination),
  });
  assert.equal(saved.code, 0, "saved");
  assert.equal((await session.exec(cleanupCommand(facts.os, target))).code, 0);

  let printed = "";
  const restored = await session.exec(install, {
    stdin: cacheRestoreScript(facts.os, target, [[folder, "other.tar.gz"].join(sep), destination]),
    onStdout: (chunk) => {
      printed += chunk;
    },
  });
  assert.equal(restored.code, 0);
  assert.match(printed, /key1\.tar\.gz/, "says which copy it used");
  let content = "";
  await session.exec(shellCommand(shell), {
    stdin: stepScript({
      shell,
      workspace: ws,
      env: {},
      commands: windows ? "Get-Content deps\\inner\\marker.txt" : "cat deps/inner/marker.txt",
    }),
    onStdout: (chunk) => {
      content += chunk;
    },
  });
  assert.equal(content.trim(), "cached");
  await session.exec(cleanupCommand(facts.os, [facts.home, "zelyq", "cache-test"].join(sep)));
});

test("a step whose folder is missing fails; the run's folder is removed afterwards", {
  skip: !enabled,
}, async () => {
  const shell = defaultShell(facts.os);
  const missing = await session.exec(shellCommand(shell), {
    stdin: stepScript({
      shell,
      workspace: ws,
      workingDirectory: "not-there",
      env: {},
      commands: "echo ran",
    }),
  });
  assert.notEqual(missing.code, 0, "a step ran without its folder");

  assert.equal((await session.exec(cleanupCommand(facts.os, ws))).code, 0);
  const check = await session.capture(
    facts.os === "windows"
      ? `powershell -NoProfile -NonInteractive -Command "if (Test-Path -LiteralPath '${ws}') { exit 1 }"`
      : `test ! -e '${ws}'`,
  );
  assert.equal(check.code, 0, "the folder is still there");
});
