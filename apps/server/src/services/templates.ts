import fs from "node:fs/promises";
import path from "node:path";
import { ZelyqError } from "@zelyq/core";
import type { ScaffoldFile } from "@zelyq/runtime";

export interface TemplateInfo {
  name: string;
  title: string;
  description: string;
  fileCount: number;
}

/**
 * Templates are plain directories of files — no placeholder syntax beyond the
 * handful of tokens below. Anyone can add one by dropping a folder in
 * `templates/` with a `template.json`, which is the point.
 */
export interface TemplateManifest {
  title: string;
  description: string;
}

const TOKEN_PATTERN = /\{\{\s*(projectName|projectSlug|projectId)\s*\}\}/g;

export async function listTemplates(templatesDir: string): Promise<TemplateInfo[]> {
  const entries = await fs.readdir(templatesDir, { withFileTypes: true }).catch(() => []);
  const templates: TemplateInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = await readManifest(path.join(templatesDir, entry.name));
    if (!manifest) continue;
    const files = await collectFiles(path.join(templatesDir, entry.name));
    templates.push({
      name: entry.name,
      title: manifest.title,
      description: manifest.description,
      fileCount: files.length,
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

async function collectFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...(await collectFiles(root, relative)));
    } else if (entry.isFile() && entry.name !== "template.json") {
      files.push(relative);
    }
  }

  return files;
}
