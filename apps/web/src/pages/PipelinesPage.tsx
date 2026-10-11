import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roleAtLeast } from "@zelyq/core";
import { Plus, Star, Workflow } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { OverviewTab } from "../components/pipelines/OverviewTab";
import { PluginsTab } from "../components/pipelines/PluginsTab";
import { RunnersTab } from "../components/pipelines/RunnersTab";
import { StageStrip } from "../components/pipelines/Stages";
import { Badge, Button, EmptyState, Spinner } from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { api } from "../lib/api";
import { RUN_STATUS } from "../lib/pipelines";
import { formatRelative } from "../lib/vault";

type Tab = "pipelines" | "overview" | "runners" | "plugins";

/**
 * Pipelines — the work after the code is written (test, build, deploy), run
 * the same way every time, on the server or on the team's own machines.
 * Runners is the second tab: the machines, and the key they trust; Plugins
 * the third: ready-made steps the team installed.
 */
export function PipelinesPage() {
  const { team } = useActiveTeam();
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: Tab =
    asked === "runners" || asked === "plugins" || asked === "overview" ? asked : "pipelines";
  const canWrite = team ? roleAtLeast(team.role, "editor") : false;

  return (
    <AppShell crumbs={[{ label: "Pipelines" }]}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-6">
          <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold">
                <Workflow size={18} strokeWidth={1.75} /> Pipelines
              </h1>
              <p className="mt-1 max-w-xl text-xs text-fg-secondary">
                Test, build and deploy the same way every time — on this server, or on your own
                machines over SSH. Secrets come from the team's Vault and never appear in a log.
              </p>
            </div>
            {tab === "pipelines" && canWrite && (
              <Link to="/pipelines/new">
                <Button variant="primary" icon={<Plus size={14} />}>
                  New pipeline
                </Button>
              </Link>
            )}
          </header>

          <div role="tablist" className="mb-4 flex gap-1 border-b border-border-default">
            {(["pipelines", "overview", "runners", "plugins"] as const).map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                onClick={() =>
                  setParams(name === "pipelines" ? {} : { tab: name }, { replace: true })
                }
                className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
                  tab === name
                    ? "border-primary font-medium text-fg"
                    : "border-transparent text-fg-secondary hover:text-fg"
                }`}
              >
                {name === "pipelines"
                  ? "Pipelines"
                  : name === "overview"
                    ? "Overview"
                    : name === "runners"
                      ? "Runners"
                      : "Plugins"}
              </button>
            ))}
          </div>

          {!team ? (
            <EmptyState
              title="No team"
              description="Pipelines belong to a team. Create or join one first."
            />
          ) : tab === "runners" ? (
            <RunnersTab team={team} />
          ) : tab === "plugins" ? (
            <PluginsTab team={team} />
          ) : tab === "overview" ? (
            <OverviewTab teamId={team.id} />
          ) : (
            <PipelineList teamId={team.id} canWrite={canWrite} />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function PipelineList({ teamId, canWrite }: { teamId: string; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["pipelines", teamId],
    queryFn: () => api.pipelines.list(teamId),
    refetchInterval: 5000,
  });
  const star = useMutation({
    mutationFn: (input: { id: string; favorite: boolean }) =>
      api.pipelines.setFavorite(teamId, input.id, input.favorite),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["pipelines", teamId] }),
  });

  if (list.isLoading) return <Spinner />;
  // Starred first, each group in the server's order.
  const pipelines = [...(list.data?.pipelines ?? [])].sort(
    (a, b) => Number(b.favorite) - Number(a.favorite),
  );
  if (pipelines.length === 0) {
    return (
      <EmptyState
        title="No pipelines yet"
        description="A pipeline is a short file: stages, and the commands in each. Start from a template — Node, Python or Docker."
        action={
          canWrite && (
            <Link to="/pipelines/new">
              <Button variant="primary" icon={<Plus size={14} />}>
                New pipeline
              </Button>
            </Link>
          )
        }
      />
    );
  }
  return (
    <ul className="divide-y divide-border-default rounded-md border border-border-default">
      {pipelines.map((pipeline) => {
        const status = pipeline.lastRun ? RUN_STATUS[pipeline.lastRun.status] : null;
        return (
          <li key={pipeline.id} className="flex items-center hover:bg-surface-hover">
            <button
              type="button"
              aria-label={pipeline.favorite ? `Unstar ${pipeline.name}` : `Star ${pipeline.name}`}
              aria-pressed={pipeline.favorite}
              title={pipeline.favorite ? "Starred: shown first" : "Star it, to show it first"}
              disabled={star.isPending}
              onClick={() => star.mutate({ id: pipeline.id, favorite: !pipeline.favorite })}
              className="py-2.5 pr-1 pl-3 text-fg-muted hover:text-warning"
            >
              <Star
                size={15}
                className={pipeline.favorite ? "fill-warning text-warning" : ""}
                strokeWidth={1.75}
              />
            </button>
            <Link
              to={`/pipelines/${pipeline.id}`}
              className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-3 pl-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{pipeline.name}</p>
                <p className="text-xs text-fg-secondary">
                  runs on <span className="font-mono">{pipeline.runsOn}</span>
                  {pipeline.updatedBy && <> · changed by {pipeline.updatedBy.name}</>} ·{" "}
                  {formatRelative(pipeline.updatedAt)}
                </p>
              </div>
              {pipeline.lastRun && status ? (
                <span className="flex items-center gap-2 text-xs text-fg-secondary">
                  <StageStrip stages={pipeline.lastRun.stages} />#{pipeline.lastRun.number}
                  <Badge tone={status.tone}>{status.label}</Badge>
                </span>
              ) : (
                <span className="text-xs text-fg-muted">never run</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
