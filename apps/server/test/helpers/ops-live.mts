/**
 * Shared by the hand-run live scenarios (not part of the test suite): a
 * person's side of a conversation with Ops on a real model and a real
 * machine (an SSH container using this host's Docker). It signs up, adds the
 * machine, writes the app, talks, approves when asked and records everything.
 */
import fs from "node:fs";
import { startDockerSsh } from "./docker-ssh.js";

export interface Live {
  teamId: string;
  projectId: string;
  call: (method: string, url: string, body?: unknown) => Promise<any>;
  log: (line: string) => void;
  writeFiles: (files: Record<string, string>) => Promise<void>;
  /** One job, from the first words to done/failed/stopped, a person answering as it goes. */
  job: (request: string, answer?: (view: any) => Promise<string | null>) => Promise<JobOutcome>;
  outsideCheck: () => Promise<Record<string, string>>;
}

export interface JobOutcome {
  view: any;
  approvals: number;
  tokens: number;
  seconds: number;
}

export async function startLive(base: string, dir: string, transcript: string): Promise<Live> {
  let cookie = "";
  async function call(method: string, url: string, body?: unknown) {
    const res = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const set = res.headers.get("set-cookie");
    if (set?.includes("zelyq_session=")) cookie = set.split(";")[0] as string;
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${url} ${res.status} ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : {};
  }
  const log = (line: string) => {
    console.log(line);
    fs.appendFileSync(`${dir}/${transcript}`, `${line}\n`);
  };

  await call("POST", "/api/auth/register", {
    email: "founder@example.com",
    name: "Founder",
    password: "correct-horse-battery",
  });
  const teamId = (await call("GET", "/api/teams")).teams[0].id as string;
  await call("PUT", "/api/settings", { provider: "google", pipelineLocalRunner: "host" });
  await call("POST", `/api/teams/${teamId}/ops`);

  const keys = (await call("GET", `/api/teams/${teamId}/ssh-keys`)).keys;
  const machine = await startDockerSsh(keys[0].publicKey);
  if (!machine) throw new Error("no test machine");
  fs.writeFileSync(`${dir}/machine.json`, JSON.stringify(machine));
  const runner = (
    await call("POST", `/api/teams/${teamId}/runners`, {
      name: "launch-box",
      host: machine.host,
      port: machine.port,
      username: machine.username,
    })
  ).runner;
  const tested = await call("POST", `/api/teams/${teamId}/runners/${runner.id}/test`);
  await call("POST", `/api/teams/${teamId}/runners/${runner.id}/confirm`, {
    fingerprint: tested.hostKeyFingerprint,
  });
  const projectId = (await call("POST", "/api/projects", { name: "Shop", teamId })).project
    .id as string;
  log(`set up: team ${teamId}, machine launch-box at ${machine.host}:${machine.port}, app Shop`);

  async function writeFiles(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
      await call("PUT", `/api/projects/${projectId}/files/${path}`, { content });
    }
  }

  async function say(jobId: string | undefined, text: string) {
    log(`\n>>> Founder: ${text}`);
    const job = (
      await call("POST", `/api/teams/${teamId}/ops/talk`, { text, ...(jobId ? { jobId } : {}) })
    ).job;
    const seen = new Set<string>(job.messages.map((m: { id: string }) => m.id));
    const started = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 3000));
      const view = (await call("GET", `/api/teams/${teamId}/ops/jobs/${job.id}`)).job;
      for (const m of view.messages) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          log(`<<< ${m.role === "ops" ? "Ops" : m.role}: ${m.text}`);
        }
      }
      if (!view.working) {
        log(
          `    [stage ${view.stage}, ${view.tokens} tokens, ${Math.round((Date.now() - started) / 1000)}s; did: ${view.activity.join(" | ")}]`,
        );
        for (const step of view.steps) {
          log(
            `    step ${step.position + 1} [${step.status}${step.needsApproval ? ", needs approval" : ""}] ${step.words}${step.proof ? ` — checked: ${step.proof.ok} (${step.proof.detail})` : ""}`,
          );
        }
        return view;
      }
      if (Date.now() - started > 25 * 60_000) throw new Error("Ops still working after 25 minutes");
    }
  }

  async function job(request: string, answer?: (view: any) => Promise<string | null>) {
    const started = Date.now();
    let view = await say(undefined, request);
    let approvals = 0;
    for (
      let round = 0;
      round < 8 && !["done", "failed", "stopped"].includes(view.stage);
      round += 1
    ) {
      if (view.stage === "approve") {
        await call("POST", `/api/teams/${teamId}/ops/jobs/${view.id}/plan`, {
          decision: "approve",
          planHash: view.planHash,
        });
        approvals += 1;
        log("    [Founder pressed Approve]");
        const after = (await call("GET", `/api/teams/${teamId}/ops/jobs/${view.id}`)).job;
        for (const step of after.steps) {
          if (step.risk === "always-ask" && step.status === "planned") {
            await call("POST", `/api/teams/${teamId}/ops/jobs/${view.id}/steps/${step.id}/confirm`);
            log(`    [Founder confirmed: ${step.words}]`);
          }
        }
        view = await say(view.id, "Approved. Go on.");
      } else {
        const reply =
          (await answer?.(view)) ?? "Go on. Use your judgment for anything you need to choose.";
        view = await say(view.id, reply);
      }
    }
    const outcome = {
      view,
      approvals,
      tokens: view.tokens as number,
      seconds: Math.round((Date.now() - started) / 1000),
    };
    log(
      `    == job ${view.stage}: ${outcome.approvals} approval(s), ${outcome.tokens} tokens, ${outcome.seconds}s`,
    );
    return outcome;
  }

  async function outsideCheck() {
    const answers: Record<string, string> = {};
    const environments = (await call("GET", `/api/teams/${teamId}/environments`)).environments;
    for (const env of environments) {
      for (const live of env.live ?? []) {
        const answer = await fetch(live.url, { signal: AbortSignal.timeout(5000) })
          .then((r) => r.text())
          .catch((e) => `no answer: ${e.message}`);
        answers[env.name] = answer;
        log(`OUTSIDE CHECK ${env.name}: ${live.app} #${live.number} at ${live.url} → ${answer}`);
      }
    }
    return answers;
  }

  return { teamId, projectId, call, log, writeFiles, job, outsideCheck };
}
