import assert from "node:assert/strict";
import { test } from "node:test";
import type { Store } from "@zelyq/db";
import { RunLog } from "../src/services/pipelines/engine.js";

/**
 * A run's log outlives a shutdown when the run is left waiting for a person.
 * Neither a failed write nor its timer may then hang the process.
 */

test("one failed write does not fail every write after it", async () => {
  const written: string[] = [];
  let fail = true;
  const store = {
    pipelines: {
      logs: {
        append: async (_runId: string, lines: { text: string }[]) => {
          if (fail) {
            fail = false;
            throw new Error("database is closed");
          }
          written.push(...lines.map((line) => line.text));
        },
      },
    },
  } as unknown as Store;
  const log = new RunLog(store, "run_1", 0);
  log.add(null, "out", "lost");
  await assert.rejects(log.flush(), /database is closed/);
  log.add(null, "out", "kept");
  await log.flush();
  assert.deepEqual(written, ["kept"]);
  await log.close();
});

test("an open log never keeps the process alive by itself", async () => {
  const store = { pipelines: { logs: { append: async () => {} } } } as unknown as Store;
  const log = new RunLog(store, "run_1", 0);
  assert.equal((log as unknown as { timer: NodeJS.Timeout }).timer.hasRef(), false);
  await log.close();
});
