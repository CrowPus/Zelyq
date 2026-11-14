import {
  newId,
  OPS_SEE_ONLY_KINDS,
  OPS_TRUST_LEVELS,
  type OpsAccessItem,
  type OpsAccessKind,
  type OpsAccessLevel,
  type OpsTrust,
  opsAccessChangeSchema,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { AccessControl } from "../access.js";
import { checkBlocks } from "./blocks.js";

/**
 * What Ops has been given (076).
 *
 * Ops runs as a team admin so every Zelyq service accepts it unchanged; that
 * role says nothing about what it may reach. This does. A team admin assigns
 * each environment, machine, pipeline and app to Ops, at "see" or "manage",
 * and gives it the team's secret names (never their values) or not.
 * Anything not assigned does not exist for Ops: its lists leave it out, its
 * lookups do not find it, the watcher does not watch it, and the gate refuses
 * any change to it. Ops can never assign anything to itself.
 */

/** The one id the team's secret names are given under. */
export const VAULT_RESOURCE = "team";

const KIND_WORDS: Record<OpsAccessKind, string> = {
  environment: "environment",
  machine: "machine",
  pipeline: "pipeline",
  project: "app",
  vault: "secret names",
};

/** What Ops may reach, as loaded for one piece of work. */
export class OpsScope {
  private readonly levels = new Map<string, OpsAccessLevel>();

  constructor(
    readonly teamId: string,
    rows: Array<{ kind: string; resourceId: string; level: string }>,
  ) {
    for (const row of rows) {
      if (row.level === "see" || row.level === "manage") {
        this.levels.set(`${row.kind}:${row.resourceId}`, row.level);
      }
    }
  }

  level(kind: OpsAccessKind, id: string): OpsAccessLevel | null {
    return this.levels.get(`${kind}:${id}`) ?? null;
  }

  can(kind: OpsAccessKind, id: string, need: OpsAccessLevel = "see"): boolean {
    const level = this.level(kind, id);
    return need === "see" ? level !== null : level === "manage";
  }

  /** Something Ops just made under an approved plan: its own from now on. */
  add(kind: OpsAccessKind, id: string, level: OpsAccessLevel): void {
    this.levels.set(`${kind}:${id}`, level);
  }

  /** Nothing at all has been given yet. */
  get empty(): boolean {
    return this.levels.size === 0;
  }
}

/** One thing an action reaches, by the name Ops used for it. */
export type OpsTouch =
  | {
      kind: OpsAccessKind;
      name: string;
      need: OpsAccessLevel;
      /** A pipeline: everything inside it too (where it runs, what it deploys, what it starts). */
      contents?: boolean;
    }
  /** A pipeline file not saved yet: everything it would reach. */
  | { kind: "source"; source: string };

/** In words, what Ops would need for this, and how a person gives it; null when it has it. */
export async function missingAccess(
  store: Store,
  scope: OpsScope,
  given: OpsTouch[],
): Promise<string | null> {
  const missing: string[] = [];
  const touches = await expand(store, scope.teamId, given);
  for (const touch of touches) {
    if (touch.kind === "machine" && "labels" in touch) {
      // Any machine with these labels may be picked: every one of them must be Ops's.
      for (const machine of await machinesWith(store, scope.teamId, touch.labels)) {
        if (!scope.can("machine", machine.id, "manage")) {
          missing.push(
            `a pipeline step runs on any machine labelled ${touch.labels.join(", ")}, and the machine ${machine.name} has not been given to Ops to manage`,
          );
        }
      }
      continue;
    }
    const id = await idByName(store, scope.teamId, touch.kind, touch.name);
    // Something that does not exist is not an access question: the action says it is not there.
    if (!id) continue;
    if (scope.can(touch.kind, id, touch.need)) continue;
    const has = scope.level(touch.kind, id);
    missing.push(
      has === "see"
        ? `the ${KIND_WORDS[touch.kind]} ${touch.name} is only given to Ops to look at, not to change`
        : touch.kind === "vault"
          ? "the team's secret names have not been given to Ops"
          : `the ${KIND_WORDS[touch.kind]} ${touch.name} has not been given to Ops`,
    );
  }
  if (missing.length === 0) return null;
  return `Ops cannot do this: ${[...new Set(missing)].join("; ")}. A team admin gives it in Ops → Access.`;
}

type Plain = { kind: OpsAccessKind; name: string; need: OpsAccessLevel };
type Labelled = { kind: "machine"; labels: string[]; need: "manage" };

/**
 * Everything a pipeline reaches, read from its file: the machines it runs
 * on, the environments it deploys to, the app it checks out, and every
 * pipeline it starts, all the way down. Read past Ops's scope on purpose,
 * so a hidden thing inside is still found and named.
 */
async function expand(
  store: Store,
  teamId: string,
  given: OpsTouch[],
): Promise<(Plain | Labelled)[]> {
  const out: (Plain | Labelled)[] = [];
  const opened = new Set<string>();
  const fromSource = async (source: string, depth: number) => {
    let read: ReturnType<typeof checkBlocks>;
    try {
      read = checkBlocks(source);
    } catch {
      return;
    }
    for (const name of read.deploysTo) out.push({ kind: "environment", name, need: "manage" });
    for (const name of read.machines) out.push({ kind: "machine", name, need: "manage" });
    for (const labels of read.machineLabels) out.push({ kind: "machine", labels, need: "manage" });
    for (const name of read.apps) out.push({ kind: "project", name, need: "see" });
    for (const name of read.pipelines) {
      out.push({ kind: "pipeline", name, need: "manage" });
      await fromPipeline(name, depth + 1);
    }
  };
  const fromPipeline = async (name: string, depth: number) => {
    if (opened.has(name) || depth > 5) return;
    opened.add(name);
    const row = await store.pipelines.pipelines.findByName(teamId, name);
    if (row) await fromSource(row.source, depth);
  };
  for (const touch of given) {
    if (touch.kind === "source") {
      await fromSource(touch.source, 0);
      continue;
    }
    out.push({ kind: touch.kind, name: touch.name, need: touch.need });
    if (touch.kind === "pipeline" && touch.contents) await fromPipeline(touch.name, 0);
  }
  return out;
}

/** The team's machines a runs-on label list could pick: the same labels, system and tools the engine reads. */
async function machinesWith(store: Store, teamId: string, labels: string[]) {
  const list = (value: string) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map((item) => String(item).toLowerCase()) : [];
    } catch {
      return [];
    }
  };
  return (await store.pipelines.runners.listForTeam(teamId)).filter((runner) => {
    const has = new Set([
      ...list(runner.labels),
      ...(runner.os ? [runner.os.toLowerCase()] : []),
      ...list(runner.tools),
    ]);
    return labels.every((label) => has.has(label.toLowerCase()));
  });
}

async function idByName(
  store: Store,
  teamId: string,
  kind: OpsAccessKind,
  name: string,
): Promise<string | null> {
  switch (kind) {
    case "vault":
      return VAULT_RESOURCE;
    case "environment":
      return (await store.deploy.environments.findByName(teamId, name))?.id ?? null;
    case "machine":
      return (await store.pipelines.runners.findByName(teamId, name))?.id ?? null;
    case "pipeline":
      return (await store.pipelines.pipelines.findByName(teamId, name))?.id ?? null;
    case "project": {
      const projects = await store.projects.listForTeams([teamId], 500);
      return (
        projects.find((project) => project.name.toLowerCase() === name.trim().toLowerCase())?.id ??
        null
      );
    }
  }
}

/**
 * The store as Ops sees it: everything it reads about environments, machines,
 * pipelines, deployments and apps is cut down to what it was given. Built by
 * construction rather than by remembering to check: an action that forgets
 * the scope still cannot see past it.
 */
export function scopedStore(store: Store, scope: OpsScope): Store {
  const seeEnv = (id: string) => scope.can("environment", id);
  const seeMachine = (id: string) => scope.can("machine", id);
  const seePipeline = (id: string) => scope.can("pipeline", id);
  const seeProject = (id: string) => scope.can("project", id);
  const environments = store.deploy.environments;
  const deployments = store.deploy.deployments;
  const apps = store.deploy.apps;
  const runners = store.pipelines.runners;
  const pipelines = store.pipelines.pipelines;
  const runs = store.pipelines.runs;
  const keep = <T>(row: T | null, visible: (row: T) => boolean): T | null =>
    row && visible(row) ? row : null;
  return {
    ...store,
    deploy: {
      ...store.deploy,
      environments: {
        ...environments,
        listForTeam: async (teamId) =>
          (await environments.listForTeam(teamId)).filter((row) => seeEnv(row.id)),
        findById: async (id) => keep(await environments.findById(id), (row) => seeEnv(row.id)),
        findByName: async (teamId, name) =>
          keep(await environments.findByName(teamId, name), (row) => seeEnv(row.id)),
      },
      deployments: {
        ...deployments,
        findById: async (id) =>
          keep(await deployments.findById(id), (row) => seeEnv(row.environmentId)),
        listFor: async (environmentId, ...rest) =>
          seeEnv(environmentId) ? await deployments.listFor(environmentId, ...rest) : [],
        live: async (environmentIds) => await deployments.live(environmentIds.filter(seeEnv)),
        listByStatus: async (status) =>
          (await deployments.listByStatus(status)).filter((row) => seeEnv(row.environmentId)),
      },
      apps: {
        ...apps,
        find: async (environmentId, app) =>
          seeEnv(environmentId) ? await apps.find(environmentId, app) : null,
        listFor: async (environmentIds) => await apps.listFor(environmentIds.filter(seeEnv)),
      },
    },
    pipelines: {
      ...store.pipelines,
      runners: {
        ...runners,
        listForTeam: async (teamId) =>
          (await runners.listForTeam(teamId)).filter((row) => seeMachine(row.id)),
        findById: async (id) => keep(await runners.findById(id), (row) => seeMachine(row.id)),
        findByName: async (teamId, name) =>
          keep(await runners.findByName(teamId, name), (row) => seeMachine(row.id)),
      },
      pipelines: {
        ...pipelines,
        listForTeam: async (teamId) =>
          (await pipelines.listForTeam(teamId)).filter((row) => seePipeline(row.id)),
        findById: async (id) => keep(await pipelines.findById(id), (row) => seePipeline(row.id)),
        findByName: async (teamId, name) =>
          keep(await pipelines.findByName(teamId, name), (row) => seePipeline(row.id)),
      },
      runs: {
        ...runs,
        findById: async (id) => keep(await runs.findById(id), (row) => seePipeline(row.pipelineId)),
        lastForPipelines: async (ids) => await runs.lastForPipelines(ids.filter(seePipeline)),
      },
    },
    projects: {
      ...store.projects,
      listForTeams: async (teamIds, ...rest) =>
        (await store.projects.listForTeams(teamIds, ...rest)).filter((row) => seeProject(row.id)),
      findById: async (id) => keep(await store.projects.findById(id), (row) => seeProject(row.id)),
    },
  } as Store;
}

/**
 * Which operations sheets Ops may read. A sheet about an environment,
 * machine or app that exists in the team and was not given to Ops is hidden;
 * one about something that does not exist (yet, or any more) hides nothing.
 * The same rule as read_sheet, so recall and the opening notes agree with it.
 */
export async function visibleSubjects(
  store: Store,
  scope: OpsScope,
  teamId: string,
): Promise<(subject: string) => boolean> {
  const hidden = new Set<string>();
  const shown = new Set<string>();
  const sort = (subject: string, visible: boolean) => (visible ? shown : hidden).add(subject);
  const environments = await store.deploy.environments.listForTeam(teamId);
  for (const row of environments) {
    sort(`environment:${row.name}`, scope.can("environment", row.id));
  }
  for (const row of await store.pipelines.runners.listForTeam(teamId)) {
    // Its sheet is named after the machine's name made plain (facts.ts): both forms.
    sort(`machine:${row.name}`, scope.can("machine", row.id));
    sort(
      `machine:${row.name.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 63)}`,
      scope.can("machine", row.id),
    );
  }
  for (const row of await store.projects.listForTeams([teamId], 500)) {
    sort(`app:${slug(row.name)}`, scope.can("project", row.id));
  }
  // An app is also known by where it runs: seen when any environment it is live on is.
  for (const row of await store.deploy.deployments.live(environments.map((env) => env.id))) {
    sort(`app:${slug(row.app)}`, scope.can("environment", row.environmentId));
  }
  return (subject) => shown.has(subject) || !hidden.has(subject);
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** In a few lines, for Ops to read first: what it was given, and that nothing else is reachable. */
export async function accessSummary(
  store: Store,
  scope: OpsScope,
  teamId: string,
): Promise<string> {
  if (scope.empty) {
    return "Nothing has been given to you yet: you cannot see or change any environment, machine, pipeline or app. When someone asks for work, tell them a team admin first gives you what it needs in Ops → Access.";
  }
  const words = (level: OpsAccessLevel | null) => (level === "manage" ? "may change" : "look only");
  const environments = await store.deploy.environments.listForTeam(teamId);
  const machines = await store.pipelines.runners.listForTeam(teamId);
  const pipelines = await store.pipelines.pipelines.listForTeam(teamId);
  const projects = await store.projects.listForTeams([teamId], 500);
  const line = (label: string, items: string[]) =>
    `- ${label}: ${items.length ? items.join(", ") : "none"}`;
  return [
    "What you have been given (nothing else exists for you; a team admin gives more in Ops → Access):",
    line(
      "Environments",
      environments.map((row) => `${row.name} (${words(scope.level("environment", row.id))})`),
    ),
    line(
      "Machines",
      machines.map((row) => `${row.name} (${words(scope.level("machine", row.id))})`),
    ),
    line(
      "Pipelines",
      pipelines.map((row) => `${row.name} (${words(scope.level("pipeline", row.id))})`),
    ),
    line(
      "Apps' code (look only)",
      projects.map((row) => row.name),
    ),
    `- The team's secret names: ${scope.can("vault", VAULT_RESOURCE) ? "given (names only, never values)" : "not given"}`,
  ].join("\n");
}

/** The access list: what people see and change on Ops → Access. */
export class OpsAccess {
  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
  ) {}

  async scopeFor(teamId: string): Promise<OpsScope> {
    return new OpsScope(teamId, await this.store.ops.access.listForTeam(teamId));
  }

  /** Everything in the team that could be given, and what is. Any member may look. */
  async list(user: User, teamId: string): Promise<OpsAccessItem[]> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const scope = await this.scopeFor(teamId);
    const items: OpsAccessItem[] = [];
    const runners = await this.store.pipelines.runners.listForTeam(teamId);
    const machineName = new Map(runners.map((row) => [row.id, row.name]));
    for (const row of await this.store.deploy.environments.listForTeam(teamId)) {
      const trust = (OPS_TRUST_LEVELS as readonly string[]).includes(row.opsTrust)
        ? (row.opsTrust as OpsTrust)
        : "ask";
      items.push({
        kind: "environment",
        id: row.id,
        name: row.name,
        detail: row.runnerId ? `on ${machineName.get(row.runnerId) ?? "a machine"}` : null,
        level: scope.level("environment", row.id),
        trust,
        protected: row.protected,
        frozen: row.frozen,
      });
    }
    for (const row of runners) {
      items.push({
        kind: "machine",
        id: row.id,
        name: row.name,
        detail: row.host,
        level: scope.level("machine", row.id),
        trust: null,
        protected: false,
        frozen: false,
      });
    }
    for (const row of await this.store.pipelines.pipelines.listForTeam(teamId)) {
      items.push({
        kind: "pipeline",
        id: row.id,
        name: row.name,
        detail: null,
        level: scope.level("pipeline", row.id),
        trust: null,
        protected: false,
        frozen: false,
      });
    }
    for (const row of await this.store.projects.listForTeams([teamId], 500)) {
      items.push({
        kind: "project",
        id: row.id,
        name: row.name,
        detail: null,
        level: scope.level("project", row.id),
        trust: null,
        protected: false,
        frozen: false,
      });
    }
    items.push({
      kind: "vault",
      id: VAULT_RESOURCE,
      name: "The team's secret names",
      detail: "Names only. Ops never reads a secret's value.",
      level: scope.level("vault", VAULT_RESOURCE),
      trust: null,
      protected: false,
      frozen: false,
    });
    return items;
  }

  /** A team admin gives, changes or takes away one thing. Never Ops itself. */
  async change(user: User, teamId: string, raw: unknown): Promise<OpsAccessItem[]> {
    await this.access.requireTeamRole(user, teamId, "admin");
    if (await this.store.users.isService(user.id)) {
      throw new ZelyqError("forbidden", "Ops cannot change what it may reach.");
    }
    const input = opsAccessChangeSchema.parse(raw);
    if (input.level === "manage" && OPS_SEE_ONLY_KINDS.includes(input.kind)) {
      throw ZelyqError.badRequest(
        input.kind === "vault"
          ? "Ops only ever sees secret names; there is nothing to manage."
          : "Ops only looks at an app's code; it never changes it.",
      );
    }
    const name = await this.nameOf(teamId, input.kind, input.resourceId);
    if (name === null) throw ZelyqError.notFound("Thing", input.resourceId);
    const now = new Date().toISOString();
    if (input.level === null) {
      await this.store.ops.access.remove(teamId, input.kind, input.resourceId);
    } else {
      await this.store.ops.access.put({
        id: newId("opsAccess"),
        teamId,
        kind: input.kind,
        resourceId: input.resourceId,
        level: input.level,
        grantedBy: user.id,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (input.kind === "environment" && input.level === "manage" && input.trust) {
      await this.store.deploy.environments.update(input.resourceId, {
        opsTrust: input.trust,
        updatedAt: now,
      });
    }
    await this.access.recordChange(user, {
      teamId,
      action: "ops.access_changed",
      detail: {
        kind: input.kind,
        name,
        level: input.level ?? "none",
        ...(input.trust && input.level === "manage" ? { trust: input.trust } : {}),
      },
    });
    return this.list(user, teamId);
  }

  /**
   * Something Ops made under a plan a person approved is Ops's to manage: the
   * person who approved the plan gave it, in effect, when they approved it.
   */
  async grantCreated(
    teamId: string,
    kind: "environment" | "pipeline",
    resourceId: string,
    approvedBy: string | null,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.store.ops.access.put({
      id: newId("opsAccess"),
      teamId,
      kind,
      resourceId,
      level: "manage",
      grantedBy: approvedBy,
      createdAt: now,
      updatedAt: now,
    });
  }

  private async nameOf(teamId: string, kind: OpsAccessKind, id: string): Promise<string | null> {
    switch (kind) {
      case "environment": {
        const row = await this.store.deploy.environments.findById(id);
        return row?.teamId === teamId ? row.name : null;
      }
      case "machine": {
        const row = await this.store.pipelines.runners.findById(id);
        return row?.teamId === teamId ? row.name : null;
      }
      case "pipeline": {
        const row = await this.store.pipelines.pipelines.findById(id);
        return row?.teamId === teamId ? row.name : null;
      }
      case "project": {
        const row = await this.store.projects.findById(id);
        return row?.teamId === teamId ? row.name : null;
      }
      case "vault":
        return id === VAULT_RESOURCE ? "secret names" : null;
    }
  }
}
