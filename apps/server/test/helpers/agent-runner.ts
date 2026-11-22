import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";
import { AgentHub, agentKeyFingerprint } from "../../src/services/pipelines/agents.js";
import type { RunnerSession } from "../../src/services/pipelines/ssh.js";

const runnerDir = path.resolve(import.meta.dirname, "..", "..", "..", "runner");
const agentFile = path.join(runnerDir, "dist", "agent.js");

/**
 * The runner program, built (apps/runner/dist/agent.js). A check that builds only the shared packages, as
 * the Zelyq Cloud pipeline does, has not built it: then it is built here, once, from its source.
 */
export function runnerProgram(): string {
  if (!existsSync(agentFile)) {
    execFileSync(
      path.join(runnerDir, "node_modules", ".bin", "tsc"),
      ["-p", path.join(runnerDir, "tsconfig.json")],
      {
        stdio: "inherit",
      },
    );
  }
  return agentFile;
}

/**
 * A runner that connects out to Zelyq, on this machine: the real program (apps/runner, built)
 * signed in to a real AgentHub, for tests that should behave the same on every kind of runner.
 */
export async function startAgentRunner(): Promise<{
  session: RunnerSession;
  home: string;
  stop: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-agent-runner-"));
  const state = path.join(dir, "state");
  const home = path.join(dir, "home");
  await fs.mkdir(state, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const row: Record<string, unknown> = {
    id: "run_agent",
    name: "agent-01",
    kind: "agent",
    hostKey: spki,
    hostKeyFingerprint: agentKeyFingerprint(spki),
    lastSeenAt: null,
  };
  const store = {
    pipelines: {
      runners: {
        findById: async (id: string) => (id === row.id ? row : null),
        update: async (_id: string, patch: Record<string, unknown>) => Object.assign(row, patch),
      },
    },
  };
  const hub = new AgentHub(store as never);
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1", path: "/ws/runner-agent" });
  wss.on("connection", (socket) => hub.accept(socket));
  await new Promise((resolve) => wss.once("listening", resolve));
  const port = (wss.address() as { port: number }).port;
  await fs.writeFile(
    path.join(state, "config.json"),
    JSON.stringify({ url: `http://127.0.0.1:${port}`, runnerId: row.id, name: row.name }),
  );
  await fs.writeFile(
    path.join(state, "key.pem"),
    privateKey.export({ type: "pkcs8", format: "pem" }),
    {
      mode: 0o600,
    },
  );
  const child: ChildProcess = spawn(process.execPath, [runnerProgram(), "run"], {
    env: { ...process.env, ZELYQ_RUNNER_HOME: state, HOME: home, SHELL: "/bin/bash" },
    stdio: "ignore",
  });
  const session = await hub.session(row as never, 15_000);
  return {
    session,
    home,
    stop: async () => {
      child.kill("SIGKILL");
      wss.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
