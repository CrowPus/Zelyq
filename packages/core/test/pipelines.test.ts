import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cronMatches,
  PIPELINE_TEMPLATES,
  parseCron,
  parseDuration,
  parsePipelineFile,
  pipelineTarget,
  pipelineVaultNames,
  summariseStages,
} from "../src/pipelines.js";

test("every template is a valid pipeline", () => {
  for (const template of PIPELINE_TEMPLATES) {
    const parsed = parsePipelineFile(template.source);
    assert.equal(parsed.ok, true, `${template.id}: ${JSON.stringify(parsed.issues)}`);
  }
});

test("a full pipeline reads, with durations in seconds and Vault names found", () => {
  const parsed = parsePipelineFile(`name: Release
runs-on: [linux, docker]
source:
  repo: https://github.com/me/shop
  token: vault://GITHUB_TOKEN
env:
  NODE_ENV: production
  STRIPE_KEY: vault://STRIPE_KEY_LIVE
timeout: 1h30m
stages:
  - name: Get
    steps:
      - checkout: true
  - name: Deploy
    if: success()
    steps:
      - run: ./deploy.sh
        shell: bash
        timeout: 10m
        continue-on-error: true
        env:
          REGION: eu
          TOKEN: vault://DEPLOY_TOKEN
artifacts:
  - name: build
    path: dist
`);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.issues));
  if (!parsed.ok) return;
  assert.equal(parsed.file.timeout, 5400);
  assert.equal(parsed.file.stages[1]?.steps[0]?.timeout, 600);
  assert.deepEqual(pipelineVaultNames(parsed.file), [
    "DEPLOY_TOKEN",
    "GITHUB_TOKEN",
    "STRIPE_KEY_LIVE",
  ]);
  assert.deepEqual(pipelineTarget(parsed.file), { kind: "labels", labels: ["linux", "docker"] });
});

test("mistakes are reported in plain words, with the line they are on", () => {
  const parsed = parsePipelineFile(`name: Broken
runs-on: build-01
stages:
  - name: One
    steps:
      - run: echo hi
        shell: fish
      - checkout: true
        run: echo both
`);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const shell = parsed.issues.find((issue) => issue.path === "stages.0.steps.0.shell");
  assert.match(shell?.message ?? "", /Use one of: bash/);
  assert.equal(shell?.line, 7);
  assert.ok(
    parsed.issues.some((issue) =>
      /A step is one thing; this one has run and checkout/.test(issue.message),
    ),
  );
});

test("a checkout without a source is reported once the steps themselves are valid", () => {
  const parsed = parsePipelineFile(`name: No source
runs-on: local
stages:
  - name: Get
    steps:
      - checkout: true
`);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.issues[0]?.message ?? "", /checkout: true needs a source/);
});

test("a token typed into the file is refused — it must come from Vault", () => {
  const parsed = parsePipelineFile(`name: Leak
runs-on: local
source:
  repo: https://github.com/me/shop
  token: ghp_abcdefghijklmnop
stages:
  - name: Get
    steps:
      - checkout: true
`);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.issues[0]?.message ?? "", /must come from Vault/);
});

test("YAML that does not parse says so, with a line", () => {
  const parsed = parsePipelineFile("name: x\nstages:\n  - name: a\n   steps: [");
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.match(parsed.issues[0]?.message ?? "", /Not valid YAML/);
    assert.notEqual(parsed.issues[0]?.line, null);
  }
});

test("paths may not leave the run's folder", () => {
  const parsed = parsePipelineFile(`name: Escape
runs-on: local
stages:
  - name: A
    steps:
      - run: ls
        working-directory: ../../etc
`);
  assert.equal(parsed.ok, false);
});

test("durations", () => {
  assert.equal(parseDuration("90s"), 90);
  assert.equal(parseDuration("30m"), 1800);
  assert.equal(parseDuration("1h30m"), 5400);
  assert.equal(parseDuration(120), 120);
  assert.equal(parseDuration("2d"), 172_800);
  assert.equal(parseDuration("1d12h"), 129_600);
  for (const bad of ["", "d", "m", "-5m", "0s", "1h2d", 0, 1.5])
    assert.equal(parseDuration(bad), null, String(bad));
});

test("cron: five fields, ranges, steps, and both day fields", () => {
  const nightly = parseCron("0 3 * * *");
  assert.ok(nightly);
  assert.equal(cronMatches(nightly, new Date("2026-10-10T03:00:00Z")), true);
  assert.equal(cronMatches(nightly, new Date("2026-10-10T03:01:00Z")), false);

  const every15 = parseCron("*/15 9-17 * * 1-5");
  assert.ok(every15);
  assert.equal(cronMatches(every15, new Date("2026-10-12T09:45:00Z")), true); // a Monday
  assert.equal(cronMatches(every15, new Date("2026-10-11T09:45:00Z")), false); // a Sunday

  const sundaySeven = parseCron("0 0 * * 7");
  assert.ok(sundaySeven && cronMatches(sundaySeven, new Date("2026-10-11T00:00:00Z")));

  // Both day fields restricted: either matches, as cron defines it.
  const either = parseCron("0 12 1 * 1");
  assert.ok(either);
  assert.equal(cronMatches(either, new Date("2026-10-12T12:00:00Z")), true); // Monday the 12th
  assert.equal(cronMatches(either, new Date("2026-10-01T12:00:00Z")), true); // Thursday the 1st

  for (const bad of ["", "* * * *", "60 * * * *", "* 24 * * *", "*/0 * * * *", "a b c d e"]) {
    assert.equal(parseCron(bad), null, bad);
  }
});

test("a stage's status comes from its steps", () => {
  const step = (
    stageIndex: number,
    status: string,
    at: string | null = "2026-01-01T00:00:00Z",
  ) => ({
    stageIndex,
    stage: `S${stageIndex}`,
    status: status as never,
    startedAt: at,
    finishedAt: status === "running" || status === "pending" ? null : at,
  });
  const stages = summariseStages([
    step(0, "passed"),
    step(0, "skipped"),
    step(1, "passed"),
    step(1, "failed"),
    step(2, "skipped", null),
    step(3, "passed"),
    step(3, "running"),
    step(4, "passed"),
    step(4, "pending", null),
  ]);
  assert.deepEqual(
    stages.map((stage) => [stage.name, stage.status, `${stage.done}/${stage.total}`]),
    [
      ["S0", "passed", "2/2"],
      ["S1", "failed", "2/2"],
      ["S2", "skipped", "1/1"],
      ["S3", "running", "1/2"],
      ["S4", "running", "1/2"],
    ],
  );
});
