import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../src/lib/api.js";
import { vaultErrorMessage } from "../src/lib/vault.js";

test("a refused name shows the reason, not the generic validation envelope", () => {
  const error = new ApiError("bad_request", "Request validation failed", 400, {
    issues: [{ path: "name", message: "That name is reserved." }],
  });
  assert.equal(vaultErrorMessage(error), "That name is reserved.");
});

test("any other API error shows its own message", () => {
  assert.equal(
    vaultErrorMessage(new ApiError("conflict", "STRIPE_KEY already exists in development.", 409)),
    "STRIPE_KEY already exists in development.",
  );
});
