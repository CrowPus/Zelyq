import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDIT_ACTION_LABELS, auditDetailSummary } from "../src/lib/audit.js";

test("every audit action has a human label", () => {
  for (const label of Object.values(AUDIT_ACTION_LABELS)) {
    assert.ok(label.length > 0);
  }
});

test("a file action summarises to its path", () => {
  assert.equal(auditDetailSummary({ path: "src/App.tsx" }), "src/App.tsx");
});

test("a member action summarises to email and role", () => {
  assert.equal(
    auditDetailSummary({ email: "dev@example.com", role: "editor" }),
    "dev@example.com · editor",
  );
});

test("a project-updated action summarises to which fields changed", () => {
  assert.equal(auditDetailSummary({ fields: ["name", "description"] }), "name, description");
});

test("an unrecognised shape summarises to nothing rather than raw JSON", () => {
  assert.equal(auditDetailSummary({ somethingElse: 42 }), null);
});
