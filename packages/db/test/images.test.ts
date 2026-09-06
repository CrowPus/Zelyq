import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { newId } from "@zelyq/core";
import { createStore, runMigrations } from "../src/index.js";

test("independent connections cannot double-claim a job, worker slot, or active owner", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-image-claims-"));
  const url = `file:${dir}/test.db`;
  await runMigrations(url);
  const a = createStore(url);
  const b = createStore(url);
  try {
    const ids: string[] = [];
    const owners: string[] = [];
    for (let n = 0; n < 3; n++) {
      const ownerId = newId("user");
      owners.push(ownerId);
      await a.users.create({
        id: ownerId,
        name: "Test",
        email: `${n}@example.com`,
        passwordHash: "unused",
      });
      const id = newId("imageGeneration");
      ids.push(id);
      await a.images.create(
        id,
        ownerId,
        { prompt: "Test", size: "1024x1024", quality: "medium", idempotencyKey: randomUUID() },
        "gpt-image-2",
      );
    }
    const lease = new Date(Date.now() + 600000).toISOString();
    const sameJob = await Promise.all([
      a.images.claim(ids[0]!, 0, lease),
      b.images.claim(ids[0]!, 1, lease),
    ]);
    assert.equal(sameJob.filter(Boolean).length, 1);
    const occupied = sameJob.find(Boolean)!.workerSlot!;
    assert.equal(await b.images.claim(ids[1]!, occupied, lease), null);
    assert.ok(await b.images.claim(ids[1]!, 1 - occupied, lease));
    assert.equal(await a.images.claim(ids[2]!, 0, lease), null);
    assert.equal(await a.images.claim(ids[2]!, 1, lease), null);
    await assert.rejects(
      b.images.create(
        newId("imageGeneration"),
        owners[0]!,
        { prompt: "Another", size: "1024x1024", quality: "medium", idempotencyKey: randomUUID() },
        "gpt-image-2",
      ),
    );
    await a.images.finish(ids[0]!, "failed");
    assert.ok(await b.images.claim(ids[2]!, occupied, lease), "finishing releases a worker slot");
  } finally {
    await a.close();
    await b.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
