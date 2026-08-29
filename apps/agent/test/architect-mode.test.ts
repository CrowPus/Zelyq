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
  assert.match(prompt, /## 1\. Interview —/);
  assert.match(prompt, /No script, no fixed checklist/);
  assert.match(prompt, /at least \*\*five substantial questions\*\*/);
  assert.match(prompt, /Never decide a load-bearing question for the user/);
  assert.match(prompt, /decisions\/NNNN/);
  assert.match(prompt, /Challenge the package before presenting/);
  assert.match(prompt, /report\.html/);
  assert.match(prompt, new RegExp(ARCHITECT_READY_MARKER.replace(/[:]/g, "\\$&")));
  // The base scope/quality/communication discipline is still there and pointed at.
  assert.match(prompt, /Build what was asked, then stop/);
  assert.match(prompt, /Everything in <scope>, <quality>, and <communication> above still applies/);
});

test("architect mode teaches the Supabase backend path — interview topic, backend.md, backend DoD (058 Phase B)", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react", architectMode: {} });
  // The interview asks whether a backend is needed, and names Supabase as the only one.
  assert.match(prompt, /saved data, user accounts, or any backend/i);
  assert.match(prompt, /Supabase.*Postgres.*Row-Level-Security/s);
  // backend.md is a conditional package artifact with grants + per-operation RLS.
  assert.match(prompt, /backend\.md/);
  assert.match(prompt, /policy per operation/i);
  assert.match(prompt, /publishable\*{0,2}\s+key\s+only/i);
  assert.match(prompt, /sb_secret_\*|service_role/);
  // Two end states, neither of which blocks design on a credential.
  assert.match(prompt, /designed, not wired/);
  assert.match(prompt, /designed and buildable/);
  // The build plan gets backend tasks and the DoD gets the three-identity RLS line.
  assert.match(prompt, /migration task/);
  assert.match(prompt, /client-wiring\s+task/);
  assert.match(prompt, /SECOND non-owning user/);
});

test("architect + engineer prompts carry the AI-provider integration path when the catalog is supplied (060)", () => {
  const opts = {
    projectName: "p",
    template: "vite-react",
    aiProviderCatalogText: "- openai: OpenAI GPT family\n- anthropic: Claude",
    aiProvidersAgentMd: "## MUST\n- key lives in Supabase, never the browser",
  };
  const arch = buildSystemPrompt({ ...opts, architectMode: {} });
  assert.match(arch, /<ai_providers>/);
  assert.match(arch, /use_ai_provider\("<slug>"\)/);
  assert.match(arch, /ai_credentials/);
  assert.match(arch, /- openai: OpenAI GPT family/);
  assert.match(arch, /key lives in Supabase/);
  // ai.md is a package file and appears in the required list + DoD.
  assert.match(arch, /- `ai\.md`/);
  assert.match(arch, /and `ai\.md` whenever it uses a language model/);
  assert.match(arch, /If `ai\.md` exists:/);

  const eng = buildSystemPrompt({ ...opts, engineerMode: {} });
  assert.match(eng, /<ai_providers>/);
  assert.match(eng, /supabase_deploy_function/);
  assert.match(eng, /Settings page/);
  assert.match(eng, /NOT in the sidebar/);

  // The populated section is absent when no catalog is supplied (the prompt
  // prose still mentions the `<ai_providers>` tag by name — match the rendered
  // block, not the bare string).
  const bare = buildSystemPrompt({ projectName: "p", template: "vite-react", architectMode: {} });
  assert.doesNotMatch(bare, /\n<ai_providers>\nWhen the project calls a language model/);
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
