import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  newId,
  type PipelinePluginSummary,
  type PluginManifest,
  parsePipelineFile,
  parsePluginManifest,
  parsePluginRef,
  pluginManifestSchema,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { PipelinePluginRow, Store } from "@zelyq/db";
import type { AccessControl } from "../access.js";

/** A package as uploaded: at most this, packed. */
export const MAX_PLUGIN_PACKAGE_BYTES = 10 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 500;
const MANIFEST = "zelyq-plugin.yml";

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

/**
 * Reads and checks a plugin package: a gzipped tar of plain files and
 * folders, with relative paths only (no links, nothing outside the package),
 * within size, and a valid `zelyq-plugin.yml` at its top.
 */
export function readPluginPackage(body: Buffer): { manifest: PluginManifest; sha256: string } {
  const refuse = (message: string): never => {
    throw ZelyqError.badRequest(`This is not a plugin package Zelyq accepts: ${message}`);
  };
  if (body.length === 0) refuse("the file is empty.");
  if (body.length > MAX_PLUGIN_PACKAGE_BYTES) refuse("it is larger than 10 MB.");
  let tar: Buffer;
  try {
    tar = gunzipSync(body, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch {
    return refuse("it is not a .tar.gz, or unpacks to more than 50 MB.");
  }
  const files = new Map<string, Buffer>();
  let offset = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  let count = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) refuse("a file's size is not readable.");
    const type = String.fromCharCode(header[156] ?? 0);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") {
      longName = data.toString("utf8").replace(/\0.*$/s, "");
      continue;
    }
    if (type === "x") {
      const match = /\d+ path=([^\n]*)\n/.exec(data.toString("utf8"));
      paxPath = match?.[1] ?? null;
      continue;
    }
    if (type === "g") continue;
    const prefix = field(345, 155);
    const raw = paxPath ?? longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    paxPath = null;
    const name = raw.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
    if (type !== "0" && type !== "\0" && type !== "5") {
      refuse(`${raw} is a link or a special file; a plugin holds only files and folders.`);
    }
    if (name === "" || name === ".") continue;
    if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split(/[\\/]/).includes("..")) {
      refuse(`${raw} points outside the package.`);
    }
    if (type === "5") continue;
    count += 1;
    if (count > MAX_FILES) refuse(`it holds more than ${MAX_FILES} files.`);
    files.set(name, Buffer.from(data));
  }
  const manifestFile = files.get(MANIFEST);
  if (!manifestFile) {
    const nested = [...files.keys()].find((name) => name.endsWith(`/${MANIFEST}`));
    return refuse(
      nested
        ? `${MANIFEST} must be at the top of the package, not in ${path.posix.dirname(nested)}/. Pack it from inside the plugin's folder: tar -czf plugin.tar.gz -C my-plugin .`
        : `there is no ${MANIFEST} in it.`,
    );
  }
  const parsed = parsePluginManifest(manifestFile.toString("utf8"));
  if (!parsed.ok) return refuse(`${MANIFEST}: ${parsed.message}`);
  return {
    manifest: parsed.manifest,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}
