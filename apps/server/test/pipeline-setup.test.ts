import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, test } from "node:test";
import { runnerSetupScript } from "@zelyq/core";
import ssh2 from "ssh2";
import { publicKeyFingerprint } from "../src/services/pipelines/keys.js";
import { SshSession } from "../src/services/pipelines/ssh.js";

/**
 * The "set up a machine" command, run for real: on a machine with an SSH
 * server it must make a user the team's key can sign in as; on Debian (what
 * cloud VMs run) it must also be safe to run twice and set the permissions SSH
 * checks.
 */

const { utils } = ssh2;
const pair = utils.generateKeyPairSync("ed25519", { comment: "zelyq-test" });
let stopContainer: (() => void) | null = null;

/** The script without its `sudo sh -s <<'ZELYQ'` wrapper, to run as root directly. */
function body(script: string): string {
  return script.split("\n").slice(1, -2).join("\n");
}

function hasImage(image: string): boolean {
  try {
    execFileSync("docker", ["image", "inspect", image], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

after(() => stopContainer?.());

test("on Debian with OpenSSH (what cloud VMs run), the team's key signs in as the new user", {
  skip: !hasImage("node:22-bookworm") && "no Debian image",
}, async (t) => {
  // A real sshd, running as root as it does on a VM.
  const container = execFileSync("docker", [
    "run",
    "-d",
    "--rm",
    "-p",
    "127.0.0.1::22",
    "--entrypoint",
    "sh",
    "node:22-bookworm",
    "-c",
    "apt-get update -qq >/dev/null && apt-get install -y -qq openssh-server >/dev/null && mkdir -p /run/sshd && touch /ready && /usr/sbin/sshd -D -e",
  ])
    .toString()
    .trim();
  stopContainer = () => execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      execFileSync("docker", ["exec", container, "test", "-e", "/ready"], { stdio: "ignore" });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  try {
    execFileSync("docker", ["exec", container, "test", "-e", "/ready"], { stdio: "ignore" });
  } catch {
    return t.skip("could not install OpenSSH (offline?)");
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const port = Number(
    execFileSync("docker", ["port", container, "22/tcp"])
      .toString()
      .trim()
      .split("\n")[0]
      ?.split(":")
      .pop(),
  );

  const script = runnerSetupScript({
    os: "linux",
    user: "zelyq",
    publicKey: pair.public,
    admin: false,
  });
  assert.match(script, /^sudo sh -s <<'ZELYQ'\n/);
  const out = execFileSync("docker", ["exec", "-i", container, "sh", "-s"], {
    input: body(script),
  }).toString();
  assert.match(out, /Done\. In Zelyq, add a runner with SSH user: zelyq/);

  const session = await SshSession.open({
    host: "127.0.0.1",
    port,
    username: "zelyq",
    keys: [{ privateKey: pair.private, fingerprint: publicKeyFingerprint(pair.public) }],
    pinnedHostKey: null,
  });
  const who = await session.capture("whoami");
  session.close();
  assert.equal(who.stdout.trim(), "zelyq");
});

test("on Debian it is safe to run twice, and sets what SSH checks", {
  skip: !hasImage("node:22-bookworm") && "no Debian image",
}, () => {
  const script = runnerSetupScript({
    os: "linux",
    user: "zelyq",
    publicKey: pair.public,
    admin: true,
  });
  const check = [
    "groupadd docker",
    body(script),
    body(script),
    'echo "keys=$(wc -l < /home/zelyq/.ssh/authorized_keys)"',
    'echo "modes=$(stat -c %a /home/zelyq/.ssh) $(stat -c %a /home/zelyq/.ssh/authorized_keys)"',
    'echo "owner=$(stat -c %U /home/zelyq/.ssh/authorized_keys)"',
    'echo "groups=$(id -nG zelyq)"',
    'echo "sudo=$(cat /etc/sudoers.d/zelyq-zelyq)"',
    'echo "password=$(getent shadow zelyq | cut -d: -f2)"',
  ].join("\n");
  const out = execFileSync(
    "docker",
    ["run", "--rm", "-i", "--entrypoint", "sh", "node:22-bookworm", "-s"],
    {
      input: check,
    },
  ).toString();
  assert.match(out, /keys=1\b/, "the key is added once, not twice");
  assert.match(out, /modes=700 600/);
  assert.match(out, /owner=zelyq/);
  assert.match(out, /groups=.*\bdocker\b/);
  assert.match(out, /sudo=zelyq ALL=\(ALL\) NOPASSWD:ALL/);
  assert.match(out, /password=\*$/m, "not locked, so SSH lets the key in");
});

test("the command refuses a user name or key that could break it", () => {
  assert.throws(() =>
    runnerSetupScript({
      os: "linux",
      user: "root; rm -rf /",
      publicKey: pair.public,
      admin: false,
    }),
  );
  assert.throws(() =>
    runnerSetupScript({
      os: "linux",
      user: "zelyq",
      publicKey: "ssh-ed25519 AAAA' ; reboot",
      admin: false,
    }),
  );
  const windows = runnerSetupScript({
    os: "windows",
    user: "zelyq",
    publicKey: pair.public,
    admin: false,
  });
  assert.match(windows, /\$U = 'zelyq'/);
  assert.match(windows, /OpenSSH\.Server/);
});
