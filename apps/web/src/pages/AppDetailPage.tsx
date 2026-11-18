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
        statusLabel: current.status === "ready" ? "Ready" : undefined,
      }
    : { id, name: "…" };

  return (
    <AppShell crumbs={[{ label: tab === "overview" ? "Overview" : "Settings" }]} app={shellApp}>
      <PageBody width={tab === "settings" ? "narrow" : "standard"}>
        {project.isLoading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-4 h-48" />
          </div>
        ) : project.isError || !current ? (
          <ErrorState
            title="This app could not be opened"
            error={
              project.error instanceof ApiError && project.error.status === 404
                ? "It may have been deleted, or it belongs to a team you are not in."
                : project.error
            }
            onRetry={() => project.refetch()}
            action={
              <Link to={p.apps} className={buttonClass("secondary")}>
                All apps
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
              label={app.status === "ready" ? "Ready" : undefined}
            />
            {template && (
              <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
                {template.icon && <img src={`/${template.icon}`} alt="" className="size-4" />}
                {template.title}
              </span>
            )}
            <span className="text-xs text-fg-muted">
              Updated <RelativeTime value={app.updatedAt} />
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
                <ExternalLink size={14} /> Open preview
              </a>
            )}
            <Link to={p.app(projectId)} className={buttonClass("primary")}>
              <Sparkles size={14} /> Open builder
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card
            title="Preview"
            description="A private copy of the app, running here so you can try it."
            actions={
              canEdit && (
                <Button
                  size="sm"
                  variant={pv?.status === "running" ? "secondary" : "primary"}
                  loading={busy}
                  icon={pv?.status === "running" ? <Square size={12} /> : <Play size={12} />}
                  onClick={togglePreview}
                >
                  {pv?.status === "running" || pv?.status === "starting" ? "Stop" : "Start preview"}
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
                      label: "Status",
                      value: (
                        <StatusBadge
                          status={previewStatus}
                          label={
                            pv?.status === "running"
                              ? "Running"
                              : pv?.status === "starting"
                                ? "Starting"
                                : pv?.status === "crashed"
                                  ? "Failed to start"
                                  : "Stopped"
                          }
                          variant="inline"
                        />
                      ),
                    },
                    {
                      label: "Address",
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
                          <span className="text-fg-muted">Shown while the preview runs</span>
                        ),
                    },
                    {
                      label: "Started",
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
            title="Deployments"
            description="Where this app is live."
            actions={
              <Link to={p.deployments} className={buttonClass("ghost", "sm")}>
                <Rocket size={13} /> All environments
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
                title="Not deployed yet"
                description="A pipeline puts an app on one of your environments once its tests pass. Add an environment and a pipeline that deploys this app."
                action={
                  <Link to={p.deployments} className={buttonClass("secondary")}>
                    Set up deployments
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
                          Deploy #{deployment.number} ·{" "}
                          <RelativeTime value={deployment.createdAt} />
                        </span>
                      </span>
                      <StatusBadge
                        status={statusOf(deployment.status)}
                        label={deployment.status === "live" ? "Live" : undefined}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Details">
            <DescriptionList
              items={[
                { label: "Stack", value: template?.title ?? app.template },
                {
                  label: "App ID",
                  value: (
                    <span className="flex items-center gap-1">
                      <code className="truncate font-mono text-xs">{app.id}</code>
                      <CopyButton value={app.id} label="Copy app ID" />
                    </span>
                  ),
                },
                { label: "Created", value: formatDateTime(app.createdAt) },
                { label: "Last changed", value: formatDateTime(app.updatedAt) },
              ]}
            />
          </Card>

          {!audit.isError && (
            <Card title="Recent activity" padded={false}>
              {activity.length === 0 ? (
                <p className="px-4 py-5 text-sm text-fg-muted">No recorded changes yet.</p>
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
      title: `Delete ${app.name}?`,
      description:
        "Its files, conversation, snapshots and preview are deleted for everyone in the team. This cannot be undone.",
      confirmLabel: "Delete app",
      danger: true,
      typeToConfirm: app.name,
    });
    if (!ok) return;
    try {
      await api.deleteProject(projectId);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`${app.name} was deleted`);
      navigate(p.apps);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  const dirty = name.trim() !== app.name && name.trim().length > 0;

  return (
    <>
      <PageHeader
        title="App settings"
        description={`How ${app.name} is named and what its agent may do.`}
      />
      <div className="flex flex-col gap-6">
        <Card
          title="General"
          footer={
            canEdit && (
              <>
                {dirty && (
                  <Button variant="ghost" onClick={() => setName(app.name)}>
                    Discard
                  </Button>
                )}
                <Button
                  variant="primary"
                  disabled={!dirty}
                  loading={update.isPending}
                  onClick={() =>
                    update.mutate(
                      { name: name.trim() },
                      { onSuccess: () => toast.success("Name saved") },
                    )
                  }
                >
                  Save
                </Button>
              </>
            )
          }
        >
          <Field label="App name" help="Shown in the app list, the breadcrumb and the browser tab.">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              disabled={!canEdit}
            />
          </Field>
        </Card>

        <Card
          title="What the agent may do"
          description="Each one spends money against the team's AI keys, so both start off."
        >
          <ul className="flex flex-col divide-y divide-border-default">
            <Permission
              icon={<ImageIcon size={16} />}
              title="Generate images"
              detail="Pictures for the app: illustrations, icons, backgrounds."
              checked={app.imageGenerationEnabled}
              disabled={!canEdit || update.isPending}
              onChange={(next) =>
                update.mutate(
                  { imageGenerationEnabled: next },
                  {
                    onSuccess: () =>
                      toast.success(next ? "Image generation on" : "Image generation off"),
                  },
                )
              }
            />
            <Permission
              icon={<Video size={16} />}
              title="Generate video"
              detail="Short clips. A clip costs far more than a picture."
              checked={app.videoGenerationEnabled}
              disabled={!canEdit || update.isPending}
              onChange={(next) =>
                update.mutate(
                  { videoGenerationEnabled: next },
                  {
                    onSuccess: () =>
                      toast.success(next ? "Video generation on" : "Video generation off"),
                  },
                )
              }
            />
          </ul>
        </Card>

        {canDelete && (
          <section className="overflow-hidden rounded-lg border border-danger/40">
            <header className="border-b border-danger/25 bg-danger-subtle px-4 py-3">
              <h3 className="text-sm font-semibold text-danger">Danger zone</h3>
            </header>
            <div className="flex flex-wrap items-center gap-4 bg-surface px-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">Delete this app</p>
                <p className="mt-0.5 text-sm text-fg-secondary">
                  Removes its files, conversation, snapshots and preview for everyone. This cannot
                  be undone.
                </p>
              </div>
              <Button variant="danger-solid" icon={<Trash2 size={14} />} onClick={remove}>
                Delete app
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
