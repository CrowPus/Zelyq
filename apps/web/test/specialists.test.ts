import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SPECIALISTS } from "../src/lib/specialists.js";

// ---------------------------------------------------------------------------
// 062 — the composer's `/agent` list must not drift from the agent's own
// set of specialists. The agent is the source of truth (`SPECIALIST_KINDS`
// in `apps/agent/src/session.ts`); this list only needs a label and a
// blurb for the menu. Read the agent source directly rather than importing
// it — `session.ts` pulls in the whole runtime, and all this needs is the
// names.
// ---------------------------------------------------------------------------

function agentSpecialistKinds(): string[] {
  const sessionPath = fileURLToPath(new URL("../../agent/src/session.ts", import.meta.url));
  const src = readFileSync(sessionPath, "utf8");
  const match = src.match(/SPECIALIST_KINDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(match, "could not find SPECIALIST_KINDS in the agent's session.ts");
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

test("062: the `/agent` list names exactly the agent's specialist kinds, in order", () => {
  assert.deepEqual(
    SPECIALISTS.map((s) => s.name),
    agentSpecialistKinds(),
  );
});

test("062: every specialist has a label and a blurb for the menu", () => {
  for (const specialist of SPECIALISTS) {
    assert.ok(specialist.label.trim().length > 0, `${specialist.name} needs a label`);
    assert.ok(specialist.blurb.trim().length > 0, `${specialist.name} needs a blurb`);
  }
});
