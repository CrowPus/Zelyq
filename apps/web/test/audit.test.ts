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

test("a Vault action names the secret, and the key that fetched it — never a value", () => {
  assert.equal(auditDetailSummary({ name: "STRIPE_KEY", scope: "team" }), "STRIPE_KEY");
  assert.equal(
    auditDetailSummary({ name: "STRIPE_KEY", key: "zvk_xxxxxxxx", ip: "203.0.113.9" }),
    "STRIPE_KEY · key zvk_xxxxxxxx",
  );
  assert.equal(auditDetailSummary({ names: ["A_KEY", "B_KEY"] }), "A_KEY, B_KEY");
  assert.equal(auditDetailSummary({ created: ["A"], updated: ["B"], skipped: 1 }), "2 secrets");
});

test("an unrecognised shape summarises to nothing rather than raw JSON", () => {
  assert.equal(auditDetailSummary({ somethingElse: 42 }), null);
});
