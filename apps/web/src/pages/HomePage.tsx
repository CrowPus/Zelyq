import { useQuery } from "@tanstack/react-query";
import { roleAtLeast } from "@zelyq/core";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Inbox as InboxIcon,
  LayoutGrid,
  Plus,
  Rocket,
  Users,
  Workflow,
  X,
  XCircle,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { AppCardThumb } from "../components/AppCardThumb";
import { AppShell } from "../components/AppShell";
import {
  Avatar,
  Button,
  buttonClass,
  Card,
  EmptyState,
  PageBody,
  PageHeader,
  RelativeTime,
  Skeleton,
  StatTile,
} from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { AUDIT_ACTION_LABELS, auditDetailSummary } from "../lib/audit";
import { formatNumber } from "../lib/format";
import { t } from "../lib/i18n";
import { useTeamPaths } from "../lib/routes";

/**
 * The team's front door. Answers "what needs me?" in one screen: how far the
 * team has got setting up, the apps it works on, what is failing or waiting,
 * how much of the plan is used, and what changed recently.
 */
export function HomePage() {
  const { team } = useActiveTeam();
  const { user } = useSession();
  const p = useTeamPaths();
  const teamId = team?.id ?? "";
  const isAdmin = team ? roleAtLeast(team.role, "admin") : false;
  const quiet = { enabled: Boolean(teamId), retry: false, staleTime: 15_000 } as const;

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const pipelines = useQuery({
    queryKey: ["pipelines", teamId],
    queryFn: () => api.pipelines.list(teamId),
    ...quiet,
  });
  const environments = useQuery({
    queryKey: ["environments", teamId],
    queryFn: () => api.deploys.environments(teamId),
    ...quiet,
  });
  const members = useQuery({
    queryKey: ["members", teamId],
    queryFn: () => api.listMembers(teamId),
    ...quiet,
  });
  const approvals = useQuery({
    queryKey: ["inbox-pipeline-approvals", teamId],
    queryFn: () => api.pipelines.waitingApprovals(teamId),
    ...quiet,
  });
  const usage = useQuery({
    queryKey: ["team-usage", teamId],
    queryFn: () => api.teamUsage(teamId),
    ...quiet,
  });
  const audit = useQuery({
    queryKey: ["audit-log", teamId],
    queryFn: () => api.auditLog(teamId),
    ...quiet,
  });

  const apps = (projects.data?.projects ?? [])
    .filter((project) => project.teamId === teamId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const firstName = user?.name.trim().split(/\s+/)[0];

  const failing = (pipelines.data?.pipelines ?? []).filter((pl) => pl.lastRun?.status === "failed");
  const waiting = approvals.data?.approvals ?? [];
  const nearLimit = (usage.data?.lines ?? []).filter(
    (line) =>
      line.key !== "runsAtOnce" &&
      line.limit !== null &&
      line.limit > 0 &&
      line.used / line.limit >= 0.8,
  );

  return (
    <AppShell crumbs={[{ label: t("Home") }]}>
      <PageBody>
        <PageHeader
          title={firstName ? t("Welcome back, {firstName}", { firstName }) : t("Home")}
          description={t("What is happening in {name}.", { name: team?.name ?? t("your team") })}
          actions={
            <Link to={p.newApp} className={buttonClass("primary")}>
              <Plus size={15} /> {t("New app")}
            </Link>
          }
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
            <GettingStarted
              teamId={teamId}
              steps={[
                {
                  id: "app",
                  label: t("Create your first app"),
                  hint: t("Describe it and the agent builds it."),
                  done: apps.length > 0,
                  to: p.newApp,
                },
                {
                  id: "preview",
                  label: t("See it running in a preview"),
                  hint: t("Open an app and start its preview."),
                  done: apps.some((a) => a.thumbnailAt),
                  to: apps[0] ? p.app(apps[0].id) : p.apps,
                },
                {
                  id: "invite",
                  label: t("Invite a teammate"),
                  hint: t("Everyone in the team sees its apps."),
                  done: (members.data?.members.length ?? 0) > 1,
                  to: p.members,
                },
                {
                  id: "pipeline",
                  label: t("Add a pipeline"),
                  hint: t("Test and build the same way every time."),
                  done: (pipelines.data?.pipelines.length ?? 0) > 0,
                  to: p.pipeline("new"),
                },
                {
                  id: "deploy",
                  label: t("Put an app online"),
                  hint: t("Add an environment and deploy to it."),
                  done: (environments.data?.environments ?? []).some((env) => env.live.length > 0),
                  to: p.deployments,
                },
              ]}
            />

            <Card
              title={t("Recent apps")}
              actions={
                <Link to={p.apps} className={buttonClass("ghost", "sm")}>
                  {t("All apps")} <ArrowRight size={13} />
                </Link>
              }
              padded={false}
            >
              {projects.isLoading ? (
                <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-36" />
                  ))}
                </div>
              ) : apps.length === 0 ? (
                <EmptyState
                  compact
                  icon={<LayoutGrid size={20} />}
                  title={t("No apps yet")}
                  description={t(
                    "Describe what you want built. The agent works in a real workspace, so everything it writes is a file you can read.",
                  )}
                  action={
                    <Link to={p.newApp} className={buttonClass("primary")}>
                      <Plus size={15} /> {t("New app")}
                    </Link>
                  }
                />
              ) : (
                <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                  {apps.slice(0, 6).map((app) => (
                    <li key={app.id}>
                      <Link
                        to={p.app(app.id)}
                        className="group block overflow-hidden rounded-lg border border-border-default bg-surface transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-[0_2px_8px_rgb(0_0_0/0.06)]"
                      >
                        <AppCardThumb project={app} height="h-24" />
                        <div className="flex items-center gap-2 border-t border-border-default px-3 py-2.5">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                            {app.name}
                          </span>
                          <RelativeTime value={app.updatedAt} className="text-xs text-fg-muted" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {!audit.isError && (
              <Card title={t("Recent activity")} padded={false}>
                {audit.isLoading ? (
                  <div className="flex flex-col gap-3 p-4">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-4 w-2/3" />
                    ))}
                  </div>
                ) : (audit.data?.entries.length ?? 0) === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-fg-muted">
                    {t("Nothing has happened in this team yet.")}
                  </p>
                ) : (
                  <ul className="divide-y divide-border-default">
                    {audit.data!.entries.slice(0, 8).map((entry) => {
                      const detail = auditDetailSummary(entry.detail);
                      return (
                        <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                          <Avatar name={entry.actorName} size={24} />
                          <p className="min-w-0 flex-1 truncate text-sm text-fg-secondary">
                            <span className="font-medium text-fg">{entry.actorName}</span>{" "}
                            {AUDIT_ACTION_LABELS[entry.action]}
                            {detail && <span className="font-medium text-fg"> {detail}</span>}
                          </p>
                          <RelativeTime
                            value={entry.createdAt}
                            className="shrink-0 text-xs text-fg-muted"
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Card title={t("Needs attention")} padded={false}>
              {pipelines.isLoading || approvals.isLoading ? (
                <div className="flex flex-col gap-3 p-4">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : failing.length === 0 && waiting.length === 0 && nearLimit.length === 0 ? (
                <div className="flex items-center gap-3 px-4 py-5">
                  <CheckCircle2 size={18} className="shrink-0 text-success" />
                  <p className="text-sm text-fg-secondary">
                    {t("All clear. Nothing is failing or waiting on you.")}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border-default">
                  {waiting.slice(0, 4).map((item) => (
                    <Attention
                      key={item.approvalId}
                      icon={<InboxIcon size={16} className="text-info" />}
                      title={t("{pipeline} #{run} is waiting for approval", {
                        pipeline: item.pipeline,
                        run: item.run,
                      })}
                      detail={item.message}
                      to={p.run(item.pipelineId, item.runId)}
                    />
                  ))}
                  {failing.slice(0, 4).map((pl) => (
                    <Attention
                      key={pl.id}
                      icon={<XCircle size={16} className="text-danger" />}
                      title={t("{name} failed", { name: pl.name })}
                      detail={pl.lastRun ? <RelativeTime value={pl.lastRun.createdAt} /> : null}
                      to={pl.lastRun ? p.run(pl.id, pl.lastRun.id) : p.pipeline(pl.id)}
                    />
                  ))}
                  {nearLimit.map((line) => (
                    <Attention
                      key={line.key}
                      icon={<AlertTriangle size={16} className="text-warning" />}
                      title={t("{label}: {used} of {value}{value2}", {
                        label: line.label,
                        used: formatNumber(line.used),
                        value: formatNumber(line.limit!),
                        value2: line.unit ? ` ${line.unit}` : "",
                      })}
                      detail={t("Close to the plan’s limit")}
                      to={isAdmin ? p.settings("usage-and-plan") : p.home}
                    />
                  ))}
                </ul>
              )}
            </Card>

            {usage.data && (
              <Card
                title={
                  usage.data.plansVisible
                    ? t("Usage · {name} plan", { name: usage.data.plan.name })
                    : t("Usage")
                }
                actions={
                  isAdmin ? (
                    <Link to={p.settings("usage-and-plan")} className={buttonClass("ghost", "sm")}>
                      {t("Details")}
                    </Link>
                  ) : undefined
                }
              >
                <div className="flex flex-col gap-5">
                  {usage.data.lines
                    .filter((line) =>
                      ["apps", "members", "runnerMinutes", "storageMb"].includes(line.key),
                    )
                    .slice(0, 4)
                    .map((line) => (
                      <StatTile
                        key={line.key}
                        label={line.label}
                        value={`${formatNumber(line.used, { maximumFractionDigits: line.unit === "MB" ? 2 : 0 })}${
                          line.limit === null ? "" : ` / ${formatNumber(line.limit)}`
                        }${line.unit ? ` ${line.unit}` : ""}`}
                        meter={line.limit ? line.used / line.limit : undefined}
                      />
                    ))}
                </div>
              </Card>
            )}

            <Card title={t("Shortcuts")} padded={false}>
              <ul className="divide-y divide-border-default">
                <Shortcut to={p.pipelines} icon={<Workflow size={15} />} label={t("Pipelines")} />
                <Shortcut to={p.deployments} icon={<Rocket size={15} />} label={t("Deployments")} />
                <Shortcut to={p.members} icon={<Users size={15} />} label={t("Members")} />
              </ul>
            </Card>
          </div>
        </div>
      </PageBody>
    </AppShell>
  );
}

function Attention({
  icon,
  title,
  detail,
  to,
}: {
  icon: ReactNode;
  title: string;
  detail?: ReactNode;
  to: string;
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
      >
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{title}</span>
          {detail && <span className="mt-0.5 block truncate text-xs text-fg-muted">{detail}</span>}
        </span>
      </Link>
    </li>
  );
}

function Shortcut({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-3 px-4 py-2.5 text-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <span className="text-fg-muted">{icon}</span>
        <span className="flex-1">{label}</span>
        <ArrowRight size={14} className="text-fg-muted" />
      </Link>
    </li>
  );
}

const DISMISS_KEY = "zelyq.getting-started.hidden";

function GettingStarted({
  teamId,
  steps,
}: {
  teamId: string;
  steps: Array<{ id: string; label: string; hint: string; done: boolean; to: string }>;
}) {
  const [hidden, setHidden] = useState(() => {
    try {
      return (localStorage.getItem(DISMISS_KEY) ?? "").split(",").includes(teamId);
    } catch {
      return false;
    }
  });
  const done = steps.filter((s) => s.done).length;
  if (hidden || done === steps.length) return null;

  function hide() {
    setHidden(true);
    try {
      const current = (localStorage.getItem(DISMISS_KEY) ?? "").split(",").filter(Boolean);
      localStorage.setItem(DISMISS_KEY, [...current, teamId].join(","));
    } catch {
      // Without storage it comes back next visit; that is fine.
    }
  }

  return (
    <Card
      title={t("Get started")}
      description={t("{done} of {stepCount} done", { done, stepCount: steps.length })}
      actions={
        <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={hide}>
          {t("Hide")}
        </Button>
      }
      padded={false}
    >
      <div
        role="progressbar"
        aria-label={t("Setup progress")}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        className="h-1 bg-surface-active"
      >
        <div
          className="h-full bg-accent transition-[width]"
          style={{ width: `${(done / steps.length) * 100}%` }}
        />
      </div>
      <ol className="divide-y divide-border-default">
        {steps.map((step, index) => (
          <li key={step.id}>
            <Link
              to={step.to}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
            >
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium ${
                  step.done
                    ? "border-success bg-success text-white"
                    : "border-border-control text-fg-secondary"
                }`}
              >
                {step.done ? <Check size={13} strokeWidth={3} /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-sm font-medium ${step.done ? "text-fg-muted line-through" : "text-fg"}`}
                >
                  {step.label}
                </span>
                {/* Shown when done too: a row keeps its height as the
                    answers arrive, so nothing below it jumps. */}
                <span className="block text-xs text-fg-muted">{step.hint}</span>
              </span>
              <ArrowRight
                size={14}
                className={`shrink-0 text-fg-muted ${step.done ? "invisible" : ""}`}
              />
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
