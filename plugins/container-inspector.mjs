import { z } from "zod";
import { exec, jsonOutput, readText } from "./lib/shared.mjs";

export default [
  {
    name: "inspect_dockerfile",
    description:
      "Inspect a Dockerfile and report stages, base images, exposed ports, commands, user selection, and common hardening concerns.",
    schema: z.object({ path: z.string().default("Dockerfile") }),
    async run(context, input) {
      const content = await readText(context, input.path);
      if (content === null) return { output: `${input.path} was not found.`, isError: true };
      const lines = content.split("\n");
      const instructions = lines
        .map((line, index) => ({ line: index + 1, text: line.trim() }))
        .filter((x) => /^[A-Z]+\s/.test(x.text));
      const concerns = [];
      if (!instructions.some((x) => x.text.startsWith("USER ")))
        concerns.push("No USER instruction; the final container may run as root.");
      if (instructions.some((x) => /^FROM\s+[^\s:]+(:latest)?$/i.test(x.text)))
        concerns.push("An unpinned or latest base image is used.");
      if (instructions.some((x) => /^ADD\s+https?:/i.test(x.text)))
        concerns.push("Remote ADD reduces build reproducibility.");
      if (instructions.some((x) => /curl.+\|\s*(sh|bash)/i.test(x.text)))
        concerns.push("A downloaded script is piped directly to a shell.");
      return jsonOutput({
        stages: instructions.filter((x) => x.text.startsWith("FROM ")),
        exposedPorts: instructions.filter((x) => x.text.startsWith("EXPOSE ")),
        users: instructions.filter((x) => x.text.startsWith("USER ")),
        instructions,
        concerns,
      });
    },
  },
  {
    name: "inspect_compose_file",
    description:
      "Inspect a Compose YAML file for services, images, builds, ports, volumes, privileged mode, host networking, and secret-like inline environment values.",
    schema: z.object({ path: z.string().default("docker-compose.yml") }),
    async run(context, input) {
      const content = await readText(context, input.path);
      if (content === null) return { output: `${input.path} was not found.`, isError: true };
      const serviceNames = [...content.matchAll(/^\s{2}([\w.-]+):\s*$/gm)]
        .map((m) => m[1])
        .filter((n) => n !== "services");
      const flags = {
        privileged: /privileged:\s*true/i.test(content),
        hostNetwork: /network_mode:\s*["']?host/i.test(content),
        dockerSocket: /\/var\/run\/docker\.sock/.test(content),
        inlineSecretCandidates: [
          ...content.matchAll(
            /^\s*-?\s*([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|KEY)[A-Z0-9_]*)\s*[:=]/gim,
          ),
        ].map((m) => m[1]),
      };
      return jsonOutput({
        services: serviceNames,
        images: [...content.matchAll(/^\s*image:\s*(.+)$/gm)].map((m) => m[1].trim()),
        builds: [...content.matchAll(/^\s*build:\s*(.+)$/gm)].map((m) => m[1].trim()),
        flags,
      });
    },
  },
  {
    name: "build_container_image",
    description:
      "Build the project's container image for verification. Does not push, run, tag a registry, or modify source files.",
    schema: z.object({
      dockerfile: z.string().default("Dockerfile"),
      context_path: z.string().default("."),
      tag: z
        .string()
        .regex(/^[a-z0-9][a-z0-9._/-]*(:[a-z0-9._-]+)?$/)
        .default("zelyq-validation:local"),
      timeout_ms: z.number().int().min(10000).max(600000).default(600000),
    }),
    async run(context, input) {
      return exec(
        context,
        `docker build --file '${input.dockerfile.replaceAll("'", `'"'"'`)}' --tag '${input.tag}' '${input.context_path.replaceAll("'", `'"'"'`)}'`,
        input.timeout_ms,
      );
    },
  },
  {
    name: "container_security_report",
    description:
      "Run an existing Trivy filesystem scan when Trivy is available in the project runtime. It does not download scanners or apply fixes.",
    schema: z.object({
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("HIGH"),
      timeout_ms: z.number().int().min(10000).max(600000).default(300000),
    }),
    async run(context, input) {
      return exec(
        context,
        `trivy fs --scanners vuln,misconfig,secret --severity ${input.severity},CRITICAL --no-progress .`,
        input.timeout_ms,
      );
    },
  },
];
