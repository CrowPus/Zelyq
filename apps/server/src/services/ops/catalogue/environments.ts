import { connect } from "node:net";
import { automaticConcurrency } from "@zelyq/core";
import { z } from "zod";
import { refusedAddress } from "../../net-guard.js";
import { SshSession } from "../../pipelines/ssh.js";
import { environmentByName, environmentRef, type OpsAction } from "../actions.js";
import { environmentRow, machineByName, nameField } from "./shared.js";

const none = z.object({}).strict() as unknown as z.ZodType<Record<string, never>>;

const listMachines: OpsAction<Record<string, never>> = {
  name: "list_machines",
  description:
    "The team's machines (SSH runners): operating system, processors, memory, how many runs each takes at once, whether its last test passed.",
  input: none,
  risk: "read",
  words: () => "Look at the team's machines",
  async run(ctx) {
    const rows = await ctx.services.store.pipelines.runners.listForTeam(ctx.teamId);
    const machines = rows.map((row) => ({
      name: row.name,
      host: row.host,
      os: row.os,
      cpus: row.cpus,
      memoryMb: row.memoryMb,
      runsAtOnce:
        row.maxConcurrent > 0 ? row.maxConcurrent : automaticConcurrency(row.cpus, row.memoryMb),
      tools: JSON.parse(row.tools) as string[],
      enabled: row.enabled,
      confirmed: Boolean(row.hostKey),
      lastTestOk: row.lastTestOk,
    }));
    return {
      ok: true,
      summary: `${machines.length} machine${machines.length === 1 ? "" : "s"}.`,
      data: machines,
    };
  },
};

const machineInput = z.object({ machine: nameField("machine") }).strict();
const machineStatus: OpsAction<z.infer<typeof machineInput>> = {
  name: "machine_status",
  description: "A machine's free disk space, as measured now, and its size.",
  input: machineInput,
  risk: "read",
  words: (inputs) => `Look at ${inputs.machine}'s disk and size`,
  async run(ctx, inputs) {
    const runner = await machineByName(ctx, inputs.machine);
    const disk = await ctx.services.runners.disk(ctx.user, ctx.teamId, runner.id);
    return {
      ok: true,
      summary: `${runner.name}: ${JSON.stringify(disk).slice(0, 300)}`,
      data: { disk, cpus: runner.cpus, memoryMb: runner.memoryMb, os: runner.os },
    };
  },
};

/** The ports a machine listens on: one fixed, read-only command, never a shell for Ops. */
const PORTS_COMMAND =
  "sh -c 'ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null || cat /proc/net/tcp /proc/net/tcp6 2>/dev/null'";

export function listeningPorts(output: string): number[] {
  const ports = new Set<number>();
  for (const line of output.split("\n")) {
    // ss / netstat: "LISTEN 0 4096 0.0.0.0:8080 …" or "tcp 0 0 0.0.0.0:8080 … LISTEN"
    const address = /\s(\S+):(\d+)\s+\S+:[*\d]+/.exec(line);
    if (address?.[2] && (/LISTEN/.test(line) || /^LISTEN/.test(line.trim())))
      ports.add(Number(address[2]));
    // /proc/net/tcp: local address in hex, state 0A = listening
    const proc = /^\s*\d+:\s+[0-9A-F]+:([0-9A-F]{4})\s+[0-9A-F]+:[0-9A-F]{4}\s+0A\b/.exec(line);
    if (proc?.[1]) ports.add(Number.parseInt(proc[1], 16));
  }
  return [...ports].sort((a, b) => a - b);
}

const portsInMachine = z.object({ machine: nameField("machine") }).strict();
const machinePorts: OpsAction<z.infer<typeof portsInMachine>> = {
  name: "machine_ports",
  description:
    "The ports already in use on a machine, and free ones to choose. Look before choosing a host-port: two things cannot listen on one port.",
  input: portsInMachine,
  risk: "read",
  words: (inputs) => `Look at which ports are in use on ${inputs.machine}`,
  async run(ctx, inputs) {
    const runner = await machineByName(ctx, inputs.machine);
    const session = await SshSession.open(await ctx.services.runners.target(runner));
    try {
      const result = await session.capture(PORTS_COMMAND, 20_000);
      const inUse = listeningPorts(result.stdout);
      const free: number[] = [];
      for (let port = 3000; free.length < 5 && port < 10_000; port += 1) {
        if (!inUse.includes(port)) free.push(port);
      }
      return {
        ok: true,
        summary: `${runner.name}: ${inUse.length} ports in use; free from 3000: ${free.join(", ")}.`,
        data: { inUse, free },
      };
    } finally {
      session.close();
    }
  },
};

/** Whether a TCP port answers, from this server. */
function portOpen(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

const portsInput = z.object({ environment: nameField("environment") }).strict();
const checkPorts: OpsAction<z.infer<typeof portsInput>> = {
  name: "check_ports",
  description:
    "Whether the web ports (80 and 443) of an environment's machine answer from outside it. Closed ports usually mean a firewall in front of the machine.",
  input: portsInput,
  risk: "read",
  words: (inputs) => `Check that ${inputs.environment}'s machine answers on ports 80 and 443`,
  async run(ctx, inputs) {
    const environment = await environmentRow(ctx, inputs.environment);
    const runner = environment.runnerId
      ? await ctx.services.store.pipelines.runners.findById(environment.runnerId)
      : null;
    const host = environment.address ?? runner?.host;
    if (!host) return { ok: false, summary: `${environment.name} has no address to check.` };
    const ports = {
      80: await portOpen(host, environment.httpPort),
      443: await portOpen(host, environment.httpsPort),
    };
    return {
      ok: true,
      summary: `${host}: port ${environment.httpPort} ${ports[80] ? "open" : "closed"}, port ${environment.httpsPort} ${ports[443] ? "open" : "closed"}.`,
      data: { host, ports },
    };
  },
};

/** A domain the person owns: a name with a real ending, never an IP address. */
const domainField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .refine(
    (value) => /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value),
    "A domain the person owns (shop.com), never an IP address. Without one, leave domain out and give each app a host-port.",
  );

const createInput = z
  .object({
    name: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{0,39}$/, "Use lower-case letters, digits and '-' (staging)."),
    machine: nameField("machine"),
    /** Where people reach the machine; default the machine's own address. */
    address: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .refine(
        (value) => !/^[^:[\]]+:\d+$/.test(value) && !/^\[.*\]:\d+$/.test(value),
        "The machine's address only, without a port: ports belong to each app (host-port in its deploy step).",
      )
      .refine((value) => /^[A-Za-z0-9.:[\]-]+$/.test(value), "An IP address or a host name.")
      .optional(),
    /** Every app gets <app>.<domain>, with HTTPS. */
    domain: domainField.optional(),
    https: z.enum(["auto", "internal", "off", "external"]).optional(),
    /** Production: every deploy needs a person. Ops may make an environment protected, never unprotected. */
    protected: z.boolean().optional(),
  })
  .strict();
const createEnvironment: OpsAction<z.infer<typeof createInput>> = {
  name: "create_environment",
  description:
    "Create an environment (staging, production) on one of the team's machines. Production should be protected: every deploy to it then waits for a person.",
  input: createInput,
  risk: "change",
  words: (inputs) =>
    `Create the ${inputs.protected ? "protected " : ""}environment ${inputs.name} on ${inputs.machine}${inputs.domain ? `, apps at <app>.${inputs.domain}` : ""}`,
  undo: (inputs) => `Remove the environment ${inputs.name} (nothing runs there yet)`,
  async run(ctx, inputs) {
    const runner = await machineByName(ctx, inputs.machine);
    const address = inputs.address ?? runner.host;
    const refused = /^[0-9.:[\]a-f]+$/i.test(address)
      ? refusedAddress(address, "deployment")
      : null;
    if (refused) return { ok: false, summary: refused };
    await ctx.services.deploys.create(ctx.user, ctx.teamId, {
      name: inputs.name,
      runnerId: runner.id,
      address,
      ...(inputs.domain ? { domain: inputs.domain } : {}),
      ...(inputs.https ? { https: inputs.https } : {}),
      protected: inputs.protected ?? false,
      variables: {},
    });
    return { ok: true, summary: `Created ${inputs.name} on ${runner.name} (${address}).` };
  },
  async prove(ctx, inputs) {
    const environment = await environmentByName(ctx, inputs.name);
    const row = environment
      ? await ctx.services.store.deploy.environments.findByName(ctx.teamId, inputs.name)
      : null;
    const runner = row?.runnerId
      ? await ctx.services.store.pipelines.runners.findById(row.runnerId)
      : null;
    return {
      kind: "environment_exists",
      target: inputs.name,
      ok: Boolean(
        row &&
          runner?.name === inputs.machine &&
          row.address &&
          row.protected === (inputs.protected ?? false),
      ),
      detail: row
        ? `On ${runner?.name ?? "?"}, address ${row.address}, ${row.protected ? "protected" : "not protected"}.`
        : null,
    };
  },
};

const variablesInput = z
  .object({
    environment: nameField("environment"),
    /** NAME: value. A secret is always vault://NAME, never its value. */
    set: z
      .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/), z.string().max(1000))
      .default({}),
    remove: z.array(z.string()).default([]),
  })
  .strict();

/** A value that looks like a key or a password: it belongs in Vault, not in a plan. */
function looksSecret(value: string): boolean {
  return (
    /^(sk|pk|rk)_(live|test)_/.test(value) ||
    /^(ghp|gho|ghs|github_pat)_/.test(value) ||
    /^AKIA[0-9A-Z]{12,}/.test(value) ||
    /^xox[abposr]-/.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
    /^[A-Za-z0-9+/_-]{32,}={0,2}$/.test(value)
  );
}

const setVariables: OpsAction<z.infer<typeof variablesInput>> = {
  name: "set_environment_variables",
  description:
    "Add, change or remove an environment's variables by name. A secret is always given as vault://NAME (a person puts its value in Vault). Other variables keep their values.",
  input: variablesInput,
  risk: "change",
  environment: (ctx, inputs) => environmentByName(ctx, inputs.environment),
  words: (inputs) => {
    const set = Object.entries(inputs.set).map(([name, value]) =>
      value.startsWith("vault://") ? `${name} from Vault (${value.slice(8)})` : `${name}=${value}`,
    );
    return `On ${inputs.environment}: ${[...(set.length ? [`set ${set.join(", ")}`] : []), ...(inputs.remove.length ? [`remove ${inputs.remove.join(", ")}`] : [])].join("; ") || "no change"}`;
  },
  undo: () => "Set the variables back as they were",
  async run(ctx, inputs) {
    for (const [name, value] of Object.entries(inputs.set)) {
      if (!value.startsWith("vault://") && looksSecret(value)) {
        return {
          ok: false,
          summary: `${name} looks like a secret. Ask the person to put it in Vault, then use vault://${name}.`,
        };
      }
    }
    const environment = await environmentRow(ctx, inputs.environment);
    const existing = JSON.parse(environment.variables) as Record<string, unknown>;
    // An empty value keeps what is there: Zelyq never sends values back, so none are lost.
    const variables: Record<string, string> = {};
    for (const name of Object.keys(existing)) {
      if (!inputs.remove.includes(name)) variables[name] = "";
    }
    Object.assign(variables, inputs.set);
    await ctx.services.deploys.update(ctx.user, ctx.teamId, environment.id, { variables });
    return {
      ok: true,
      summary: `Variables on ${environment.name}: ${Object.keys(variables).join(", ") || "none"}.`,
    };
  },
  async prove(ctx, inputs) {
    const environment = await environmentRow(ctx, inputs.environment);
    const names = Object.keys(JSON.parse(environment.variables) as Record<string, unknown>);
    const ok =
      Object.keys(inputs.set).every((name) => names.includes(name)) &&
      inputs.remove.every((name) => !names.includes(name));
    return {
      kind: "variables_set",
      target: environment.name,
      ok,
      detail: `Names now: ${names.join(", ") || "none"}.`,
    };
  },
};

const updateInput = z
  .object({
    environment: nameField("environment"),
    /** The machine's address people reach (no port). */
    address: createInput.shape.address,
    /** Every app gets <app>.<domain>, with HTTPS; null takes the domain away. */
    domain: domainField.nullable().optional(),
    https: z.enum(["auto", "internal", "off", "external"]).optional(),
    /** Ops may protect an environment; only a person takes protection away. */
    protected: z.literal(true).optional(),
  })
  .strict();
const updateEnvironment: OpsAction<z.infer<typeof updateInput>> = {
  name: "update_environment",
  description:
    "Change an environment's address, domain or HTTPS, or make it protected. Taking protection away, freezing and unfreezing are a person's decision and are not here.",
  input: updateInput,
  risk: "change",
  environment: (ctx, inputs) => environmentByName(ctx, inputs.environment),
  words: (inputs) => {
    const changes = [
      ...(inputs.address ? [`address ${inputs.address}`] : []),
      ...(inputs.domain !== undefined
        ? [inputs.domain ? `apps at <app>.${inputs.domain}` : "no domain"]
        : []),
      ...(inputs.https ? [`HTTPS ${inputs.https}`] : []),
      ...(inputs.protected ? ["protected"] : []),
    ];
    return `Change ${inputs.environment}: ${changes.join(", ") || "nothing"}`;
  },
  undo: () => "Set the environment back as it was",
  async run(ctx, inputs) {
    const environment = await environmentRow(ctx, inputs.environment);
    if (inputs.address) {
      const refused = /^[0-9.:[\]a-f]+$/i.test(inputs.address)
        ? refusedAddress(inputs.address, "deployment")
        : null;
      if (refused) return { ok: false, summary: refused };
    }
    const change = {
      ...(inputs.address ? { address: inputs.address } : {}),
      ...(inputs.domain !== undefined ? { domain: inputs.domain } : {}),
      ...(inputs.https ? { https: inputs.https } : {}),
      ...(inputs.protected ? { protected: true } : {}),
    };
    if (Object.keys(change).length === 0) return { ok: false, summary: "Nothing to change." };
    await ctx.services.deploys.update(ctx.user, ctx.teamId, environment.id, change);
    return { ok: true, summary: `Changed ${environment.name}.` };
  },
  async prove(ctx, inputs) {
    const row = await environmentRow(ctx, inputs.environment);
    const ok =
      (!inputs.address || row.address === inputs.address) &&
      (inputs.domain === undefined || (row.domain ?? null) === inputs.domain) &&
      (!inputs.https || row.https === inputs.https) &&
      (!inputs.protected || row.protected);
    return {
      kind: "environment_exists",
      target: row.name,
      ok,
      detail: `Address ${row.address ?? "none"}, domain ${row.domain ?? "none"}, HTTPS ${row.https}, ${row.protected ? "protected" : "not protected"}.`,
    };
  },
};

const listDatabases: OpsAction<Record<string, never>> = {
  name: "list_databases",
  description:
    "The databases the team's apps use: a Postgres started beside the app by Zelyq (its data kept in a named volume across deploys), or one of the person's own given as DATABASE_URL in the environment's variables (such as Supabase).",
  input: none,
  risk: "read",
  words: () => "Look at the apps' databases",
  async run(ctx) {
    const environments = await ctx.services.store.deploy.environments.listForTeam(ctx.teamId);
    const apps = await ctx.services.store.deploy.apps.listFor(environments.map((row) => row.id));
    const databases: Array<Record<string, unknown>> = [];
    for (const environment of environments) {
      const names = Object.keys(JSON.parse(environment.variables) as Record<string, unknown>);
      if (names.includes("DATABASE_URL")) {
        databases.push({
          environment: environment.name,
          kind: "the person's own, from DATABASE_URL",
          apps: "every app in this environment that asks for a database",
        });
      }
      for (const app of apps.filter((row) => row.environmentId === environment.id)) {
        if (!app.database) continue;
        const container = `zelyq-db-${environment.name}-${app.app}`;
        databases.push({
          environment: environment.name,
          app: app.app,
          kind: "postgres beside the app",
          container,
          keptIn: `${container}-data`,
        });
      }
    }
    return {
      ok: true,
      summary: `${databases.length} database${databases.length === 1 ? "" : "s"}.`,
      data: databases,
    };
  },
};

const listEnvironments: OpsAction<Record<string, never>> = {
  name: "list_environments",
  description:
    "The team's environments: name, machine, address, domain, whether protected or frozen, how much Ops may do there alone, and the variable names it gives apps.",
  input: none,
  risk: "read",
  words: () => "Look at the team's environments",
  async run(ctx) {
    const rows = await ctx.services.store.deploy.environments.listForTeam(ctx.teamId);
    const environments = await Promise.all(
      rows.map(async (row) => ({
        ...environmentRef(row),
        machine: row.runnerId
          ? ((await ctx.services.store.pipelines.runners.findById(row.runnerId))?.name ?? null)
          : null,
        address: row.address,
        domain: row.domain,
        https: row.https,
        variables: Object.keys(JSON.parse(row.variables) as Record<string, unknown>),
        live: (await ctx.services.store.deploy.deployments.live([row.id])).map((deployment) => ({
          app: deployment.app,
          number: deployment.number,
          url: deployment.url,
        })),
      })),
    );
    return {
      ok: true,
      summary: `${environments.length} environment${environments.length === 1 ? "" : "s"}.`,
      data: environments,
    };
  },
};

export const ENVIRONMENT_ACTIONS = [
  listMachines,
  machineStatus,
  machinePorts,
  checkPorts,
  listEnvironments,
  createEnvironment,
  updateEnvironment,
  setVariables,
  listDatabases,
] as unknown as OpsAction[];
