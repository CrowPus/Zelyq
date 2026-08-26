import { z } from "zod";
import { files, jsonOutput, readJson, readText } from "./lib/shared.mjs";

async function envNames(context) {
  const entries = await files(context, 12);
  const names = new Set();
  for (const entry of entries
    .filter((e) => e.type !== "directory" && /\.(js|ts|jsx|tsx|py|go|rb)$/.test(e.path))
    .slice(0, 500)) {
    const content = await readText(context, entry.path);
    for (const match of (content ?? "").matchAll(
      /(?:process\.env\.|import\.meta\.env\.|os\.environ\[['"])([A-Z][A-Z0-9_]*)/g,
    ))
      names.add(match[1]);
  }
  return [...names].sort();
}
export default [
  {
    name: "deployment_check",
    description:
      "Assess build scripts, lockfiles, runtime declarations, container configuration, health checks, and environment documentation without deploying.",
    schema: z.object({}),
    async run(context) {
      const entries = await files(context, 10);
      const paths = entries.map((e) => e.path);
      const pkg = await readJson(context, "package.json");
      const checks = {
        hasBuildScript: Boolean(pkg?.scripts?.build),
        hasStartScript: Boolean(pkg?.scripts?.start),
        hasLockfile: paths.some((p) =>
          /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(p),
        ),
        hasNodeEngine: Boolean(pkg?.engines?.node),
        hasDockerfile: paths.includes("Dockerfile"),
        hasEnvExample: paths.some((p) => /\.env\.(example|sample)$/.test(p)),
        hasHealthRouteHint: paths.some((p) => /health/i.test(p)),
        hasCi: paths.some((p) => p.startsWith(".github/workflows/")),
      };
      return jsonOutput({
        checks,
        missing: Object.entries(checks)
          .filter(([, ok]) => !ok)
          .map(([name]) => name),
      });
    },
  },
  {
    name: "deployment_environment_report",
    description:
      "Report referenced environment-variable names and whether example environment files document them. Never returns actual secret values.",
    schema: z.object({}),
    async run(context) {
      const referenced = await envNames(context);
      const example =
        (await readText(context, ".env.example")) ?? (await readText(context, ".env.sample")) ?? "";
      const documented = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
      return jsonOutput({
        referenced,
        documented,
        undocumented: referenced.filter((name) => !documented.includes(name)),
        unusedExamples: documented.filter((name) => !referenced.includes(name)),
      });
    },
  },
  {
    name: "detect_missing_secret_declarations",
    description:
      "Identify secret-like environment variables referenced in source but absent from the example environment file. This reads names only, never values.",
    schema: z.object({}),
    async run(context) {
      const names = await envNames(context);
      const example = (await readText(context, ".env.example")) ?? "";
      const documented = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
      const secretLike = names.filter((name) =>
        /(SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|DATABASE_URL)/.test(name),
      );
      return jsonOutput({
        secretLike,
        missingFromExample: secretLike.filter((name) => !documented.has(name)),
      });
    },
  },
  {
    name: "build_artifact_report",
    description:
      "Inspect common build-output directories and report artifact file counts and sizes without changing them.",
    schema: z.object({
      paths: z.array(z.string()).max(12).default(["dist", "build", ".next", "out"]),
    }),
    async run(context, input) {
      const results = [];
      for (const path of input.paths) {
        try {
          const entries = await context.runtime.listFiles(context.projectId, { path, depth: 16 });
          const regular = entries.filter((e) => e.type !== "directory");
          results.push({
            path,
            files: regular.length,
            bytes: regular.reduce((sum, e) => sum + (e.size ?? 0), 0),
            largest: regular
              .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
              .slice(0, 10)
              .map((e) => ({ path: e.path, bytes: e.size ?? 0 })),
          });
        } catch {
          results.push({ path, missing: true });
        }
      }
      return jsonOutput(results);
    },
  },
];
