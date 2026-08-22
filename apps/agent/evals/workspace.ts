import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { RuntimeDriver, ScaffoldFile } from "@zelyq/runtime";

const exec = promisify(execFile);

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const TEMPLATES_DIR = path.join(REPO_ROOT, "templates");
/** Named `workspace` so the repo's existing gitignore rule already covers it. */
export const EVAL_WORKSPACE = path.join(REPO_ROOT, "apps/agent/evals/workspace");

const TOKEN_PATTERN = /\{\{\s*(projectName|projectSlug|projectId)\s*\}\}/g;

/**
 * Reads a template directory into scaffold files.
 *
 * This deliberately mirrors `loadTemplate` in apps/server rather than importing
 * it: the harness has no business depending on the server, and a fixture loader
 * drifting from the real one is a smaller problem than the two apps being
 * coupled. If a third caller ever appears, promote it to a shared package.
 */
export async function loadTemplateFiles(
  name: string,
  variables: { projectName: string; projectSlug: string; projectId: string },
): Promise<ScaffoldFile[]> {
  const root = path.join(TEMPLATES_DIR, name);
  const files = await collect(root);
  const scaffold: ScaffoldFile[] = [];

  for (const relative of files) {
    const buffer = await fs.readFile(path.join(root, relative));
    const isText = !buffer.subarray(0, 8000).includes(0);
    scaffold.push({
      path: relative === "_gitignore" ? ".gitignore" : relative,
      content: isText
        ? buffer.toString("utf8").replace(TOKEN_PATTERN, (_, key: string) => {
            if (key === "projectName") return variables.projectName;
            if (key === "projectSlug") return variables.projectSlug;
            return variables.projectId;
          })
        : buffer.toString("base64"),
      encoding: isText ? "utf8" : "base64",
    });
  }
  return scaffold;
}

async function collect(root: string, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...(await collect(root, relative)));
    } else if (entry.isFile() && entry.name !== "template.json") {
      files.push(relative);
    }
  }
  return files;
}

/**
 * Installs the template's dependencies once, into a project the cases copy from.
 *
 * Without this every case pays a full `npm install`, which dominates both the
 * wall time and the variance — and variance is the enemy of a measurement.
 */
export async function prepareBaseProject(
  runtime: RuntimeDriver,
  template: string,
  log: (message: string) => void,
): Promise<string> {
  const baseId = `eval-base-${template}`;
  const { root } = await runtime.ensureProject(baseId);
  const installed = await exists(path.join(root, "node_modules"));

  if (!installed) {
    log(`preparing base project (npm install, once) …`);
    await runtime.scaffold(
      baseId,
      await loadTemplateFiles(template, {
        projectName: "Base",
        projectSlug: "base",
        projectId: baseId,
      }),
    );
    const result = await runtime.exec(baseId, {
      command: "npm install --no-audit --no-fund --include=dev",
      timeoutMs: 10 * 60_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `base install failed (exit ${result.exitCode}):\n${result.stderr.slice(-2000)}`,
      );
    }
  }

  return root;
}

/**
 * Gives a case its own `node_modules` as hardlinks to the base install.
 *
 * `cp -al` costs about a second where a real install costs a minute. npm
 * replaces files by unlinking first, so a case that installs a new dependency
 * breaks its own links rather than corrupting the base. Falls back to a real
 * copy where hardlinking is unavailable.
 */
export async function linkModules(baseRoot: string, caseRoot: string): Promise<void> {
  const from = path.join(baseRoot, "node_modules");
  const to = path.join(caseRoot, "node_modules");
  if (await exists(to)) return;
  try {
    await exec("cp", ["-al", from, to]);
  } catch {
    await fs.cp(from, to, { recursive: true });
  }
}

export interface ProjectFingerprint {
  /** Relative path → sha256 of contents. Excludes node_modules and build output. */
  files: Map<string, string>;
}

/**
 * Content hashes for every source file, taken through the runtime rather than
 * `fs` so the harness measures what the agent actually sees.
 */
export async function fingerprint(
  runtime: RuntimeDriver,
  projectId: string,
): Promise<ProjectFingerprint> {
  const entries = await runtime.listFiles(projectId, { depth: 12 });
  const files = new Map<string, string>();

  for (const entry of entries) {
    if (entry.type !== "file") continue;
    if (entry.path.startsWith("dist/")) continue;
    try {
      const file = await runtime.readFile(projectId, entry.path);
      files.set(entry.path, createHash("sha256").update(file.content).digest("hex"));
    } catch {
      // A file that vanished mid-run is a change, and `diff` will report it.
    }
  }

  return { files };
}

export function diff(before: ProjectFingerprint, after: ProjectFingerprint): string[] {
  const changed = new Set<string>();
  for (const [file, hash] of after.files) {
    if (before.files.get(file) !== hash) changed.add(file);
  }
  for (const file of before.files.keys()) {
    if (!after.files.has(file)) changed.add(file);
  }
  return [...changed].sort();
}

export async function exists(target: string): Promise<boolean> {
  return await fs
    .access(target)
    .then(() => true)
    .catch(() => false);
}
