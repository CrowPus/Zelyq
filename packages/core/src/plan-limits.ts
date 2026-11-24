// No zod here: the web app reads these before anything else loads.

export const PLAN_LIMITS = {
  storageMb: {
    label: "Storage",
    unit: "MB",
    description:
      "What the team made and could not get back: its apps' own files and history, undo points, Studio's images and videos, chat attachments and pipeline files. Installed packages and build output are not counted: Zelyq can always reinstall them.",
  },
  apps: { one: "app", label: "Apps", unit: "", description: "Apps in the team." },
  pipelines: {
    one: "pipeline",
    label: "Pipelines",
    unit: "",
    description: "Pipelines in the team.",
  },
  triggers: {
    one: "webhook or schedule",
    label: "Webhooks and schedules",
    unit: "",
    description: "What starts the team's pipelines by itself: webhooks, schedules, app changes.",
  },
  environments: {
    one: "environment",
    label: "Environments",
    unit: "",
    description: "Places the team deploys to.",
  },
  machines: {
    one: "machine",
    label: "Machines",
    unit: "",
    description: "The team's own servers (runners).",
  },
  runsAtOnce: {
    one: "run at once",
    label: "Pipeline runs at once",
    unit: "",
    description:
      "Pipeline runs the team has going at the same time, on its own machines or this server's. More wait in line and start as soon as one ends; none fail for it.",
  },
  members: {
    label: "Members",
    unit: "",
    description: "People in the team, with invitations still waiting.",
  },
  previews: {
    one: "preview at once",
    label: "Previews at once",
    unit: "",
    description: "Apps the team runs in Zelyq's preview at the same time.",
  },
  runnerMinutes: {
    label: "Runner minutes a month",
    unit: "min",
    description:
      "Pipeline time on this server's own runner, this month. Runs on the team's own machines are free.",
  },
} as const;

export type PlanLimitKey = keyof typeof PLAN_LIMITS;
export const PLAN_LIMIT_KEYS = Object.keys(PLAN_LIMITS) as PlanLimitKey[];
