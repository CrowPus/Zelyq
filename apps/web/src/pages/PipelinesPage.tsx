import { useQuery } from "@tanstack/react-query";
import { roleAtLeast } from "@zelyq/core";
import { Plus, Workflow } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { PluginsTab } from "../components/pipelines/PluginsTab";
import { RunnersTab } from "../components/pipelines/RunnersTab";
import { StageStrip } from "../components/pipelines/Stages";
import { Badge, Button, EmptyState, Spinner } from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { api } from "../lib/api";
import { RUN_STATUS } from "../lib/pipelines";
import { formatRelative } from "../lib/vault";

type Tab = "pipelines" | "runners" | "plugins";

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
  const tab: Tab = asked === "runners" || asked === "plugins" ? asked : "pipelines";
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
            {(["pipelines", "runners", "plugins"] as const).map((name) => (
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
                {name === "pipelines" ? "Pipelines" : name === "runners" ? "Runners" : "Plugins"}
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
          ) : (
            <PipelineList teamId={team.id} canWrite={canWrite} />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function PipelineList({ teamId, canWrite }: { teamId: string; canWrite: boolean }) {
  const list = useQuery({
    queryKey: ["pipelines", teamId],
    queryFn: () => api.pipelines.list(teamId),
    refetchInterval: 5000,
  });

  if (list.isLoading) return <Spinner />;
  const pipelines = list.data?.pipelines ?? [];
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
          <li key={pipeline.id}>
            <Link
              to={`/pipelines/${pipeline.id}`}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-hover"
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
