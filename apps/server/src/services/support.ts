import { newId, type User, ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { RuntimeDriver } from "@zelyq/runtime";
import { z } from "zod";
import type { AdminDirectory } from "./admin-directory.js";

/**
 * Helping a team, and switching features on and off.
 *
 * Support sees a team's facts (members, plan, status, apps, recent failures)
 * and its preview logs with a `support` key. Looking at what is inside an
 * app (its files) needs the team's own permission, given by one of its
 * admins for a while, and every look is shown in the team's activity: there
 * is no silent access.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const grantKey = (teamId: string) => `team:${teamId}:support-access`;

export const supportGrantSchema = z
  .object({
    hours: z
      .number()
      .int()
      .min(1)
      .max(14 * 24)
      .default(48),
  })
  .strict();

// ------------------------------------------------------------------ feature switches

/**
 * Features that can be switched off for everyone, a plan, a team or a person,
 * and the addresses each covers: switched off, those answer "switched off",
 * and the screens hide them.
 */
export const SWITCHABLE_FEATURES = {
  studio_image: { label: "Studio: images", routes: ["/api/images/"] },
  studio_video: { label: "Studio: video", routes: ["/api/videos/"] },
  voice: { label: "Voice input", routes: ["/voice/"] },
  ops: { label: "Ops (the DevOps engineer)", routes: ["/api/teams/:teamId/ops"] },
  outside_agents: {
    label: "Outside agents (Claude Code, Codex…)",
    routes: ["/api/teams/:teamId/agents", "/api/teams/:teamId/agent-requests"],
  },
  pipelines: {
    label: "Pipelines",
    routes: [
      "/api/teams/:teamId/pipelines",
      "/api/teams/:teamId/pipeline-",
      "/api/teams/:teamId/runners",
    ],
  },
  deploy: {
    label: "Deployments",
    routes: ["/api/teams/:teamId/environments", "/api/teams/:teamId/deployments"],
  },
  figma: { label: "Figma", routes: ["/api/integrations/figma"] },
  supabase: {
    label: "Supabase",
    routes: [
      "/api/integrations/supabase",
      "/api/projects/:id/supabase",
      "/api/projects/:id/backend",
    ],
  },
} as const;
export type SwitchableFeature = keyof typeof SWITCHABLE_FEATURES;
const featureNames = Object.keys(SWITCHABLE_FEATURES) as SwitchableFeature[];

const featureSwitchSchema = z
  .object({
    /** For everyone not named below. */
    enabled: z.boolean().default(true),
    plans: z.record(z.string(), z.boolean()).default({}),
    teams: z.record(z.string(), z.boolean()).default({}),
    people: z.record(z.string(), z.boolean()).default({}),
  })
  .strict();
type FeatureSwitch = z.infer<typeof featureSwitchSchema>;
const FEATURES_KEY = "features";

export class SupportService {
  /** The plan a team is on, for plan-wide switches. */
  planOf?: (teamId: string) => Promise<string>;
  private cache: { at: number; value: Partial<Record<SwitchableFeature, FeatureSwitch>> } | null =
    null;

  constructor(
    private readonly store: Store,
    private readonly runtime: RuntimeDriver,
    private readonly directory: AdminDirectory,
  ) {}

  // ------------------------------------------------------------------ facts

  async teamFacts(teamId: string) {
    const team = await this.directory.teamDetail(teamId);
    const apps = await this.store.projects.listForTeams([teamId]);
    const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
    const now = new Date().toISOString();
    const recent = await this.store.productEvents.list({
      from: since,
      to: now,
      teamId,
      limit: 2000,
    });
    const failures = recent
      .filter(
        (event) =>
          (event.name === "agent.build_finished" && event.detail.ok === false) ||
          event.name === "preview.failed" ||
          ((event.name === "pipeline.run_finished" || event.name === "deploy.finished") &&
            event.detail.ok === false) ||
          event.name === "limit.reached",
      )
      .slice(-30)
      .map((event) => ({
        at: event.createdAt,
        what: event.name,
        appId: event.projectId,
        detail: event.detail,
      }));
    return {
      team,
      usage: await this.directory
        .listUsage({ limit: "500" })
        .then((page) => page.usage.find((entry) => entry.teamId === teamId) ?? null),
      apps: apps.map((app) => ({
        id: app.id,
        name: app.name,
        template: app.template,
        status: app.status,
        statusMessage: app.statusMessage,
        updatedAt: app.updatedAt,
      })),
      lastWeek: {
        builds: recent.filter((event) => event.name === "agent.build_finished").length,
        failures,
      },
      access: await this.grant(teamId),
    };
  }

  async previewLogs(teamId: string, appId: string, lines = 300) {
    await this.appOf(teamId, appId);
    return {
      appId,
      logs: await this.runtime.previewLogs(appId, Math.min(Math.max(lines, 1), 2000)),
    };
  }

  // ------------------------------------------------------------------ the team's permission

  /** Given by a team admin: support may look inside the team's apps until then. */
  async grant(teamId: string): Promise<{ until: string; by: string } | null> {
    const stored = await this.store.settings.get(grantKey(teamId));
    if (!stored) return null;
    try {
      const grant = JSON.parse(stored) as { until: string; by: string };
      return grant.until > new Date().toISOString() ? grant : null;
    } catch {
      return null;
    }
  }

  async allow(user: User, teamId: string, raw: unknown) {
    const { hours } = supportGrantSchema.parse(raw ?? {});
    const role = await this.store.teams.roleOf(teamId, user.id);
    if (role !== "owner" && role !== "admin") {
      throw new ZelyqError("forbidden", "Only the team's owner or an admin can let support look.");
    }
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    await this.store.settings.set(grantKey(teamId), JSON.stringify({ until, by: user.email }));
    await this.audit(teamId, user, "support.access_given", { until, hours });
    return { until, by: user.email };
  }

  async withdraw(user: User, teamId: string) {
    const role = await this.store.teams.roleOf(teamId, user.id);
    if (role !== "owner" && role !== "admin") {
      throw new ZelyqError("forbidden", "Only the team's owner or an admin can change this.");
    }
    await this.store.settings.remove(grantKey(teamId));
    await this.audit(teamId, user, "support.access_withdrawn", {});
    return { access: null };
  }

  /** Inside an app: only with the team's permission, and the team sees every look. */
  async files(keyName: string, teamId: string, appId: string, path?: string) {
    await this.requireGrant(teamId);
    await this.appOf(teamId, appId);
    await this.audit(
      teamId,
      null,
      "support.looked",
      { key: keyName, appId, path: path ?? "/" },
      keyName,
    );
    return { appId, entries: await this.runtime.listFiles(appId, { path, depth: 2 }) };
  }

  async file(keyName: string, teamId: string, appId: string, path: string) {
    if (!path) throw ZelyqError.badRequest("Which file? ?path=src/App.tsx");
    await this.requireGrant(teamId);
    await this.appOf(teamId, appId);
    await this.audit(teamId, null, "support.looked", { key: keyName, appId, path }, keyName);
    return await this.runtime.readFile(appId, path);
  }

  private async requireGrant(teamId: string): Promise<void> {
    if (!(await this.store.teams.findById(teamId))) throw ZelyqError.notFound("Team", teamId);
    if (!(await this.grant(teamId))) {
      throw new ZelyqError(
        "forbidden",
        "This team has not let support look inside its apps. One of its admins can, in Team settings → Support access.",
        { reason: "no_support_access" },
      );
    }
  }

  private async appOf(teamId: string, appId: string) {
    const app = await this.store.projects.findById(appId);
    if (!app || app.teamId !== teamId) throw ZelyqError.notFound("App", appId);
    return app;
  }

  private async audit(
    teamId: string,
    user: User | null,
    action: "support.access_given" | "support.access_withdrawn" | "support.looked",
    detail: Record<string, unknown>,
    keyName?: string,
  ) {
    await this.store.auditLog.record({
      id: newId("audit"),
      teamId,
      projectId: typeof detail.appId === "string" ? detail.appId : null,
      userId: user?.id ?? null,
      actorName: user?.name ?? `Support (admin key "${keyName}")`,
      actorEmail: user?.email ?? "",
      action,
      detail,
      createdAt: new Date().toISOString(),
    });
  }

  // ------------------------------------------------------------------ feature switches

  private async switches(): Promise<Partial<Record<SwitchableFeature, FeatureSwitch>>> {
    if (this.cache && Date.now() - this.cache.at < 5_000) return this.cache.value;
    const stored = await this.store.settings.get(FEATURES_KEY);
    let value: Partial<Record<SwitchableFeature, FeatureSwitch>> = {};
    try {
      value = stored ? JSON.parse(stored) : {};
    } catch {
      value = {};
    }
    this.cache = { at: Date.now(), value };
    return value;
  }

  async listFeatures() {
    const switches = await this.switches();
    return {
      features: featureNames.map((name) => ({
        name,
        label: SWITCHABLE_FEATURES[name].label,
        ...(switches[name] ?? featureSwitchSchema.parse({})),
      })),
    };
  }

  async setFeature(name: string, raw: unknown) {
    if (!featureNames.includes(name as SwitchableFeature)) {
      throw ZelyqError.notFound("Feature", name);
    }
    const value = featureSwitchSchema.parse(raw ?? {});
    const switches = { ...(await this.switches()), [name]: value };
    await this.store.settings.set(FEATURES_KEY, JSON.stringify(switches));
    this.cache = null;
    return (await this.listFeatures()).features.find((feature) => feature.name === name);
  }

  async resetFeature(name: string) {
    if (!featureNames.includes(name as SwitchableFeature)) {
      throw ZelyqError.notFound("Feature", name);
    }
    const switches = { ...(await this.switches()) };
    delete switches[name as SwitchableFeature];
    await this.store.settings.set(FEATURES_KEY, JSON.stringify(switches));
    this.cache = null;
    return { name, enabled: true };
  }

  /** On or off for this person in this team: person, then team, then plan, then everyone. */
  async enabled(feature: SwitchableFeature, userId: string | null, teamId: string | null) {
    const rule = (await this.switches())[feature];
    if (!rule) return true;
    if (userId && rule.people[userId] !== undefined) return rule.people[userId]!;
    if (teamId && rule.teams[teamId] !== undefined) return rule.teams[teamId]!;
    if (teamId && Object.keys(rule.plans).length > 0 && this.planOf) {
      const plan = await this.planOf(teamId);
      if (rule.plans[plan] !== undefined) return rule.plans[plan]!;
    }
    return rule.enabled;
  }

  /** The switched-off features for this person in each of their teams: the screens hide them. */
  async switchedOff(userId: string, teamId: string): Promise<SwitchableFeature[]> {
    const off: SwitchableFeature[] = [];
    for (const name of featureNames)
      if (!(await this.enabled(name, userId, teamId))) off.push(name);
    return off;
  }

  /** Which feature an address belongs to, if any. */
  featureOf(route: string): SwitchableFeature | null {
    for (const name of featureNames) {
      // Voice lives under an app and under a team: matched anywhere in the address.
      const routes: readonly string[] = SWITCHABLE_FEATURES[name].routes;
      if (
        routes.some((prefix) =>
          prefix.startsWith("/api/") ? route.startsWith(prefix) : route.includes(prefix),
        )
      ) {
        return name;
      }
    }
    return null;
  }

  async requireEnabled(route: string, userId: string | null, teamId: string | null) {
    const feature = this.featureOf(route);
    if (feature && !(await this.enabled(feature, userId, teamId))) {
      throw new ZelyqError(
        "forbidden",
        `${SWITCHABLE_FEATURES[feature].label} is switched off here for now.`,
        { reason: "feature_off", feature },
      );
    }
  }
}
