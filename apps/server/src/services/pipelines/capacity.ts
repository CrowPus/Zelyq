import os from "node:os";
import { automaticConcurrency } from "@zelyq/core";

/**
 * How many runs the local runner takes at once when its setting is 0
 * (automatic): from the processors this process may use and the server's
 * memory, and never fewer than the 2 it always took.
 */
export function automaticLocalConcurrency(): number {
  return Math.max(
    2,
    automaticConcurrency(os.availableParallelism(), Math.floor(os.totalmem() / 1024 / 1024)),
  );
}
