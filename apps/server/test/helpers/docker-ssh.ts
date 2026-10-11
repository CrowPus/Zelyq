import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { runnerSetupScript } from "@zelyq/core";
import { DEBIAN_IMAGE } from "./debian-ssh.js";

/**
 * A Debian machine with OpenSSH *and Docker*, like a VM apps are deployed to:
 * it shares this host's network and Docker, so a container it starts answers
 * on 127.0.0.1 here too. Set up with Zelyq's own setup command for `zelyq`.
 */

export interface DockerSsh {
  host: string;
  port: number;
  username: string;
  container: string;
  stop(): void;
}

export function dockerHostAvailable(): boolean {
  try {
    execFileSync("docker", ["image", "inspect", DEBIAN_IMAGE], { stdio: "ignore" });
    return fs.existsSync("/var/run/docker.sock") && fs.existsSync("/usr/bin/docker");
  } catch {
    return false;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolve(address.port) : reject(),
      );
    });
  });
}

export async function startDockerSsh(publicKey: string): Promise<DockerSsh | null> {
  const port = await freePort();
  const socketGroup = fs.statSync("/var/run/docker.sock").gid;
  const mounts = [
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "-v",
    "/usr/bin/docker:/usr/bin/docker:ro",
  ];
  if (fs.existsSync("/usr/libexec/docker/cli-plugins")) {
    mounts.push("-v", "/usr/libexec/docker/cli-plugins:/usr/libexec/docker/cli-plugins:ro");
  }
  const container = execFileSync("docker", [
    "run",
    "-d",
    "--rm",
    "--network",
    "host",
    ...mounts,
    "--entrypoint",
    "sh",
    DEBIAN_IMAGE,
    "-c",
    [
      "apt-get update -qq >/dev/null && apt-get install -y -qq openssh-server >/dev/null",
      `groupadd -g ${socketGroup} docker 2>/dev/null || groupmod -g ${socketGroup} docker`,
      "mkdir -p /run/sshd && touch /ready",
      `exec /usr/sbin/sshd -D -e -p ${port} -o ListenAddress=127.0.0.1`,
    ].join(" && "),
  ])
    .toString()
    .trim();
  const machine: DockerSsh = {
    host: "127.0.0.1",
    port,
    username: "zelyq",
    container,
    stop: () => {
      try {
        execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
      } catch {
        // already gone
      }
    },
  };
  const deadline = Date.now() + 240_000;
  for (;;) {
    try {
      execFileSync("docker", ["exec", container, "test", "-e", "/ready"], { stdio: "ignore" });
      break;
    } catch {
      if (Date.now() > deadline) {
        machine.stop();
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const script = runnerSetupScript({ os: "linux", user: "zelyq", publicKey, admin: false });
  execFileSync("docker", ["exec", "-i", container, "sh", "-s"], {
    input: script.split("\n").slice(1, -2).join("\n"),
  });
  return machine;
}
