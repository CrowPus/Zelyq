import assert from "node:assert/strict";
import { test } from "node:test";
import type { AvailableProviders } from "@zelyq/core";
import { modelPickerState } from "../src/components/ModelPicker.js";

/**
 * The model picker used to hide itself whenever it had no groups to show,
 * which conflated three different situations. `/api/providers` calls the agent
 * with no fallback, so an agent restart made the control silently disappear
 * from the composer — indistinguishable, to someone using the product, from
 * the feature having been deleted.
 */

const provider = (over: Partial<AvailableProviders["providers"][number]> = {}) => ({
  id: "anthropic" as const,
  label: "Claude",
  defaultModel: "claude-opus-5",
  configured: true,
  models: [{ value: "claude-opus-5", label: "Claude Opus 5" }],
  ...over,
});

const data = (providers: AvailableProviders["providers"]): AvailableProviders => ({
  default: "anthropic",
  providers,
});

test("a configured provider with a model catalog is offered", () => {
  const state = modelPickerState({
    data: data([provider()]),
    isError: false,
    isSuccess: true,
  });
  assert.equal(state.kind, "ready");
  assert.equal(state.kind === "ready" && state.groups.length, 1);
});

test("hidden ONLY when the answer actually arrived and there was nothing to offer", () => {
  assert.deepEqual(modelPickerState({ data: data([]), isError: false, isSuccess: true }), {
    kind: "hidden",
  });
  // Configured but no confirmed catalog, and `custom`, are both real "nothing
  // to pick" cases — the original behaviour, unchanged.
  assert.deepEqual(
    modelPickerState({
      data: data([provider({ models: undefined }), provider({ id: "custom", label: "Custom" })]),
      isError: false,
      isSuccess: true,
    }),
    { kind: "hidden" },
  );
  assert.deepEqual(
    modelPickerState({
      data: data([provider({ configured: false })]),
      isError: false,
      isSuccess: true,
    }),
    { kind: "hidden" },
  );
});

test("a failed providers call leaves the control in place instead of deleting it", () => {
  // The regression. Before, this returned nothing to render and the model
  // switch vanished from the composer whenever the agent was restarting.
  assert.deepEqual(modelPickerState({ data: undefined, isError: true, isSuccess: false }), {
    kind: "unavailable",
    reason: "error",
  });
});

test("the first load is a loading state, not an empty one", () => {
  assert.deepEqual(modelPickerState({ data: undefined, isError: false, isSuccess: false }), {
    kind: "unavailable",
    reason: "loading",
  });
});

test("a background refetch that fails keeps offering what already loaded", () => {
  // The models did not stop existing because one poll missed.
  const state = modelPickerState({
    data: data([provider()]),
    isError: true,
    isSuccess: false,
  });
  assert.equal(state.kind, "ready");
});
