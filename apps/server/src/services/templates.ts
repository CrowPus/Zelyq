import fs from "node:fs/promises";
import path from "node:path";
import { ZelyqError } from "@zelyq/core";
import type { ScaffoldFile } from "@zelyq/runtime";

export interface TemplateInfo {
  name: string;
  title: string;
  description: string;
  fileCount: number;
  /** One-line stack summary — forwarded to the agent for this project (066). */
  stack?: string;
  /** A skill whose body is force-woven for projects on this stack (066). */
  agentSkill?: string;
  /** A runtime capability this stack cannot run without — see `requiresCapability`. */
  requiresCapability?: string;
  /** Filename of this stack's icon, served from the web app's public assets. */
  icon?: string;
}

/**
 * Templates are plain directories of files — no placeholder syntax beyond the
 * handful of tokens below. Anyone can add one by dropping a folder in
 * `templates/` with a `template.json`, which is the point.
 *
 * `stack` and `agentSkill` are optional and only read by 066's agent plumb —
 * a template without them behaves exactly as before.
 */
export interface TemplateManifest {
  title: string;
  description: string;
  stack?: string;
  agentSkill?: string;
  /**
   * A `RuntimeHealth.capabilities` entry the configured runtime must advertise
   * before this template may be created. A Python stack on a runtime with no
   * Python toolchain scaffolds fine and then fails at the first preview, which
   * is a worse answer than not offering it.
   */
  requiresCapability?: string;
  /**
   * An icon for this stack, as a bare filename served from the web app's
   * public directory — `react-python.png`, not a path or a URL. A template
   * manifest is just a file on disk, so this is validated rather than trusted:
   * anything else is dropped and the card falls back to its initial.
   */
  icon?: string;
}

/** A plain image filename. No directories, no scheme, no traversal. */
const ICON_PATTERN = /^[a-z0-9][a-z0-9-]*\.(?:png|svg|webp)$/;

const TOKEN_PATTERN = /\{\{\s*(projectName|projectSlug|projectId)\s*\}\}/g;

export async function listTemplates(
  templatesDir: string,
  /**
   * What the configured runtime advertises. Omitted, every template is listed —
   * callers that cannot ask the runtime keep the old behaviour.
   */
  capabilities?: string[],
): Promise<TemplateInfo[]> {
  const entries = await fs.readdir(templatesDir, { withFileTypes: true }).catch(() => []);
  const templates: TemplateInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = await readManifest(path.join(templatesDir, entry.name));
    if (!manifest) continue;
    if (
      manifest.requiresCapability &&
      capabilities &&
      !capabilities.includes(manifest.requiresCapability)
    ) {
      continue;
    }
    const files = await collectFiles(path.join(templatesDir, entry.name));
    templates.push({
      name: entry.name,
      title: manifest.title,
      description: manifest.description,
      fileCount: files.length,
      ...(manifest.stack ? { stack: manifest.stack } : {}),
      ...(manifest.agentSkill ? { agentSkill: manifest.agentSkill } : {}),
      ...(manifest.requiresCapability ? { requiresCapability: manifest.requiresCapability } : {}),
      ...(manifest.icon && ICON_PATTERN.test(manifest.icon) ? { icon: manifest.icon } : {}),
    });
  }

  return templates;
}

export async function loadTemplate(
  templatesDir: string,
  name: string,
  variables: { projectName: string; projectSlug: string; projectId: string },
): Promise<ScaffoldFile[]> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw ZelyqError.badRequest(`Invalid template name: ${name}`);
  }

  const root = path.join(templatesDir, name);
  const manifest = await readManifest(root);
  if (!manifest) throw ZelyqError.notFound("Template", name);

  const files = await collectFiles(root);
  const scaffold: ScaffoldFile[] = [];

  for (const relative of files) {
    const absolute = path.join(root, relative);
    const buffer = await fs.readFile(absolute);
    const isText = !buffer.subarray(0, 8000).includes(0);

    scaffold.push({
      // `_gitignore` ships as a normal file so packaging tools do not eat it.
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

async function readManifest(root: string): Promise<TemplateManifest | null> {
  try {
    const raw = await fs.readFile(path.join(root, "template.json"), "utf8");
    return JSON.parse(raw) as TemplateManifest;
  } catch {
    return null;
  }
}

/**
 * The manifest for one template by name, or `null` if it has none. Used by the
 * gateway to tell the agent what stack a project is on (066). Name is validated
 * the same way `loadTemplate` validates it.
 */
export async function templateManifest(
  templatesDir: string,
  name: string,
): Promise<TemplateManifest | null> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return null;
  return readManifest(path.join(templatesDir, name));
}

/**
 * Files that belong to the template's own checkout, not to a new project.
 *
 * `template.json` is the manifest. The rest are build caches that appear
 * whenever someone runs the template's checks locally: a `.tsbuildinfo` records
 * the absolute paths of the machine that produced it, so scaffolding one hands
 * every new project a stale cache pointing at directories it has never had.
 */
function isTemplateArtifact(name: string): boolean {
  return name === "template.json" || name.endsWith(".tsbuildinfo") || name === ".DS_Store";
}

async function collectFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (
        [
          "node_modules",
          ".venv",
          "__pycache__",
          ".pytest_cache",
          ".mypy_cache",
          ".ruff_cache",
          ".zelyq",
          ".runtime-data",
          "dist",
        ].includes(entry.name)
      )
        continue;
      files.push(...(await collectFiles(root, relative)));
    } else if (entry.isFile() && !isTemplateArtifact(entry.name)) {
      files.push(relative);
    }
  }

  return files;
}
