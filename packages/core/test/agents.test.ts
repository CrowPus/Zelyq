import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_PERMISSIONS, agentPermissionNames, DEVOPS_AGENT_PRESET } from "../src/agents.js";

test("the DevOps engineer preset names every permission, each at a level it allows", () => {
  assert.deepEqual(
    Object.keys(DEVOPS_AGENT_PRESET.permissions).sort(),
    [...agentPermissionNames].sort(),
  );
  for (const [name, level] of Object.entries(DEVOPS_AGENT_PRESET.permissions)) {
    assert.ok(
      (
        AGENT_PERMISSIONS[name as keyof typeof AGENT_PERMISSIONS].levels as readonly string[]
      ).includes(level),
      `${name}: ${level}`,
    );
  }
  // It changes nothing on its own and never writes app code.
  assert.equal(DEVOPS_AGENT_PRESET.permissions["code.write"], "off");
  assert.equal(DEVOPS_AGENT_PRESET.permissions.ops, "approve");
  const allowed = Object.entries(DEVOPS_AGENT_PRESET.permissions)
    .filter(([, level]) => level === "allow")
    .map(([name]) => name);
  assert.deepEqual(allowed.sort(), ["code.read", "vault.names"]);
});
