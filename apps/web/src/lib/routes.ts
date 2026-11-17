import type { TeamMembership } from "@zelyq/core";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { useSession } from "../hooks/useSession";

/**
 * Addresses. Everything a team owns lives under the team's slug, so a link
 * opens the same view for anyone who can see it:
 *
 *   /default                       the team's Home
 *   /default/apps                  its apps
 *   /default/apps/prj_…            one app (by id: app names, and so slugs, can repeat)
 *   /default/pipelines/…           pipelines, runs, deployments, ops, vault, …
 *   /default/settings#email        a team settings section
 *   /account, /admin, /docs        not a team's: the person's, the server's, everyone's
 */

/** First path segments the app itself uses; a team with one of these as its slug is addressed by id. */
export const RESERVED = new Set([
  "signin",
  "reset-password",
  "invite",
  "account",
  "admin",
  "settings",
  "docs",
  "dev",
  "projects",
  "teams",
  "studio",
  "image-studio",
  "video-studio",
  "vault",
  "agents",
  "pipelines",
  "deployments",
  "ops",
  "api",
  "assets",
  "agent-gateway",
]);

/** The path segment for a team: its slug, or its id when the slug is taken by the app. */
export function teamKey(team: Pick<TeamMembership, "id" | "slug">): string {
  return team.slug && !RESERVED.has(team.slug) ? team.slug : team.id;
}

export type AppSection = "overview" | "build" | "settings";
export type AppPanel = "git" | "variables" | "snapshots" | "backend";

export function teamPaths(key: string) {
  const base = `/${encodeURIComponent(key)}`;
  return {
    home: base,
    apps: `${base}/apps`,
    newApp: `${base}/apps?new=1`,
    app: (id: string, section: AppSection = "build") =>
      section === "build" ? `${base}/apps/${id}` : `${base}/apps/${id}/${section}`,
    appPanel: (id: string, panel: AppPanel) => `${base}/apps/${id}?panel=${panel}`,
    studio: `${base}/studio`,
    studioImage: `${base}/studio/image`,
    studioVideo: `${base}/studio/video`,
    agents: `${base}/agents`,
    vault: `${base}/vault`,
    pipelines: `${base}/pipelines`,
    pipeline: (id: string) => `${base}/pipelines/${id}`,
    run: (pipelineId: string, runId: string) => `${base}/pipelines/${pipelineId}/runs/${runId}`,
    deployments: `${base}/deployments`,
    deployedApp: (environmentId: string, app: string) =>
      `${base}/deployments/${environmentId}/apps/${encodeURIComponent(app)}`,
    ops: `${base}/ops`,
    members: `${base}/members`,
    settings: (section?: string) => (section ? `${base}/settings#${section}` : `${base}/settings`),
  };
}

export type TeamPaths = ReturnType<typeof teamPaths>;

/** Addresses for the team you are in. */
export function useTeamPaths(): TeamPaths {
  const { team } = useActiveTeam();
  const key = team ? teamKey(team) : "";
  return useMemo(() => teamPaths(key), [key]);
}

/** The team named in the address (`/:team/...`), matched by slug or id. */
export function useRouteTeam(): TeamMembership | undefined {
  const { team: param } = useParams();
  const { teams } = useSession();
  if (!param) return undefined;
  return teams.find((t) => t.slug === param || t.id === param);
}

export const globalPaths = {
  account: "/account",
  admin: (section?: string) => (section ? `/admin#${section}` : "/admin"),
  docs: "/docs",
  signIn: "/signin",
};

/*
 * The team in the address, for code that builds a link outside a hook (and
 * for the many links that only need the team prefix). Set by the `/:team`
 * route before anything under it renders.
 */
let currentTeamKey = "";
export function setCurrentTeamKey(key: string) {
  currentTeamKey = key;
}
/** `/pipelines/x` → `/default/pipelines/x`, in the team being viewed. */
export function teamHref(path: string): string {
  return currentTeamKey ? `/${encodeURIComponent(currentTeamKey)}${path}` : path;
}
