import { z } from "zod";
import { chooseScript, exec, jsonOutput, projectFiles, quote, readJson } from "./lib/shared.mjs";

export default [
  {
    name: "discover_tests",
    description:
      "Discover test files, test-related package scripts, and likely test frameworks without running tests.",
    schema: z.object({ depth: z.number().int().min(1).max(16).default(12) }),
    async run(context, input) {
      const files = (await projectFiles(context, input.depth))
        .filter((e) => e.type !== "directory")
        .map((e) => e.path);
      const pkg = await readJson(context, "package.json");
      const tests = files.filter((path) =>
        /(^|\/)(__tests__|test|tests|spec)(\/|\.)|\.(test|spec)\.[^.]+$/i.test(path),
      );
      const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
      const frameworks = [
        "vitest",
        "jest",
        "mocha",
        "ava",
        "playwright",
        "cypress",
        "pytest",
      ].filter((name) => deps[name] || files.some((f) => f.toLowerCase().includes(name)));
      return jsonOutput({
        testFiles: tests.slice(0, 400),
        scripts: Object.fromEntries(
          Object.entries(pkg?.scripts ?? {}).filter(([name]) =>
            /test|spec|e2e|integration/.test(name),
          ),
        ),
        frameworks,
      });
    },
  },
  {
    name: "run_targeted_tests",
    description:
      "Run a project test script, optionally passing a specific test path. Uses an existing package.json script and never installs dependencies.",
    schema: z.object({
      script: z
        .string()
        .regex(/^[A-Za-z0-9:_-]+$/)
        .optional(),
      path: z.string().optional(),
      timeout_ms: z.number().int().min(1000).max(600000).default(180000),
    }),
    async run(context, input) {
      const pkg = await readJson(context, "package.json");
      const script = input.script ?? chooseScript(pkg, ["test", "test:unit", "test:integration"]);
      if (!script || !pkg?.scripts?.[script])
        return { output: "No matching test script exists in package.json.", isError: true };
      const manager = pkg.packageManager?.startsWith("pnpm")
        ? "pnpm"
        : pkg.packageManager?.startsWith("yarn")
          ? "yarn"
          : "npm";
      const separator = manager === "npm" && input.path ? " --" : "";
      return exec(
        context,
        `${manager} run ${script}${separator}${input.path ? ` ${quote(input.path)}` : ""}`,
        { timeoutMs: input.timeout_ms },
      );
    },
  },
  {
    name: "summarize_test_failures",
    description:
      "Run the default test script with bounded output optimized for diagnosing failures. Returns exit status and the runner's final output.",
    schema: z.object({ timeout_ms: z.number().int().min(1000).max(600000).default(180000) }),
    async run(context, input) {
      const pkg = await readJson(context, "package.json");
      const script = chooseScript(pkg, ["test", "test:unit"]);
      if (!script) return { output: "No test script exists in package.json.", isError: true };
      const manager = pkg.packageManager?.startsWith("pnpm") ? "pnpm" : "npm";
      return exec(context, `${manager} run ${script}`, {
        timeoutMs: input.timeout_ms,
        maxOutputBytes: 30000,
      });
    },
  },
  {
    name: "coverage_report",
    description:
      "Run an existing coverage script and return its bounded report. Refuses to invent flags when the project has no coverage script.",
    schema: z.object({ timeout_ms: z.number().int().min(1000).max(600000).default(240000) }),
    async run(context, input) {
      const pkg = await readJson(context, "package.json");
      const script = chooseScript(pkg, ["coverage", "test:coverage"]);
      if (!script)
        return {
          output: "No coverage or test:coverage script exists in package.json.",
          isError: true,
        };
      const manager = pkg.packageManager?.startsWith("pnpm") ? "pnpm" : "npm";
      return exec(context, `${manager} run ${script}`, { timeoutMs: input.timeout_ms });
    },
  },
];
