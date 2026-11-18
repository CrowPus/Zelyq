import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roleAtLeast } from "@zelyq/core";
import {
  ExternalLink,
  Image as ImageIcon,
  Play,
  Rocket,
  Sparkles,
  Square,
  Trash2,
  Video,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppCardThumb } from "../components/AppCardThumb";
import { AppShell } from "../components/AppShell";
import {
  Avatar,
  Button,
  buttonClass,
  Card,
  CopyButton,
  confirmAction,
  DescriptionList,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageBody,
  PageHeader,
  RelativeTime,
  Skeleton,
  StatusBadge,
  Switch,
  statusOf,
  toast,
} from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { ApiError, api } from "../lib/api";
import { AUDIT_ACTION_LABELS, auditDetailSummary } from "../lib/audit";
import { formatDateTime } from "../lib/format";
import { t } from "../lib/i18n";
import { useTeamPaths } from "../lib/routes";

/** An app's front door (Overview) and its settings, under the app's own sidebar. */
export function AppDetailPage({ tab }: { tab: "overview" | "settings" }) {
  const { id = "" } = useParams();
  const { team } = useActiveTeam();
  const p = useTeamPaths();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id) });
  const current = project.data?.project;

  const shellApp = current
    ? {
        id: current.id,
        name: current.name,
        status: statusOf(current.status),
        statusLabel: current.status === "ready" ? t("Ready") : undefined,
      }
    : { id, name: "…" };

  return (
    <AppShell
      crumbs={[{ label: tab === "overview" ? t("Overview") : t("Settings") }]}
      app={shellApp}
    >
      <PageBody width={tab === "settings" ? "narrow" : "standard"}>
        {project.isLoading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-4 h-48" />
          </div>
        ) : project.isError || !current ? (
          <ErrorState
            title={t("This app could not be opened")}
            error={
              project.error instanceof ApiError && project.error.status === 404
                ? t("It may have been deleted, or it belongs to a team you are not in.")
                : project.error
            }
            onRetry={() => project.refetch()}
            action={
              <Link to={p.apps} className={buttonClass("secondary")}>
                {t("All apps")}
              </Link>
            }
          />
        ) : tab === "overview" ? (
          <Overview projectId={id} teamId={team?.id ?? current.teamId} />
        ) : (
          <SettingsTab projectId={id} />
        )}
      </PageBody>
    </AppShell>
  );
}

function Overview({ projectId, teamId }: { projectId: string; teamId: string }) {
  const p = useTeamPaths();
  const queryClient = useQueryClient();
  const { team } = useActiveTeam();
  const canEdit = team ? roleAtLeast(team.role, "editor") : false;
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId),
  });
  const preview = useQuery({
    queryKey: ["preview", projectId],
    queryFn: () => api.getPreview(projectId),
    refetchInterval: (query) => (query.state.data?.preview.status === "starting" ? 2000 : 15_000),
  });
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: api.listTemplates,
    staleTime: 300_000,
  });
  const environments = useQuery({
    queryKey: ["environments", teamId],
    queryFn: () => api.deploys.environments(teamId),
    retry: false,
  });
  const audit = useQuery({
    queryKey: ["audit-log", teamId],
    queryFn: () => api.auditLog(teamId),
    retry: false,
  });
  const [busy, setBusy] = useState(false);

  const app = project.data!.project;
  const template = templates.data?.templates.find((t) => t.name === app.template);
  const pv = preview.data?.preview;
  const previewStatus = statusOf(pv?.status ?? "stopped");
  const deployed = (environments.data?.environments ?? []).flatMap((env) =>
    env.live
      .filter((d) => d.app === app.name || d.app === app.slug)
      .map((d) => ({ env, deployment: d })),
  );
  const activity = (audit.data?.entries ?? []).filter((e) => e.projectId === projectId).slice(0, 6);

  async function togglePreview() {
    setBusy(true);
    try {
      if (pv?.status === "running" || pv?.status === "starting") await api.stopPreview(projectId);
      else await api.startPreview(projectId);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: ["preview", projectId] });
    }
  }

  return (
    <>
      <PageHeader
        title={app.name}
        description={app.description ?? template?.description}
        meta={
          <>
            <StatusBadge
              status={statusOf(app.status)}
              label={app.status === "ready" ? t("Ready") : undefined}
            />
            {template && (
              <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
                {template.icon && <img src={`/${template.icon}`} alt="" className="size-4" />}
                {template.title}
              </span>
            )}
            <span className="text-xs text-fg-muted">
              {t("Updated {when}", { when: <RelativeTime value={app.updatedAt} /> })}
            </span>
          </>
        }
        actions={
          <>
            {pv?.url && pv.status === "running" && (
              <a
                href={pv.url}
                target="_blank"
                rel="noreferrer"
                className={buttonClass("secondary")}
              >
                <ExternalLink size={14} /> {t("Open preview")}
              </a>
            )}
            <Link to={p.app(projectId)} className={buttonClass("primary")}>
              <Sparkles size={14} /> {t("Open builder")}
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card
            title={t("Preview")}
            description={t("A private copy of the app, running here so you can try it.")}
            actions={
              canEdit && (
                <Button
                  size="sm"
                  variant={pv?.status === "running" ? "secondary" : "primary"}
                  loading={busy}
                  icon={pv?.status === "running" ? <Square size={12} /> : <Play size={12} />}
                  onClick={togglePreview}
                >
                  {pv?.status === "running" || pv?.status === "starting"
                    ? t("Stop")
                    : t("Start preview")}
                </Button>
              )
            }
            padded={false}
          >
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,16rem)_1fr]">
              <div className="border-b border-border-default sm:border-r sm:border-b-0">
                <AppCardThumb project={app} height="h-40" stackIcon={template?.icon} />
              </div>
              <div className="p-4">
                <DescriptionList
                  items={[
                    {
                      label: t("Status"),
                      value: (
                        <StatusBadge
                          status={previewStatus}
                          label={
                            pv?.status === "running"
                              ? t("Running")
                              : pv?.status === "starting"
                                ? t("Starting")
                                : pv?.status === "crashed"
                                  ? t("Failed to start")
                                  : t("Stopped")
                          }
                          variant="inline"
                        />
                      ),
                    },
                    {
                      label: t("Address"),
                      value:
                        pv?.url && pv.status === "running" ? (
                          <a
                            href={pv.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline"
                          >
                            {pv.url.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          <span className="text-fg-muted">{t("Shown while the preview runs")}</span>
                        ),
                    },
                    {
                      label: t("Started"),
                      value: pv?.startedAt ? (
                        <RelativeTime value={pv.startedAt} />
                      ) : (
                        <span className="text-fg-muted">—</span>
                      ),
                    },
                  ]}
                />
                {pv?.lastError && <p className="mt-3 text-xs text-danger">{pv.lastError}</p>}
              </div>
            </div>
          </Card>

          <Card
            title={t("Deployments")}
            description={t("Where this app is live.")}
            actions={
              <Link to={p.deployments} className={buttonClass("ghost", "sm")}>
                <Rocket size={13} /> {t("All environments")}
              </Link>
            }
            padded={false}
          >
            {environments.isLoading ? (
              <div className="p-4">
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : deployed.length === 0 ? (
              <EmptyState
                compact
                icon={<Rocket size={20} />}
                title={t("Not deployed yet")}
                description={t(
                  "A pipeline puts an app on one of your environments once its tests pass. Add an environment and a pipeline that deploys this app.",
                )}
                action={
                  <Link to={p.deployments} className={buttonClass("secondary")}>
                    {t("Set up deployments")}
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-border-default">
                {deployed.map(({ env, deployment }) => (
                  <li key={deployment.id}>
                    <Link
                      to={p.deployedApp(env.id, deployment.app)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-fg">{env.name}</span>
                        <span className="block text-xs text-fg-muted">
                          {t("Deploy #{number} · {when}", {
                            number: deployment.number,
                            when: <RelativeTime value={deployment.createdAt} />,
                          })}
                        </span>
                      </span>
                      <StatusBadge
                        status={statusOf(deployment.status)}
                        label={deployment.status === "live" ? t("Live") : undefined}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title={t("Details")}>
            <DescriptionList
              items={[
                { label: t("Stack"), value: template?.title ?? app.template },
                {
                  label: t("App ID"),
                  value: (
                    <span className="flex items-center gap-1">
                      <code className="truncate font-mono text-xs">{app.id}</code>
                      <CopyButton value={app.id} label={t("Copy app ID")} />
                    </span>
                  ),
                },
                { label: t("Created"), value: formatDateTime(app.createdAt) },
                { label: t("Last changed"), value: formatDateTime(app.updatedAt) },
              ]}
            />
          </Card>

          {!audit.isError && (
            <Card title={t("Recent activity")} padded={false}>
              {activity.length === 0 ? (
                <p className="px-4 py-5 text-sm text-fg-muted">{t("No recorded changes yet.")}</p>
              ) : (
                <ul className="divide-y divide-border-default">
                  {activity.map((entry) => {
                    const detail = auditDetailSummary(entry.detail);
                    return (
                      <li key={entry.id} className="flex items-start gap-2.5 px-4 py-2.5">
                        <Avatar name={entry.actorName} size={20} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-fg-secondary">
                            <span className="font-medium text-fg">{entry.actorName}</span>{" "}
                            {AUDIT_ACTION_LABELS[entry.action]}
                            {detail && <span className="text-fg"> {detail}</span>}
                          </p>
                          <RelativeTime value={entry.createdAt} className="text-xs text-fg-muted" />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function SettingsTab({ projectId }: { projectId: string }) {
  const p = useTeamPaths();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { team } = useActiveTeam();
  const canEdit = team ? roleAtLeast(team.role, "editor") : false;
  const canDelete = team ? roleAtLeast(team.role, "admin") : false;
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId),
  });
  const app = project.data!.project;
  const [name, setName] = useState(app.name);
  useEffect(() => setName(app.name), [app.name]);

  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.updateProject>[1]) =>
      api.updateProject(projectId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  async function remove() {
    const ok = await confirmAction({
      title: t("Delete {name}?", { name: app.name }),
      description: t(
        "Its files, conversation, snapshots and preview are deleted for everyone in the team. This cannot be undone.",
      ),
      confirmLabel: t("Delete app"),
      danger: true,
      typeToConfirm: app.name,
    });
    if (!ok) return;
    try {
      await api.deleteProject(projectId);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(t("{name} was deleted", { name: app.name }));
      navigate(p.apps);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  const dirty = name.trim() !== app.name && name.trim().length > 0;

  return (
    <>
      <PageHeader
        title={t("App settings")}
        description={t("How {name} is named and what its agent may do.", { name: app.name })}
      />
      <div className="flex flex-col gap-6">
        <Card
          title={t("General")}
          footer={
            canEdit && (
              <>
                {dirty && (
                  <Button variant="ghost" onClick={() => setName(app.name)}>
                    {t("Discard")}
                  </Button>
                )}
                <Button
                  variant="primary"
                  disabled={!dirty}
                  loading={update.isPending}
                  onClick={() =>
                    update.mutate(
                      { name: name.trim() },
                      { onSuccess: () => toast.success(t("Name saved")) },
                    )
                  }
                >
                  {t("Save")}
                </Button>
              </>
            )
          }
        >
          <Field
            label={t("App name")}
            help={t("Shown in the app list, the breadcrumb and the browser tab.")}
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              disabled={!canEdit}
            />
          </Field>
        </Card>

        <Card
          title={t("What the agent may do")}
          description={t("Each one spends money against the team’s AI keys, so both start off.")}
        >
          <ul className="flex flex-col divide-y divide-border-default">
            <Permission
              icon={<ImageIcon size={16} />}
              title={t("Generate images")}
              detail={t("Pictures for the app: illustrations, icons, backgrounds.")}
              checked={app.imageGenerationEnabled}
              disabled={!canEdit || update.isPending}
              onChange={(next) =>
                update.mutate(
                  { imageGenerationEnabled: next },
                  {
                    onSuccess: () =>
                      toast.success(next ? t("Image generation on") : t("Image generation off")),
                  },
                )
              }
            />
            <Permission
              icon={<Video size={16} />}
              title={t("Generate video")}
              detail={t("Short clips. A clip costs far more than a picture.")}
              checked={app.videoGenerationEnabled}
              disabled={!canEdit || update.isPending}
              onChange={(next) =>
                update.mutate(
                  { videoGenerationEnabled: next },
                  {
                    onSuccess: () =>
                      toast.success(next ? t("Video generation on") : t("Video generation off")),
                  },
                )
              }
            />
          </ul>
        </Card>

        {canDelete && (
          <section className="overflow-hidden rounded-lg border border-danger/40">
            <header className="border-b border-danger/25 bg-danger-subtle px-4 py-3">
              <h3 className="text-sm font-semibold text-danger">{t("Danger zone")}</h3>
            </header>
            <div className="flex flex-wrap items-center gap-4 bg-surface px-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{t("Delete this app")}</p>
                <p className="mt-0.5 text-sm text-fg-secondary">
                  {t(
                    "Removes its files, conversation, snapshots and preview for everyone. This cannot be undone.",
                  )}
                </p>
              </div>
              <Button variant="danger-solid" icon={<Trash2 size={14} />} onClick={remove}>
                {t("Delete app")}
              </Button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function Permission({
  icon,
  title,
  detail,
  checked,
  disabled,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange(next: boolean): void;
}) {
  const id = `perm-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border-default text-fg-muted">
        {icon}
      </span>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="block text-xs text-fg-secondary">{detail}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </li>
  );
}
