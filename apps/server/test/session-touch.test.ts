import assert from "node:assert/strict";
import { test } from "node:test";
import type { Store } from "@zelyq/db";
import { AuthService, hashToken } from "../src/services/auth.js";

/**
 * Found live: marking a session "last seen" ran on every signed-in request,
 * scripts and stylesheets included, and a failure failed the request. When
 * the database was briefly locked every request came back 500 and the editor
 * went black.
 */

const user = { id: "u1", email: "a@example.com", name: "A" };

function stubStore(touch: () => Promise<void>): { store: Store; touches: () => number } {
  let count = 0;
  const store = {
    authSessions: {
      async findByTokenHash(hash: string) {
        return hash === hashToken("good-token")
          ? { id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }
          : null;
      },
      async touch() {
        count += 1;
        await touch();
      },
      async remove() {},
    },
    users: {
      async findById(id: string) {
        return id === "u1" ? user : null;
      },
    },
  } as unknown as Store;
  return { store, touches: () => count };
}

function service(store: Store): AuthService {
  return new AuthService(store, {
    allowRegistration: async () => true,
    sessionTtlDays: async () => 30,
  });
}

test("a locked database does not sign anybody out", async () => {
  const { store } = stubStore(async () => {
    throw new Error("SQLITE_BUSY: database is locked");
  });
  const resolved = await service(store).resolve("good-token");
  assert.deepEqual(resolved, user, "the request still knows who you are");
});

test("a locked database does not hold a request up", async () => {
  // A write stuck behind the lock waits out the busy timeout; the request
  // must not wait with it.
  const { store } = stubStore(() => new Promise<void>(() => {}));
  const resolved = await service(store).resolve("good-token");
  assert.deepEqual(resolved, user);
});

test("a burst of requests writes last-seen once, not once per request", async () => {
  const { store, touches } = stubStore(async () => {});
  const auth = service(store);
  // One page load: the document, its scripts, its stylesheets, a few API calls.
  await Promise.all(Array.from({ length: 25 }, () => auth.resolve("good-token")));
  assert.equal(touches(), 1);
});

test("a failed write is retried on the next request, not a minute later", async () => {
  let fail = true;
  const { store, touches } = stubStore(async () => {
    if (fail) throw new Error("SQLITE_BUSY");
  });
  const auth = service(store);
  await auth.resolve("good-token");
  // The write runs in the background; let its failure land.
  await new Promise((resolve) => setImmediate(resolve));
  fail = false;
  await auth.resolve("good-token");
  assert.equal(touches(), 2);
});

test("an unknown token still resolves to nobody", async () => {
  const { store } = stubStore(async () => {});
  assert.equal(await service(store).resolve("bad-token"), null);
});
