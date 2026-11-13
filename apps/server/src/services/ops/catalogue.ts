import type { OpsAction } from "./actions.js";
import { CHECK_ACTIONS } from "./catalogue/checks.js";
import { ENVIRONMENT_ACTIONS } from "./catalogue/environments.js";
import { MEMORY_ACTIONS } from "./catalogue/memory.js";
import { OPERATION_ACTIONS } from "./catalogue/operations.js";
import { PIPELINE_ACTIONS } from "./catalogue/pipelines.js";
import { UNDERSTANDING_ACTIONS } from "./catalogue/understanding.js";

/**
 * Everything Ops can do: understand, set up environments, write and run
 * pipelines, operate live apps, check. Each goes through the gate.
 */
export const OPS_ACTIONS: OpsAction[] = [
  ...UNDERSTANDING_ACTIONS,
  ...ENVIRONMENT_ACTIONS,
  ...PIPELINE_ACTIONS,
  ...OPERATION_ACTIONS,
  ...CHECK_ACTIONS,
  ...MEMORY_ACTIONS,
];
