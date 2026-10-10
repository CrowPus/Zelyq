import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import ssh2 from "ssh2";
import { publicKeyFingerprint } from "../src/services/pipelines/keys.js";
import { shellCommand, stepScript, stopCommand } from "../src/services/pipelines/scripts.js";
import {
  probeMachine,
  type SshError,
  SshSession,
  type SshTarget,
} from "../src/services/pipelines/ssh.js";
import { type SshServer, sshImageAvailable, startSshServer } from "./helpers/ssh-server.js";

const { utils } = ssh2;

/**
 * The SSH layer against a real OpenSSH server: which key is offered, the
 * host-key pin, and a step run the way a runner runs it.
 */

const available = sshImageAvailable();
const trusted = utils.generateKeyPairSync("ed25519", { comment: "trusted" });
const retiring = utils.generateKeyPairSync("ed25519", { comment: "retiring" });
const stranger = utils.generateKeyPairSync("ed25519", { comment: "stranger" });
let server: SshServer;
let hostKey: string;

const key = (pair: { private: string; public: string }) => ({
  privateKey: pair.private,
  fingerprint: publicKeyFingerprint(pair.public),
});
const target = (overrides: Partial<SshTarget> = {}): SshTarget => ({
  host: server.host,
  port: server.port,
  username: server.username,
  keys: [key(trusted)],
  pinnedHostKey: hostKey,
  ...overrides,
});

before(async () => {
  if (!available) return;
  server = await startSshServer([trusted.public, retiring.public]);
  const first = await SshSession.open(target({ pinnedHostKey: null }));
  hostKey = first.hostKey.toString("base64");
  first.close();
});

after(() => server?.stop());

test("the fingerprint matches what OpenSSH prints for the key", {
  skip: !available && "no SSH image",
}, () => {
  const printed = server.root(
    "ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null || true",
  );
  const ours = Buffer.from(hostKey, "base64");
  // The server may present another host key type; only compare when it is ed25519.
  if (ours.subarray(4, 15).toString() === "ssh-ed25519") {
    assert.match(
      printed,
      new RegExp(publicKeyFingerprint(`ssh-ed25519 ${hostKey}`).replaceAll("+", "\\+")),
    );
  }
  assert.equal(
    publicKeyFingerprint(trusted.public),
    server
      .root(`printf '%s\\n' '${trusted.public}' > /tmp/k.pub && ssh-keygen -lf /tmp/k.pub`)
      .split(" ")[1],
  );
});

test("a pinned machine connects; a changed one is refused", {
  skip: !available && "no SSH image",
}, async () => {
  const session = await SshSession.open(target());
  const facts = await probeMachine(session);
  session.close();
  assert.equal(facts.os, "linux");
  assert.ok(facts.shells.includes("bash") && facts.shells.includes("sh"));
  assert.equal(facts.home, "/config");

  const other = utils.generateKeyPairSync("ed25519").public.split(" ")[1] as string;
  await assert.rejects(
    () => SshSession.open(target({ pinnedHostKey: other })),
    (error: SshError) =>
      error.kind === "host_key_changed" && /identity changed/.test(error.message),
  );
});

test("only the team's keys are offered: a stranger's key is refused, a retiring key still works", {
  skip: !available && "no SSH image",
}, async () => {
  await assert.rejects(
    () => SshSession.open(target({ keys: [key(stranger)] })),
    (error: SshError) => error.kind === "auth" && /authorized_keys/.test(error.message),
  );
  const session = await SshSession.open(target({ keys: [key(stranger), key(retiring)] }));
  assert.equal(session.acceptedKeyFingerprint, publicKeyFingerprint(retiring.public));
  session.close();
});

test("a step runs over SSH with its secret on stdin only, and Stop ends it", {
  skip: !available && "no SSH image",
}, async () => {
  const session = await SshSession.open(target());
  const ws = "/config/zelyq/runs/test1";
  await session.capture(`mkdir -p ${ws}`);
  let out = "";
  const result = await session.exec(shellCommand("bash"), {
    stdin: stepScript({
      shell: "bash",
      workspace: ws,
      env: { TOKEN: "xxxxxxxxxxxxx" },
      commands: 'echo "len $(printf %s "$TOKEN" | wc -c)"; exit 4',
    }),
    onStdout: (chunk) => {
      out += chunk;
    },
    onStderr: (chunk) => {
      out += chunk;
    },
  });
  assert.equal(result.code, 4, out);
  assert.match(out, /len\s+13/);

  const started = Date.now();
  const long = session.exec(shellCommand("bash"), {
    stdin: stepScript({
      shell: "bash",
      workspace: ws,
      env: {},
      commands: "sleep 300 &\nsleep 300",
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const stopper = await SshSession.open(target());
  await stopper.capture(stopCommand("linux", ws, false));
  const stopped = await long;
  assert.ok(Date.now() - started < 10_000);
  assert.notEqual(stopped.code, 0);
  const left = (await stopper.capture("ps -eo args")).stdout
    .split("\n")
    .filter((line) => line.trim() === "sleep 300");
  assert.equal(left.length, 0, "a background child outlived the step");
  stopper.close();
  session.close();
});

test("an unreachable machine fails quickly with a clear message", async () => {
  await assert.rejects(
    () =>
      SshSession.open(
        { host: "127.0.0.1", port: 1, username: "ci", keys: [key(trusted)], pinnedHostKey: null },
        { timeoutMs: 3000 },
      ),
    (error: SshError) =>
      error.kind === "unreachable" && /Could not reach 127\.0\.0\.1:1/.test(error.message),
  );
});
