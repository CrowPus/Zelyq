import { z } from "zod";
import { chooseScript, exec, jsonOutput, readJson } from "./lib/shared.mjs";

async function scripted(context, names, timeoutMs) {
  const pkg = await readJson(context, "package.json");
  const script = chooseScript(pkg, names);
  if (!script)
    return { output: `No ${names.join(" or ")} script exists in package.json.`, isError: true };
  const manager = pkg.packageManager?.startsWith("pnpm") ? "pnpm" : "npm";
  return exec(context, `${manager} run ${script}`, { timeoutMs });
}

export default [
  {
    name: "lint_project",
    description: "Run the project's existing lint script and return bounded diagnostics.",
    schema: z.object({ timeout_ms: z.number().int().min(1000).max(600000).default(180000) }),
    async run(c, i) {
      return scripted(c, ["lint", "check"], i.timeout_ms);
    },
  },
  {
    name: "typecheck_project",
    description:
      "Run the project's existing typecheck script and return bounded compiler diagnostics.",
    schema: z.object({ timeout_ms: z.number().int().min(1000).max(600000).default(180000) }),
    async run(c, i) {
      return scripted(c, ["typecheck", "check:types"], i.timeout_ms);
    },
  },
  {
    name: "security_scan",
    description:
      "Run the package manager's dependency audit without applying fixes or changing lockfiles.",
    schema: z.object({
      severity: z.enum(["low", "moderate", "high", "critical"]).default("high"),
      timeout_ms: z.number().int().min(1000).max(600000).default(180000),
    }),
    async run(context, input) {
      const pkg = await readJson(context, "package.json");
      if (!pkg) return { output: "No package.json was found.", isError: true };
      const command = pkg.packageManager?.startsWith("pnpm")
        ? `pnpm audit --audit-level ${input.severity}`
        : `npm audit --audit-level=${input.severity}`;
      return exec(context, command, { timeoutMs: input.timeout_ms });
    },
  },
  {
    name: "quality_report",
    description:
      "Report which quality gates the project defines, without running or modifying anything.",
    schema: z.object({}),
    async run(context) {
      const pkg = await readJson(context, "package.json");
      if (!pkg) return { output: "No package.json was found.", isError: true };
      const gates = ["lint", "check", "typecheck", "test", "coverage", "build"].filter(
        (name) => pkg.scripts?.[name],
      );
      return jsonOutput({
        gates,
        scripts: Object.fromEntries(gates.map((name) => [name, pkg.scripts[name]])),
        engines: pkg.engines ?? {},
        packageManager: pkg.packageManager ?? "unspecified",
      });
    },
  },
];
