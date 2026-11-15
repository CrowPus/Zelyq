import type { Store } from "@zelyq/db";

/**
 * Gives Ops everything the team has, as a team admin would on Ops → Access.
 * For tests about how Ops works once it has been given what it needs; what
 * it may reach is tested on its own in ops-access.test.ts.
 */
export async function giveOpsEverything(store: Store, teamId: string): Promise<void> {
  const now = new Date().toISOString();
  const give = (kind: string, resourceId: string, level: "see" | "manage") =>
    store.ops.access.put({
      id: `opx_${kind}_${resourceId}`.slice(0, 60),
      teamId,
      kind,
      resourceId,
      level,
      grantedBy: null,
      createdAt: now,
      updatedAt: now,
    });
  for (const row of await store.deploy.environments.listForTeam(teamId)) {
    await give("environment", row.id, "manage");
  }
  for (const row of await store.pipelines.runners.listForTeam(teamId)) {
    await give("machine", row.id, "manage");
  }
  for (const row of await store.pipelines.pipelines.listForTeam(teamId)) {
    await give("pipeline", row.id, "manage");
  }
  for (const row of await store.projects.listForTeams([teamId], 500)) {
    await give("project", row.id, "see");
  }
  await give("vault", "team", "see");
}
