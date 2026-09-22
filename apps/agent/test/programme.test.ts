import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentConfig } from "../src/config.js";
import {
  claimsDone,
  PROGRAMME_FILE,
  parseExecutionTable,
  programmeHandback,
  testPathsIn,
  validateExecutionTable,
} from "../src/programme.js";
import { buildSystemPrompt } from "../src/prompt.js";
import type {
  Conversation,
  ModelProvider,
  ProviderEvent,
  ToolResult,
  TurnResult,
} from "../src/providers/index.js";
import { buildAgentServer } from "../src/server.js";

/**
 * Case study 001: handed a 3,450-line specification, the agent wrote the
 * whole system in one turn, marked every phase "Completed — Turn 1", cited
 * the starter's tests as proof and shipped hardcoded jobs. These tests hold
 * the two halves of the fix: the prompt that tells the model what a
 * programme is, and the validator that refuses a DONE with nothing behind it.
 */

const SPEC_TABLE = `# Project execution

| Phase | Name | Dependencies | Status | Acceptance Criteria | Tests | Evidence | Started | Completed | Commit/Checkpoint | Blockers |
|---|---|---|---|---|---|---|---|---|---|---|
| Phase 0 | Repository & Quality Baseline | None | Completed | Baseline established | test_api.py baseline | \`npm run check\` passes | Turn 1 | Turn 1 | init-baseline | None |
| Phase 4 | Opportunity Discovery | Phase 1, 3 | Completed | Multi-source ingest | test_api.py, security.py | Discovered opportunities listed | Turn 1 | Turn 1 | discovery-engine | None |
| Phase 5 | Matching | Phase 4 | IN_PROGRESS | scoring | backend/tests/test_match.py | | Turn 2 | | | |
`;

const HONEST_TABLE = `| Phase | Name | Dependencies | Status | Acceptance criteria | Tests | Evidence | Started | Completed | Blockers |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Discovery & baseline | — | DONE | spec read; APIs probed | n/a: documents only — probes recorded under tests/fixtures | greenhouse/lever/ashby fetched 2026-09-21, fixtures under backend/tests/fixtures | d1 | d1 | |
| 1 | Foundation | 0 | DONE | migration on fresh + legacy db | backend/tests/test_1_foundation.py | alembic upgrade head on a fresh file and on a copy of application.db: 45 tables, no drift | d1 | d1 | |
| 2 | Discovery | 1 | VERIFYING | live run | backend/tests/test_2_connectors.py | | d2 | | |
`;

test("parses the specification's own eleven-column table and the template's ten-column one", () => {
  const spec = parseExecutionTable(SPEC_TABLE);
  assert.equal(spec.length, 3);
  assert.equal(spec[0]!.phase, "Phase 0");
  assert.equal(spec[0]!.name, "Repository & Quality Baseline");
  assert.equal(spec[0]!.status, "Completed");
  assert.equal(spec[1]!.tests, "test_api.py, security.py");
  assert.equal(spec[2]!.evidence, "");
  assert.equal(spec[2]!.line, 7);

  const honest = parseExecutionTable(HONEST_TABLE);
  assert.equal(honest.length, 3);
  assert.equal(honest[1]!.tests, "backend/tests/test_1_foundation.py");
  assert.equal(parseExecutionTable("# nothing here\n\nno table").length, 0);
});

test("recognises completion claims in any wording, and path-looking test references", () => {
  assert.ok(claimsDone("Completed"));
  assert.ok(claimsDone("DONE ✅"));
  assert.ok(claimsDone("done"));
  assert.ok(!claimsDone("IN_PROGRESS"));
  assert.ok(!claimsDone("VERIFYING"));
  assert.deepEqual(testPathsIn("backend/tests/test_1_foundation.py, src/lib/format.test.ts"), [
    "backend/tests/test_1_foundation.py",
    "src/lib/format.test.ts",
  ]);
  assert.deepEqual(testPathsIn("test_api.py baseline"), ["test_api.py"]);
  assert.deepEqual(testPathsIn("—"), []);
});

test("a DONE without a real test file or evidence is a problem; the case-study table has three", async () => {
  const rows = parseExecutionTable(SPEC_TABLE);
  const existing = new Set(["backend/tests/test_match.py"]);
  const problems = await validateExecutionTable(rows, async (p) => existing.has(p));
  // Phase 0: "Completed" is not the vocabulary AND its test file does not exist.
  // Phase 4: same, plus the evidence is a claim, so it survives the length check
  // but the test file "test_api.py" (the starter's) does not exist here.
  assert.ok(problems.some((p) => p.includes("Phase 0") && p.includes('status "Completed"')));
  assert.ok(problems.some((p) => p.includes("Phase 0") && p.includes("do")));
  assert.ok(problems.some((p) => p.includes("Phase 4") && p.includes("does not exist")));
  // Phase 5 is honestly IN_PROGRESS: nothing to say about it.
  assert.ok(!problems.some((p) => p.includes("Phase 5")));
  const handback = programmeHandback(problems);
  assert.ok(handback?.startsWith(`${PROGRAMME_FILE} claims more than the project backs up`));
  assert.ok(handback?.includes("an honest IN_PROGRESS is fine"));
});

test("an honest table passes: existing test files, an explicit n/a with a reason, real evidence", async () => {
  const rows = parseExecutionTable(HONEST_TABLE);
  const existing = new Set([
    "backend/tests/test_1_foundation.py",
    "backend/tests/test_2_connectors.py",
  ]);
  const problems = await validateExecutionTable(rows, async (p) => existing.has(p));
  assert.deepEqual(problems, []);
  assert.equal(programmeHandback(problems), null);
});

test("a bare dash or a status word is not evidence, and 'n/a' needs a reason", async () => {
  const table = `| Phase | Name | Status | Tests | Evidence |
|---|---|---|---|---|
| 1 | Foundation | DONE | backend/tests/test_1.py | — |
| 2 | Docs | DONE | n/a | docs written and reviewed against the spec |
| 3 | Queue | DONE | backend/tests/test_3.py | Verified |
`;
  const rows = parseExecutionTable(table);
  const problems = await validateExecutionTable(rows, async () => true);
  assert.equal(problems.length, 3);
  assert.ok(problems[0]!.includes("1 (Foundation) is DONE but records no evidence"));
  assert.ok(problems[1]!.includes("2 (Docs) is DONE but its Tests cell names no test file"));
  assert.ok(problems[2]!.includes("3 (Queue) is DONE but records no evidence"));
});

test("the system prompt teaches programmes and forbids fabricated data on a production path", () => {
  const prompt = buildSystemPrompt({ projectName: "x", template: "react-fastapi" });
  assert.ok(prompt.includes("<programme>"), "programme section present");
  assert.ok(prompt.includes('use_skill("spec-driven-production-build")'));
  assert.ok(prompt.includes("Never mark DONE because code was written"));
  assert.ok(prompt.includes("Truthful data."));
  assert.ok(prompt.includes("no seeded persona"));
  assert.ok(prompt.includes("it is a class, not a line"), "class-of-defect audit rule present");
  assert.ok(
    !prompt.includes("build the UI against clearly-marked placeholder data"),
    "the old placeholder licence is gone",
  );
  const engineer = buildSystemPrompt({
    projectName: "x",
    template: "react-fastapi",
    engineerMode: { skill: { body: "skill", resources: [] } },
  });
  assert.ok(
    engineer.includes("A programme — see <programme>"),
    "checkpoint text names the exemption",
  );
});

// --- the gate, end to end through a real turn -------------------------------------

function scriptedProvider(script: Array<{ events: ProviderEvent[]; result: TurnResult }>): {
  provider: ModelProvider;
  injected: string[];
} {
  let turnIndex = 0;
  const injected: string[] = [];
  const conversation: Conversation = {
    addUserMessage: (text: string) => {
      injected.push(text);
    },
    addToolResults: (_results: ToolResult[]) => undefined,
    async *stream() {
      const step = script[Math.min(turnIndex++, script.length - 1)]!;
      for (const event of step.events) yield event;
      return step.result;
    },
  };
  return {
    provider: { id: "anthropic", model: "scripted", createConversation: () => conversation },
    injected,
  };
}

async function collectTurn(url: string): Promise<Array<{ type: string; [key: string]: unknown }>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "continue the programme" }),
  });
  const text = await response.text();
  return text
    .split("\n\n")
    .map((frame) => frame.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)));
}

async function setup(table: string, testFiles: string[]) {
  const workspaceDir = path.join(
    os.tmpdir(),
    `zelyq-programme-test-${Date.now()}-${Math.random()}`,
  );
  const projectId = "prj_programme";
  const root = path.join(workspaceDir, projectId);
  await fs.mkdir(root, { recursive: true });
  // No typecheck/build script: the programme table alone must trigger the gate.
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
  await fs.writeFile(path.join(root, PROGRAMME_FILE), table);
  for (const file of testFiles) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), "def test_ok(): pass\n");
  }
  const writes = {
    events: [{ type: "text" as const, text: "Marking it done." }],
    result: {
      toolCalls: [
        { id: "call_1", name: "write_file", input: { path: "src/note.ts", content: "x" } },
      ],
      stopReason: "tool_use" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    },
  };
  const saysDone = {
    events: [{ type: "text" as const, text: "REMAINING: none" }],
    result: {
      toolCalls: [],
      stopReason: "end_turn" as const,
      usage: { inputTokens: 3, outputTokens: 2 },
    },
  };
  const scripted = scriptedProvider([writes, saysDone, saysDone]);
  const config: AgentConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    provider: "anthropic",
    model: "scripted",
    effort: "high",
    apiKey: "test-key",
    maxTurnIterations: 5,
    runtime: {
      kind: "local",
      workspaceDir,
      execTimeoutMs: 10_000,
      previewPortRange: [4960, 4970],
      previewHost: "127.0.0.1",
    },
  };
  const server = buildAgentServer(config, { providerFactory: () => scripted.provider });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const created = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "ses_programme", projectId }),
  });
  assert.equal(created.status, 201);
  return { base, injected: scripted.injected, close: () => server.app.close() };
}

test("a DONE phase with no test behind it is handed back to the model before the turn ends", async () => {
  const { base, injected, close } = await setup(SPEC_TABLE, ["backend/tests/test_match.py"]);
  try {
    const events = await collectTurn(`${base}/sessions/ses_programme/prompt`);
    const verify = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "verify",
    );
    assert.ok(verify, "the phase table alone triggers a verify step");
    assert.equal((verify!.call as { isError: boolean }).isError, true);
    assert.ok(
      injected.some(
        (text) =>
          text.includes("claims more than the project backs up") && text.includes("Phase 4"),
      ),
      "the hand-back names the offending phase",
    );
    assert.equal(events.at(-1)?.type, "turn.end");
  } finally {
    await close();
  }
});

test("an honest phase table passes the gate and reports the count", async () => {
  const { base, injected, close } = await setup(HONEST_TABLE, [
    "backend/tests/test_1_foundation.py",
    "backend/tests/test_2_connectors.py",
  ]);
  try {
    const events = await collectTurn(`${base}/sessions/ses_programme/prompt`);
    const verify = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "verify",
    );
    assert.ok(verify);
    assert.equal((verify!.call as { isError: boolean }).isError, false);
    assert.ok(String((verify!.call as { result: string }).result).includes("2/3 phases DONE"));
    assert.ok(!injected.some((text) => text.includes("claims more than")));
  } finally {
    await close();
  }
});
