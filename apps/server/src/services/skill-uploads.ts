import fs from "node:fs/promises";
import path from "node:path";
import { parseSkillFile, ZelyqError } from "@zelyq/core";

const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 50;

export interface UploadedSkillFile {
  /** Relative to the skill's own root — "SKILL.md", "references/detail.md". */
  path: string;
  /** Base64. */
  data: string;
}

export interface SkillUploadResult {
  name: string;
  description: string;
  fileCount: number;
}

/**
 * Where a skill uploaded through Settings actually lands — see `043` in
 * the council notes. Text only, same 2MB-scale ceiling class `037`
 * already uses for a prompt attachment, because that is what a skill is
 * supposed to be: instructions and small reference material, not a
 * general file-storage backdoor wearing a skill's name.
 *
 * The one thing this deliberately does *not* do is take effect live. It
 * writes the files and returns — the agent picks them up as a third
 * `loadSkills` source on its own next boot, the same "boot-time only,
 * never re-scanned while running" rule `037` already holds for a plugin.
 * See `apps/agent/src/skills.ts` for why that stays true even though a
 * skill is text, not code.
 */
export class SkillUploadService {
  constructor(private readonly baseDir: string) {}

  async store(files: UploadedSkillFile[]): Promise<SkillUploadResult> {
    if (files.length === 0) throw ZelyqError.badRequest("No files were uploaded.");
    if (files.length > MAX_FILES) {
      throw ZelyqError.badRequest(`A skill can have at most ${MAX_FILES} files.`);
    }

    const decoded: Array<{ path: string; bytes: Buffer }> = [];
    let totalBytes = 0;

    for (const file of files) {
      const segments = file.path.split("/");
      const safe =
        file.path.length > 0 &&
        !file.path.startsWith("/") &&
        segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
      if (!safe) {
        throw ZelyqError.badRequest(`"${file.path}" is not a valid path within a skill.`);
      }

      let bytes: Buffer;
      try {
        bytes = Buffer.from(file.data, "base64");
      } catch {
        throw ZelyqError.badRequest(`"${file.path}" was not valid base64.`);
      }

      totalBytes += bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw ZelyqError.badRequest(
          `This skill is over the ${MAX_TOTAL_BYTES / 1024 / 1024}MB limit — skills are meant to ` +
            "carry instructions and small reference material, not large files.",
        );
      }

      decoded.push({ path: file.path, bytes });
    }

    const skillFile = decoded.find((file) => file.path === "SKILL.md");
    if (!skillFile) {
      throw ZelyqError.badRequest("The upload needs a SKILL.md file at its own root.");
    }

    const parsed = parseSkillFile(skillFile.bytes.toString("utf8"));
    if (typeof parsed === "string") {
      throw ZelyqError.badRequest(`SKILL.md: ${parsed}`);
    }

    // A second upload of the same name replaces the first cleanly, rather
    // than leaving an orphaned file from a since-removed version behind.
    const dest = path.join(this.baseDir, parsed.name);
    await fs.rm(dest, { recursive: true, force: true });
    for (const file of decoded) {
      const target = path.join(dest, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.bytes);
    }

    return { name: parsed.name, description: parsed.description, fileCount: decoded.length };
  }
}
