/**
 * Run by hand (not part of the suite): the watch on a real machine. A real
 * container named like a Zelyq app runs on a test machine reached over SSH;
 * we stop it by hand and time the alert, then start it and see it close
 * (072 §4, Phase 2 tests 1 and 2, the Ops page side).
 * Usage: node --import tsx test/helpers/watch-live.mts <server url> <state dir> <database file>
 */
import { execFileSync } from "node:child_process";
import { createStore } from "@zelyq/db";
import { startLive } from "./ops-live.mjs";

const [base = "http://127.0.0.1:8093", dir = "/tmp", database = ""] = process.argv.slice(2);
const live = await startLive(base, dir, "watch-transcript.txt");
// Named and labelled the way a deploy behind the proxy names and labels it.
const container = "zelyq-watchshop-production-1";
const port = 18181;
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();

docker("rm", "-f", container);
docker(
  "run",
  "-d",
  "--name",
  container,
  "--label",
  "zelyq.deployment=dep_watchlive",
  "-p",
  `${port}:80`,
  "nginx:alpine",
);
const runner = (await live.call("GET", `/api/teams/${live.teamId}/runners`)).runners[0];
const environment = (
  await live.call("POST", `/api/teams/${live.teamId}/environments`, {
    name: "production",
    runnerId: runner.id,
    address: "127.0.0.1",
  })
).environment;
// What a deploy would have recorded: the app is live at this address.
const store = createStore(`file:${database}`);
const now = new Date().toISOString();
await store.deploy.deployments.create({
  id: "dep_watchlive",
  teamId: live.teamId,
  environmentId: environment.id,
  app: "watchshop",
  status: "live",
  kind: "deploy",
  image: "nginx:alpine",
  rolledBackTo: null,
  promotedFrom: null,
  runId: null,
  triggeredBy: null,
  url: `http://127.0.0.1:${port}`,
  port: 80,
  hostPort: port,
  healthPath: "/",
  options: "{}",
  changedDatabase: false,
  error: null,
  log: "",
  createdAt: now,
  finishedAt: now,
} as never);
live.log(
  `set up: container ${container} on port ${port}, environment production on ${runner.name}`,
);

const status = async () => live.call("GET", `/api/teams/${live.teamId}/ops/status`);
const show = (view: any, label: string) => {
  const app = view.apps.find((row: any) => row.app === "watchshop");
  live.log(
    `${label}: light ${app?.light ?? "—"}, checks ${(app?.checks ?? []).map((c: any) => `${c.kind}=${c.state}`).join(" ")}, machines ${view.machines.map((m: any) => `${m.state} (${m.lastDetail})`).join("; ")}, open ${view.open.map((a: any) => a.title).join("; ") || "none"}`,
  );
  return app;
};
const until = async (label: string, done: (view: any) => boolean, ms: number) => {
  const started = Date.now();
  for (;;) {
    const view = await status();
    if (done(view)) {
      show(view, `${label} after ${Math.round((Date.now() - started) / 1000)}s`);
      return Math.round((Date.now() - started) / 1000);
    }
    if (Date.now() - started > ms) {
      show(view, `${label}: NOT REACHED in ${ms / 1000}s`);
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
};

await until(
  "green",
  (view) => view.apps.find((row: any) => row.app === "watchshop")?.light === "green",
  150_000,
);
docker("stop", container);
live.log("stopped the container by hand");
const alertIn = await until("alert open", (view) => view.open.length > 0, 240_000);
docker("start", container);
live.log("started it again");
const closedIn = await until("closed by itself", (view) => view.open.length === 0, 180_000);
const final = await status();
live.log(
  `RESULT alert within ${alertIn ?? "—"}s, closed within ${closedIn ?? "—"}s; recent: ${final.recent.map((a: any) => `${a.title} (${a.closedHow})`).join("; ")}`,
);
docker("rm", "-f", container);
