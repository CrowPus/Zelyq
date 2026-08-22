#!/usr/bin/env node
/**
 * Starts the three development processes with prefixed, colour-coded output,
 * and makes sure Ctrl-C takes all of them down together — the thing that is
 * annoying to get right with a bare `&`.
 */
import { spawn } from "node:child_process";
import process from "node:process";

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;

const SERVICES = [
  { name: "server", color: `${ESC}[36m`, filter: "@zelyq/server" },
  { name: "agent ", color: `${ESC}[35m`, filter: "@zelyq/agent" },
  { name: "web   ", color: `${ESC}[32m`, filter: "@zelyq/web" },
];

const children = [];
let shuttingDown = false;

for (const service of SERVICES) {
  const child = spawn("pnpm", ["--filter", service.filter, "dev"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const prefix = `${service.color}${service.name}${RESET} | `;
  const forward = (stream, target) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) target.write(`${prefix}${line}\n`);
    });
  };

  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  child.on("exit", (code) => {
    if (shuttingDown) return;
    process.stdout.write(`${prefix}exited with code ${code}\n`);
    shutdown(code ?? 1);
  });

  children.push(child);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`
  Zelyq is starting.

    web     http://localhost:5173
    server  http://127.0.0.1:8787
    agent   http://127.0.0.1:8788

  Press Ctrl-C to stop all three.
`);
