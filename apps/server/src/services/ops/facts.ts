import type { Store } from "@zelyq/db";
import { checkBlocks } from "./blocks.js";
import type { OpsMemory } from "./memory.js";

/**
 * What Ops knows from the start: one sheet per environment, app and machine,
 * written by Zelyq from its own records (never by a model, so never wrong
 * about what Zelyq knows). Ops's own notes on a sheet are kept under
 * "Notes" and never overwritten; a new version is kept only when the
 * facts change.
 */

export const FACTS_AUTHOR = "zelyq";
const NOTES = "## Notes";

/** The sheet's text with fresh facts on top and its notes kept below. */
export function withFacts(existing: string | null, facts: string): string {
  if (!existing) return `${facts}\n\n${NOTES}\n\n(none yet)`;
  const at = existing.indexOf(NOTES);
  // A sheet Ops or a person wrote before keeps all of its text, as notes.
  const notes = at >= 0 ? existing.slice(at + NOTES.length).trim() : existing.trim();
  return `${facts}\n\n${NOTES}\n\n${notes || "(none yet)"}`;
}

const yes = (value: boolean) => (value ? "yes" : "no");
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** Writes the team's sheets from Zelyq's records; returns how many changed. */
export async function refreshFacts(
  store: Store,
  memory: OpsMemory,
  teamId: string,
): Promise<number> {
  const environments = await store.deploy.environments.listForTeam(teamId);
  const runners = await store.pipelines.runners.listForTeam(teamId);
  const live = await store.deploy.deployments.live(environments.map((row) => row.id));
  const apps = await store.deploy.apps.listFor(environments.map((row) => row.id));
  const pipelines = await store.pipelines.pipelines.listForTeam(teamId);
  const deploying = pipelines.map((row) => {
    let to: string[] = [];
    try {
      to = checkBlocks(row.source).deploysTo;
    } catch {
      to = [];
    }
    return { name: row.name, source: row.source.toLowerCase(), to };
  });
  const machineOf = (id: string | null) => runners.find((row) => row.id === id) ?? null;

  const sheets: { subject: string; facts: string }[] = [];

  for (const environment of environments) {
    const machine = machineOf(environment.runnerId);
    const here = live.filter((row) => row.environmentId === environment.id);
    const variables = Object.keys(JSON.parse(environment.variables) as Record<string, unknown>);
    const shipping = deploying.filter((row) => row.to.includes(environment.name));
    sheets.push({
      subject: `environment:${environment.name}`,
      facts: [
        `## From Zelyq's records`,
        `- Machine: ${machine ? `${machine.name} (${machine.host})` : "none"}`,
        `- Address: ${environment.address ?? "the machine's own"}${environment.domain ? `; apps at <app>.${environment.domain} or their own domain` : ""}`,
        `- Domain: ${environment.domain ?? "none"} (HTTPS ${environment.https})`,
        `- Protected: ${yes(environment.protected)} · Frozen: ${yes(environment.frozen)} · Ops may: ${environment.opsTrust}`,
        `- A live site (has a domain): ${yes(Boolean(environment.domain))}`,
        `- Variables (names only): ${variables.join(", ") || "none"}`,
        `- Live: ${here.map((row) => `${row.app} #${row.number}${row.url ? ` at ${row.url}` : ""}`).join("; ") || "nothing"}`,
        `- Databases beside apps: ${
          apps
            .filter((row) => row.environmentId === environment.id && row.database)
            .map(
              (row) =>
                `${row.app} (postgres, kept in zelyq-db-${environment.name}-${row.app}-data)`,
            )
            .join("; ") || "none"
        }`,
        `- Pipelines that deploy here: ${shipping.map((row) => row.name).join(", ") || "none"}`,
      ].join("\n"),
    });
  }

  for (const app of [...new Set(live.map((row) => row.app))]) {
    const where = live.filter((row) => row.app === app);
    const subject = slug(app);
    if (!subject) continue;
    sheets.push({
      subject: `app:${subject}`,
      facts: [
        `## From Zelyq's records`,
        ...where.map((row) => {
          const environment = environments.find((env) => env.id === row.environmentId);
          return `- On ${environment?.name ?? "?"}: #${row.number} live since ${row.createdAt.slice(0, 10)}${row.url ? `, at ${row.url}` : ""}`;
        }),
        `- Pipelines that mention it: ${
          deploying
            .filter((row) => row.source.includes(app.toLowerCase()))
            .map((row) => row.name)
            .join(", ") || "none"
        }`,
        `- Roll back: each deploy can be rolled back to the one before (deployment_history, rollback).`,
      ].join("\n"),
    });
  }

  for (const runner of runners) {
    const name = runner.name.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 63);
    if (!name) continue;
    const on = environments.filter((row) => row.runnerId === runner.id).map((row) => row.name);
    sheets.push({
      subject: `machine:${name}`,
      facts: [
        `## From Zelyq's records`,
        `- Host: ${runner.host} (SSH as ${runner.username})`,
        `- Size: ${runner.cpus ?? "?"} processors, ${runner.memoryMb ? `${Math.round(runner.memoryMb / 1024)} GB memory` : "memory unknown"}, ${runner.os ?? "system unknown"}`,
        `- Environments on it: ${on.join(", ") || "none"}`,
        `- Last connection test: ${runner.lastTestOk === null ? "never" : runner.lastTestOk ? "passed" : "failed"}`,
      ].join("\n"),
    });
  }

  let changed = 0;
  for (const sheet of sheets) {
    const existing = await store.ops.sheets.find(teamId, sheet.subject);
    const body = withFacts(existing?.body ?? null, sheet.facts);
    if (existing?.body === body) continue;
    await memory.writeSheet(teamId, sheet.subject, body, FACTS_AUTHOR);
    changed += 1;
  }
  return changed;
}
