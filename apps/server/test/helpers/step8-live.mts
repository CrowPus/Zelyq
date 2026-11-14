/**
 * Step 8, run by hand (not part of the test suite). On a real model and a
 * real machine, one team lives through an app's first weeks:
 *   A. launch with a database and a kept uploads folder;
 *   B. real data goes in (a database row and an uploaded file);
 *   C. "I changed the app, update the site": one approval, staging then production;
 *   D. from outside: the new version is live and the data and the file survived;
 *   E. a question: what runs where, and how does a change get there;
 *   F. a version that needs a secret nobody has added: Ops asks, waits, then ships.
 * Usage: node --import tsx test/helpers/step8-live.mts <server url> <state dir>
 */
import { execFileSync } from "node:child_process";
import { startLive } from "./ops-live.mjs";

const live = await startLive(
  process.argv[2] ?? "http://127.0.0.1:8093",
  process.argv[3] ?? "/tmp",
  "step8-transcript.txt",
);
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  live.log(`    CHECK ${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
};

function app(version: string, payments: boolean): Record<string, string> {
  return {
    "package.json": JSON.stringify(
      {
        name: "shop",
        version,
        scripts: { start: "node server.js", migrate: "node migrate.js", test: "node --test" },
      },
      null,
      2,
    ),
    Dockerfile:
      'FROM node:22-bookworm\nWORKDIR /app\nCOPY *.js package.json ./\nRUN mkdir -p /app/uploads\nCMD ["node", "server.js"]\n',
    "server.js": `const net = require("net"); const fs = require("fs");
const version = require("./package.json").version;
require("http").createServer((q, s) => {
  if (q.method === "POST" && q.url === "/upload") {
    fs.writeFileSync("/app/uploads/" + Date.now() + ".txt", "a photo");
    return s.end("saved");
  }
  const url = new URL(process.env.DATABASE_URL || "postgres://none:0/none");
  const socket = net.connect(Number(url.port || 5432), url.hostname);
  const done = (database) => {
    socket.destroy();
    s.end(JSON.stringify({ app: "shop", version, database, uploads: fs.readdirSync("/app/uploads").length${payments ? ", payments: Boolean(process.env.STRIPE_KEY)" : ""} }));
  };
  socket.once("connect", () => done(true)); socket.once("error", () => done(false));
}).listen(process.env.PORT || 3000);
`,
    "migrate.js": 'console.log("database up to date");\n',
    "test.test.js":
      'require("node:test")("it adds", () => require("node:assert").equal(1 + 1, 2));\n',
  };
}
const parse = (text: string | undefined) => {
  try {
    return JSON.parse(text ?? "") as Record<string, unknown>;
  } catch {
    return {};
  }
};
const psql = (sql: string) =>
  execFileSync(
    "docker",
    ["exec", "zelyq-db-production-shop", "psql", "-U", "app", "-d", "app", "-tAc", sql],
    { encoding: "utf8" },
  ).trim();

// A. Launch.
await live.writeFiles(app("1.0.0", false));
const launch = await live.job(
  "Put the app Shop online on the machine launch-box: a staging environment and a protected production environment. It needs a Postgres database, and its migrate script must run on every deploy. People upload photos, kept in /app/uploads: those must survive new versions. There is no domain yet, so use the machine's address with ports.",
);
check(
  "A. launch finished as done",
  launch.view.stage === "done",
  `${launch.tokens} tokens, ${launch.seconds}s`,
);
let answers = await live.outsideCheck();
check("A. production answers with its database", parse(answers.production).database === true);

// B. Real data in production.
const productionUrl = (
  await live.call("GET", `/api/teams/${live.teamId}/environments`)
).environments.find((e: any) => e.name === "production")?.live?.[0]?.url;
await fetch(`${productionUrl}/upload`, { method: "POST" }).catch(() => undefined);
psql("create table if not exists orders (id int); insert into orders values (42);");
live.log("    [Outside: one photo uploaded and one order saved in production]");

// C. A change goes out.
await live.writeFiles(app("2.0.0", false));
const ship = await live.job("I changed the app Shop, update the site.");
check(
  "C. ship finished as done",
  ship.view.stage === "done",
  `${ship.tokens} tokens, ${ship.seconds}s`,
);
check("C. one approval was enough", ship.approvals === 1, `${ship.approvals} approval(s)`);

// D. The new version, with the data still there.
answers = await live.outsideCheck();
check("D. staging runs 2.0.0", parse(answers.staging).version === "2.0.0");
check("D. production runs 2.0.0", parse(answers.production).version === "2.0.0");
check("D. the uploaded photo survived", Number(parse(answers.production).uploads) >= 1);
let orders = "";
try {
  orders = psql("select count(*) from orders where id = 42;");
} catch (error) {
  orders = String(error);
}
check("D. the order in the database survived", orders === "1", orders);

// E. A question.
const explain = await live.job(
  "What runs where right now, and how does a change get to production?",
);
check(
  "E. answered without changing anything",
  explain.view.stage === "done" && explain.approvals === 0 && explain.view.steps.length === 0,
  `${explain.tokens} tokens`,
);

// F. A version that needs a secret nobody has added yet.
await live.writeFiles(app("3.0.0", true));
let added = false;
const secret = await live.job(
  "Shop now takes payments: it reads the secret STRIPE_KEY. Ship this version.",
  async (view) => {
    const asked = view.messages.some(
      (m: any) => m.role === "ops" && /STRIPE_KEY/.test(m.text) && /Vault/i.test(m.text),
    );
    if (asked && !added) {
      await live.call("POST", `/api/teams/${live.teamId}/vault`, {
        name: "STRIPE_KEY",
        value: "sk_test_live_scenario_0000000000",
      });
      added = true;
      live.log("    [Founder added STRIPE_KEY to Vault]");
      return "I've added STRIPE_KEY to Vault. Go on.";
    }
    return null;
  },
);
check("F. Ops asked for the secret before shipping", added);
check(
  "F. secret job finished as done",
  secret.view.stage === "done",
  `${secret.tokens} tokens, ${secret.seconds}s`,
);
answers = await live.outsideCheck();
check(
  "F. production runs 3.0.0 with payments ready",
  parse(answers.production).version === "3.0.0" && parse(answers.production).payments === true,
);

const memory = await live.call("GET", `/api/teams/${live.teamId}/ops/memory`);
live.log(
  `\nmemory: ${memory.sheets.length} sheets, ${memory.lessons.length} lessons: ${memory.lessons.map((l: any) => l.text ?? l.lesson ?? "").join(" | ")}`,
);
live.log(
  `tokens: launch ${launch.tokens}, ship ${ship.tokens}, explain ${explain.tokens}, secret ${secret.tokens}`,
);
live.log(`\n${results.join("\n")}`);
