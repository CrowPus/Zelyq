import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { clearSessionCache } from "../src/hooks/useSession";

/**
 * Signing out has to reach the screen, not only the server. These assertions
 * describe the cache state the interface reads to decide between the app and
 * the sign-in page.
 */
function seeded(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(["session"], { user: { id: "usr_1", email: "a@b.c" }, teams: [] });
  client.setQueryData(["projects"], { projects: [{ id: "prj_1", name: "Secret project" }] });
  client.setQueryData(["files", "prj_1"], { entries: [{ path: "src/App.tsx" }] });
  client.setQueryData(["settings"], { groups: [] });
  return client;
}

test("the session becomes null, which is what sends the user to sign-in", () => {
  const client = seeded();
  clearSessionCache(client);
  assert.equal(client.getQueryData(["session"]), null);
});

test("the session entry still exists, so mounted observers are notified", () => {
  // queryClient.clear() removes the query the components are subscribed to, so
  // nothing re-renders and the app keeps showing the signed-out user.
  const client = seeded();
  clearSessionCache(client);

  const entry = client.getQueryCache().find({ queryKey: ["session"] });
  assert.ok(entry, "the session query must survive so subscribers get the update");
  assert.equal(entry.state.data, null);
});

test("everything belonging to the previous user is dropped", () => {
  const client = seeded();
  clearSessionCache(client);

  assert.equal(client.getQueryData(["projects"]), undefined);
  assert.equal(client.getQueryData(["files", "prj_1"]), undefined);
  assert.equal(client.getQueryData(["settings"]), undefined);
});

test("no trace of the previous user's data remains in the cache", () => {
  const client = seeded();
  clearSessionCache(client);

  const remaining = JSON.stringify(
    client
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data),
  );
  assert.ok(!remaining.includes("Secret project"), "another user must not see cached data");
  assert.ok(!remaining.includes("a@b.c"));
});
