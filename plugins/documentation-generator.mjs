import { z } from "zod";
import { files, jsonOutput, readJson, readText, writeText } from "./lib/shared.mjs";

async function facts(context) {
  const entries = await files(context, 8);
  const paths = entries.filter((e) => e.type !== "directory").map((e) => e.path);
  const pkg = await readJson(context, "package.json");
  return {
    name: pkg?.name ?? "Project",
    description: pkg?.description ?? "",
    scripts: pkg?.scripts ?? {},
    dependencies: pkg?.dependencies ?? {},
    devDependencies: pkg?.devDependencies ?? {},
    paths,
    packageManager: pkg?.packageManager,
  };
}
export default [
  {
    name: "generate_project_readme",
    description:
      "Generate a factual README draft from project manifests and layout, then write it to the requested project path.",
    schema: z.object({
      output_path: z.string().default("README.generated.md"),
      overwrite: z.boolean().default(false),
    }),
    async run(context, input) {
      if (!input.overwrite && (await readText(context, input.output_path)) !== null)
        return {
          output: `${input.output_path} already exists; set overwrite=true to replace it.`,
          isError: true,
        };
      const f = await facts(context);
      const commands =
        Object.entries(f.scripts)
          .map(([name, command]) => `- \`${name}\`: \`${command}\``)
          .join("\n") || "No package scripts declared.";
      const top = [...new Set(f.paths.map((p) => p.split("/")[0]))]
        .slice(0, 40)
        .map((p) => `- \`${p}\``)
        .join("\n");
      return writeText(
        context,
        input.output_path,
        `# ${f.name}\n\n${f.description || "Project documentation generated from the repository manifest."}\n\n## Setup\n\nUse ${f.packageManager ? `\`${f.packageManager}\`` : "the package manager declared by your environment"} to install dependencies.\n\n## Scripts\n\n${commands}\n\n## Project structure\n\n${top}\n`,
      );
    },
  },
  {
    name: "generate_api_documentation",
    description:
      "Generate Markdown endpoint documentation from a project-local JSON OpenAPI document.",
    schema: z.object({
      openapi_path: z.string().default("openapi.json"),
      output_path: z.string().default("docs/API.generated.md"),
      overwrite: z.boolean().default(false),
    }),
    async run(context, input) {
      const doc = await readJson(context, input.openapi_path);
      if (!doc)
        return { output: `Could not read JSON OpenAPI at ${input.openapi_path}.`, isError: true };
      if (!input.overwrite && (await readText(context, input.output_path)) !== null)
        return { output: `${input.output_path} already exists.`, isError: true };
      const sections = [];
      for (const [path, item] of Object.entries(doc.paths ?? {}))
        for (const [method, op] of Object.entries(item ?? {}))
          if (/^(get|post|put|patch|delete|head|options)$/.test(method))
            sections.push(
              `## ${method.toUpperCase()} ${path}\n\n${op.summary ?? op.description ?? "No description."}\n\nOperation ID: \`${op.operationId ?? "not specified"}\`\n`,
            );
      return writeText(
        context,
        input.output_path,
        `# ${doc.info?.title ?? "API"}\n\nVersion: ${doc.info?.version ?? "unspecified"}\n\n${sections.join("\n")}`,
      );
    },
  },
  {
    name: "generate_changelog_draft",
    description: "Generate a changelog draft from recent Git commits without altering Git history.",
    schema: z.object({
      output_path: z.string().default("CHANGELOG.generated.md"),
      limit: z.number().int().min(1).max(200).default(50),
      overwrite: z.boolean().default(false),
    }),
    async run(context, input) {
      if (!input.overwrite && (await readText(context, input.output_path)) !== null)
        return { output: `${input.output_path} already exists.`, isError: true };
      const result = await context.runtime.exec(context.projectId, {
        command: `git log -n ${input.limit} --date=short --pretty=format:'%ad%x09%s'`,
        timeoutMs: 30000,
        maxOutputBytes: 30000,
      });
      if (result.exitCode !== 0)
        return { output: result.stderr || "Git history unavailable.", isError: true };
      const lines = result.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [date, ...subject] = line.split("\t");
          return `- ${date}: ${subject.join(" ")}`;
        });
      return writeText(context, input.output_path, `# Changelog draft\n\n${lines.join("\n")}\n`);
    },
  },
  {
    name: "document_environment",
    description:
      "Report environment-variable names referenced by project source and example env files, never their secret values.",
    schema: z.object({}),
    async run(context) {
      const entries = await files(context, 12);
      const names = new Set();
      const sources = [];
      for (const entry of entries
        .filter(
          (e) =>
            e.type !== "directory" &&
            (/\.env\.example$|\.env\.sample$/.test(e.path) ||
              /\.(js|ts|jsx|tsx|py|rb|go)$/.test(e.path)),
        )
        .slice(0, 500)) {
        const content = await readText(context, entry.path);
        if (!content) continue;
        sources.push(entry.path);
        for (const match of content.matchAll(
          /(?:process\.env\.|import\.meta\.env\.|os\.environ\[['"]|ENV\[['"])([A-Z][A-Z0-9_]*)|^([A-Z][A-Z0-9_]*)=/gm,
        ))
          names.add(match[1] ?? match[2]);
      }
      return jsonOutput({ variables: [...names].sort(), scannedFiles: sources.length });
    },
  },
];
