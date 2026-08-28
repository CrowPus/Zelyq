import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARCHITECT_DRIFT_MARKER,
  ARCHITECT_READY_MARKER,
  ARCHITECT_WRITE_ROOT,
  buildSystemPrompt,
} from "../src/prompt.js";

// ---------------------------------------------------------------------------
// Architect Mode. The mode is a prompt addendum plus a
// tool-boundary restriction in session.ts. These lock the prompt half; the
// tool-boundary half is exercised in server.test.ts / a live run.
// ---------------------------------------------------------------------------

test("architect mode off (the default) adds nothing to the prompt", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  assert.doesNotMatch(prompt, /<architect_mode>/);
});

test("architect mode off is byte-identical to omitting the option", () => {
  const a = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  const b = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    architectMode: undefined,
  });
  assert.equal(a, b);
});

test("architect mode on adds the addendum with the interview, the package, the challenge, the report", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react", architectMode: {} });
  assert.match(prompt, /<architect_mode>/);
  assert.match(prompt, /Interview first/);
  assert.match(prompt, /decisions\/NNNN/);
  assert.match(prompt, /Challenge the package before presenting/);
  assert.match(prompt, /report\.html/);
  assert.match(prompt, new RegExp(ARCHITECT_READY_MARKER.replace(/[:]/g, "\\$&")));
  // The base scope/quality/communication discipline is still there and pointed at.
  assert.match(prompt, /Build what was asked, then stop/);
  assert.match(prompt, /Everything in <scope>, <quality>, and <communication> above still applies/);
});

test("architect mode has the Phase 2 resume/drift-review path — read README first, supersede, don't fix", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react", architectMode: {} });
  assert.match(prompt, /is there already a package here\?/i);
  assert.match(prompt, new RegExp(`read \\\`${ARCHITECT_WRITE_ROOT}README\\.md\\\``));
  assert.match(prompt, /you are RESUMING, not starting over/);
  assert.match(prompt, /Compare what was built against .*build-plan\.md/);
  assert.match(prompt, /NEW record[\s\S]*supersedes the old one/);
  assert.match(prompt, /Superseded by NNNN/);
  assert.match(prompt, new RegExp(ARCHITECT_DRIFT_MARKER.replace(/[:]/g, "\\$&")));
  // The overseer still cannot code — corrective work goes to the builder.
  assert.match(prompt, /Drift is reported and re-planned, not fixed by you/);
});

test("architect mode names the write root and the fact that execution is off", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react", architectMode: {} });
  assert.match(prompt, new RegExp(ARCHITECT_WRITE_ROOT.replace("/", "\\/")));
  assert.match(prompt, /run_command.*disabled|disabled.*run_command|execution tools are disabled/);
});

test("architect mode with the report skill resolved weaves its body and resource listing in", () => {
  const prompt = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    architectMode: {
      skill: { body: "THE REPORT SKILL BODY", resources: ["profiles/verdict-scorecard.md"] },
    },
  });
  assert.match(prompt, /<architect_mode_report_skill>/);
  assert.match(prompt, /THE REPORT SKILL BODY/);
  assert.match(prompt, /profiles\/verdict-scorecard\.md/);
  assert.match(prompt, /use_skill\("report-page-design", path\)/);
});

test("architect mode with no report skill still runs — degraded on the report step only", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react", architectMode: {} });
  assert.doesNotMatch(prompt, /<architect_mode_report_skill>/);
  assert.match(prompt, /Render the report/);
});

test("engineer mode and architect mode are separate blocks; only one renders at a time in practice", () => {
  // The server rejects both at once; buildSystemPrompt itself would append both
  // if asked, which is exactly why the server check exists. Assert the blocks
  // are independent so a future refactor can't couple them.
  const eng = buildSystemPrompt({ projectName: "p", template: "vite-react", engineerMode: {} });
  const arch = buildSystemPrompt({ projectName: "p", template: "vite-react", architectMode: {} });
  assert.match(eng, /<engineer_mode>/);
  assert.doesNotMatch(eng, /<architect_mode>/);
  assert.match(arch, /<architect_mode>/);
  assert.doesNotMatch(arch, /<engineer_mode>/);
});
