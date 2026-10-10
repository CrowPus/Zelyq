import { execFileSync } from "node:child_process";
import net from "node:net";

/**
 * A real OpenSSH server in a container, for the runner tests. It trusts the
 * public keys it is started with, for the user "ci".
 */

export const SSH_IMAGE = "lscr.io/linuxserver/openssh-server:latest";

export function sshImageAvailable(): boolean {
  try {
    execFileSync("docker", ["image", "inspect", SSH_IMAGE], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface SshServer {
  host: string;
  port: number;
  username: string;
  container: string;
  /** Runs a command as root inside the machine (for test setup only). */
  root(command: string): string;
  stop(): void;
}

export async function startSshServer(publicKeys: string[]): Promise<SshServer> {
  const container = execFileSync("docker", [
    "run",
    "-d",
    "--rm",
    "-p",
    "127.0.0.1::2222",
    "-e",
    `PUBLIC_KEY=${publicKeys.join("\n")}`,
    "-e",
    "USER_NAME=ci",
    "-e",
    "PUID=1000",
    "-e",
    "PGID=1000",
    SSH_IMAGE,
  ])
    .toString()
    .trim();
  const mapping =
    execFileSync("docker", ["port", container, "2222/tcp"]).toString().trim().split("\n")[0] ?? "";
  const port = Number(mapping.split(":").pop());
  const server: SshServer = {
    host: "127.0.0.1",
    port,
    username: "ci",
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
  // The port answers before sshd is up; wait for its banner.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await banner(port)) return server;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  server.stop();
  throw new Error("the test SSH server did not start");
}

function banner(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000, () => done(false));
    socket.on("error", () => done(false));
    socket.on("close", () => done(false));
    socket.on("data", (data) => done(data.toString().startsWith("SSH-")));
  });
}
