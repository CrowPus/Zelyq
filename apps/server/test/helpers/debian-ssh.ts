import { execFileSync } from "node:child_process";
import { runnerSetupScript } from "@zelyq/core";

/**
 * A Debian 12 machine with OpenSSH running as root — what a cloud VM is —
 * set up as a runner with Zelyq's own setup command, for the user `zelyq`.
 */

export const DEBIAN_IMAGE = "node:22-bookworm";

export function debianImageAvailable(): boolean {
  try {
    execFileSync("docker", ["image", "inspect", DEBIAN_IMAGE], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface DebianSsh {
  host: string;
  port: number;
  username: string;
  container: string;
  /** Runs a command as root inside the machine. */
  root(command: string): string;
  stop(): void;
}

/** Null when OpenSSH could not be installed (no network). */
export async function startDebianSsh(publicKey: string): Promise<DebianSsh | null> {
  const container = execFileSync("docker", [
    "run",
    "-d",
    "--rm",
    "-p",
    "127.0.0.1::22",
    "--entrypoint",
    "sh",
    DEBIAN_IMAGE,
    "-c",
    "apt-get update -qq >/dev/null && apt-get install -y -qq openssh-server >/dev/null && mkdir -p /run/sshd && touch /ready && /usr/sbin/sshd -D -e",
  ])
    .toString()
    .trim();
  const machine: DebianSsh = {
    host: "127.0.0.1",
    port: 0,
    username: "zelyq",
    container,
    root: (command) => execFileSync("docker", ["exec", container, "sh", "-c", command]).toString(),
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
  machine.port = Number(
    execFileSync("docker", ["port", container, "22/tcp"])
      .toString()
      .trim()
      .split("\n")[0]
      ?.split(":")
      .pop(),
  );
  const script = runnerSetupScript({ os: "linux", user: "zelyq", publicKey, admin: false });
  execFileSync("docker", ["exec", "-i", container, "sh", "-s"], {
    input: script.split("\n").slice(1, -2).join("\n"),
  });
  return machine;
}
