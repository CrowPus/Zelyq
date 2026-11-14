/**
 * Step 7, run by hand (not part of the test suite): Ops, on a real model,
 * launches a real app with a database on a real machine, and the result is
 * checked from outside.
 * Usage: node --import tsx test/helpers/launch-live.mts <server url> <state dir>
 */
import { startLive } from "./ops-live.mjs";

const live = await startLive(
  process.argv[2] ?? "http://127.0.0.1:8093",
  process.argv[3] ?? "/tmp",
  "launch-transcript.txt",
);

// The app: answers whether it reaches its database, and whether its update ran.
await live.writeFiles({
  "package.json": JSON.stringify(
    {
      name: "shop",
      version: "1.0.0",
      scripts: { start: "node server.js", migrate: "node migrate.js", test: "node --test" },
    },
    null,
    2,
  ),
  Dockerfile:
    'FROM node:22-bookworm\nWORKDIR /app\nCOPY *.js package.json ./\nRUN mkdir -p /app/data\nCMD ["node", "server.js"]\n',
  "server.js": `const net = require("net"); const fs = require("fs");
require("http").createServer((q, s) => {
  const url = new URL(process.env.DATABASE_URL || "postgres://none:0/none");
  const socket = net.connect(Number(url.port || 5432), url.hostname);
  const done = (database) => { socket.destroy(); s.end(JSON.stringify({ app: "shop", database, migrated: fs.existsSync("/app/data/migrated") })); };
  socket.once("connect", () => done(true)); socket.once("error", () => done(false));
}).listen(process.env.PORT || 3000);
`,
  "migrate.js":
    'require("fs").mkdirSync("/app/data", { recursive: true }); require("fs").writeFileSync("/app/data/migrated", new Date().toISOString());\n',
  "test.test.js":
    'require("node:test")("it adds", () => require("node:assert").equal(1 + 1, 2));\n',
});

const { view } = await live.job(
  "Put the app Shop online on the machine launch-box: a staging environment and a protected production environment. It needs a Postgres database, and its migrate script must run on every deploy. There is no domain yet, so use the machine's address with ports.",
);
await live.outsideCheck();
const memory = await live.call("GET", `/api/teams/${live.teamId}/ops/memory`);
live.log(
  `memory: ${memory.sheets.length} sheets (${memory.sheets.map((s: { subject: string }) => s.subject).join(", ")}), ${memory.lessons.length} lessons`,
);
live.log(`final stage: ${view.stage}`);
