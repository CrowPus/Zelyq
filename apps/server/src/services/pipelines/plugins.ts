import fs from "node:fs/promises";
import path from "node:path";
import {
  newId,
  type PipelinePluginSummary,
  type PluginManifest,
  parsePipelineFile,
  parsePluginRef,
  pluginManifestSchema,
  type User,
  ZelyqError,
} from "@zelyq/core";
// The package check is shared with the plugin registry (apps/registry).
import { MAX_PLUGIN_PACKAGE_BYTES, readPluginPackage } from "@zelyq/core/node";
import type { PipelinePluginRow, Store } from "@zelyq/db";
import type { AccessControl } from "../access.js";

export { MAX_PLUGIN_PACKAGE_BYTES, readPluginPackage };

/**
 * Pipeline plugins a team installed. A plugin is a `.tar.gz` with a
 * `zelyq-plugin.yml` at its top: the steps it runs and the inputs it takes.
 * It is checked once, here, and kept on this server under its SHA-256, so a
 * run never downloads anything and a version never changes once installed.
 * Its steps run on the runner, like any step — never in this process.
 */
export class PipelinePluginService {
  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
    private readonly dir: string,
  ) {}

  async list(user: User, teamId: string): Promise<PipelinePluginSummary[]> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const rows = await this.store.pipelines.plugins.list(teamId);
    const usage = await this.usage(teamId);
    const people = new Map<string, { id: string; name: string }>();
    for (const id of new Set(rows.map((row) => row.installedBy).filter(Boolean) as string[])) {
      const person = await this.store.users.findById(id);
      if (person) people.set(id, { id: person.id, name: person.name });
    }
    return rows.map((row) => present(row, people, usage));
  }

  /** Installs a package for a team (admins). The same version twice must be the same file. */
  async install(user: User, teamId: string, body: Buffer): Promise<PipelinePluginSummary> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const { manifest, sha256 } = readPluginPackage(body);
    const existing = await this.store.pipelines.plugins.find(teamId, manifest.id, manifest.version);
    if (existing) {
      if (existing.sha256 !== sha256) {
        throw new ZelyqError(
          "conflict",
          `${manifest.id}@${manifest.version} is already installed with other content. A version never changes: give the new package a higher version.`,
        );
      }
      return (await this.list(user, teamId)).find(
        (plugin) => plugin.id === existing.id,
      ) as PipelinePluginSummary;
    }
    await fs.mkdir(this.dir, { recursive: true });
    const file = this.fileOf(sha256);
    await fs.writeFile(file, body, { flag: "w" });
    const row: PipelinePluginRow = {
      id: newId("pipelinePlugin"),
      teamId,
      pluginId: manifest.id,
      version: manifest.version,
      manifest: JSON.stringify(manifest),
      sha256,
      sizeBytes: body.length,
      installedBy: user.id,
      installedAt: new Date().toISOString(),
    };
    await this.store.pipelines.plugins.create(row);
    await this.access.recordChange(user, {
      teamId,
      action: "pipeline.plugin_installed",
      detail: { label: `${manifest.id}@${manifest.version}` },
    });
    return present(
      row,
      new Map([[user.id, { id: user.id, name: user.name }]]),
      await this.usage(teamId),
    );
  }

  /** Removes an installed version, unless a pipeline still uses it. */
  async remove(user: User, teamId: string, id: string): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const row = await this.store.pipelines.plugins.findById(id);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Plugin");
    const users = (await this.usage(teamId)).get(`${row.pluginId}@${row.version}`) ?? [];
    if (users.length > 0) {
      throw new ZelyqError(
        "conflict",
        `${row.pluginId}@${row.version} is used by ${users.map((pipeline) => pipeline.name).join(", ")}. Change those pipelines first.`,
      );
    }
    await this.store.pipelines.plugins.remove(row.id);
    if ((await this.store.pipelines.plugins.countBySha(row.sha256)) === 0) {
      await fs.rm(this.fileOf(row.sha256), { force: true });
    }
    await this.access.recordChange(user, {
      teamId,
      action: "pipeline.plugin_removed",
      detail: { label: `${row.pluginId}@${row.version}` },
    });
  }

  /** A plugin version's checked file and steps, for a team's run or its file check. */
  async find(
    teamId: string,
    pluginId: string,
    version: string,
  ): Promise<{ manifest: PluginManifest; path: string } | null> {
    const row = await this.store.pipelines.plugins.find(teamId, pluginId, version);
    if (!row) return null;
    return {
      manifest: pluginManifestSchema.parse(JSON.parse(row.manifest)),
      path: this.fileOf(row.sha256),
    };
  }

  private fileOf(sha256: string): string {
    return path.join(this.dir, `${sha256}.tar.gz`);
  }

  /** Which pipelines of the team name each plugin version in their file. */
  private async usage(teamId: string): Promise<Map<string, { id: string; name: string }[]>> {
    const used = new Map<string, { id: string; name: string }[]>();
    for (const pipeline of await this.store.pipelines.pipelines.listForTeam(teamId)) {
      for (const ref of pluginRefsIn(pipeline.source)) {
        const list = used.get(ref) ?? [];
        if (!list.some((item) => item.id === pipeline.id)) {
          list.push({ id: pipeline.id, name: pipeline.name });
        }
        used.set(ref, list);
      }
    }
    return used;
  }
}

/** Every `plugin: publisher/name@version` a pipeline file names. */
export function pluginRefsIn(source: string): string[] {
  const parsed = parsePipelineFile(source);
  if (parsed.ok) {
    return parsed.file.stages.flatMap((stage) =>
      stage.steps.flatMap((step) => {
        const ref = step.plugin ? parsePluginRef(step.plugin) : null;
        return ref ? [`${ref.pluginId}@${ref.version}`] : [];
      }),
    );
  }
  // A file that does not parse any more still counts, by its text.
  return [
    ...source.matchAll(/plugin:\s*["']?([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*@[0-9A-Za-z.+-]+)/g),
  ].map((match) => match[1] ?? "");
}

function present(
  row: PipelinePluginRow,
  people: Map<string, { id: string; name: string }>,
  usage: Map<string, { id: string; name: string }[]>,
): PipelinePluginSummary {
  const manifest = pluginManifestSchema.parse(JSON.parse(row.manifest));
  return {
    id: row.id,
    pluginId: row.pluginId,
    version: row.version,
    name: manifest.name,
    description: manifest.description,
    category: manifest.category,
    os: manifest["runs-on"]?.os ?? null,
    needs: manifest["runs-on"]?.needs ?? [],
    inputs: Object.entries(manifest.inputs).map(([name, input]) => ({
      name,
      description: input.description ?? null,
      required: input.required && input.default === undefined,
      default: input.default ?? null,
      secret: input.secret,
    })),
    outputs: Object.entries(manifest.outputs).map(([name, description]) => ({ name, description })),
    steps: manifest.steps.map(
      (step, index) =>
        step.name ?? (step.run ? (step.run.trim().split("\n")[0] ?? "") : `Step ${index + 1}`),
    ),
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    installedBy: row.installedBy ? (people.get(row.installedBy) ?? null) : null,
    installedAt: row.installedAt,
    usedBy: usage.get(`${row.pluginId}@${row.version}`) ?? [],
  };
}
