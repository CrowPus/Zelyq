import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PipelineSummary } from "@zelyq/core";
import { roleAtLeast } from "@zelyq/core";
import { GitBranch, Plus, Star } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import {
  FilterSelect,
  FilterToggle,
  ListToolbar,
  matches,
  NothingMatches,
  Pager,
  pageOf,
  SearchBox,
  useListParams,
} from "../components/ListControls";
import { OverviewTab } from "../components/pipelines/OverviewTab";
import { PluginsTab } from "../components/pipelines/PluginsTab";
import { RunnersTab } from "../components/pipelines/RunnersTab";
import { StageStrip } from "../components/pipelines/Stages";
import {
  Badge,
  buttonClass,
  EmptyState,
  PageBody,
  PageHeader,
  Spinner,
  Tabs,
} from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { RUN_STATUS } from "../lib/pipelines";
import { teamHref, useTeamPaths } from "../lib/routes";
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
  const paths = useTeamPaths();
  const tab: Tab =
    asked === "runners" || asked === "plugins" || asked === "overview" ? asked : "pipelines";
  const canWrite = team ? roleAtLeast(team.role, "editor") : false;
  // The same list the tab shows (shared, not fetched twice).
  const pipelineCount =
    useQuery({
      queryKey: ["pipelines", team?.id],
      queryFn: () => api.pipelines.list(team?.id as string),
      enabled: Boolean(team),
    }).data?.pipelines.length ?? 0;

  return (
    <AppShell crumbs={[{ label: t("Pipelines") }]}>
      <PageBody width="standard">
        <PageHeader
          title={t("Pipelines")}
          description={t(
            "Test, build and deploy the same way every time, on this server or on your own machines over SSH. Secrets come from the team’s Vault and never appear in a log.",
          )}
          actions={
            tab === "pipelines" &&
            canWrite &&
            pipelineCount > 0 && (
              <Link to={paths.pipeline("new")} className={buttonClass("primary")}>
                <Plus size={15} />
                {t("New pipeline")}
              </Link>
            )
          }
        />

        <div className="mb-6">
          <Tabs
            label={t("Pipelines sections")}
            value={tab}
            onChange={(name) =>
              // Each tab starts without the list's search and filters.
              setParams(name === "pipelines" ? {} : { tab: name }, { replace: true })
            }
            items={[
              { id: "pipelines", label: t("Pipelines"), count: pipelineCount || undefined },
              { id: "overview", label: t("Overview") },
              { id: "runners", label: t("Runners") },
              { id: "plugins", label: t("Plugins") },
            ]}
          />
        </div>

        {!team ? (
          <EmptyState
            title={t("No team")}
            description={t("Pipelines belong to a team. Create or join one first.")}
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
      </PageBody>
    </AppShell>
  );
}

/** How a pipeline's last run went, in the few groups people filter by. */
const OUTCOMES = [
  { value: "failed", label: t("Last run failed"), statuses: ["failed", "timed_out"] },
  { value: "passed", label: t("Last run passed"), statuses: ["passed"] },
  { value: "running", label: t("Running now"), statuses: ["queued", "pending", "running"] },
  { value: "waiting", label: t("Waiting for approval"), statuses: ["waiting"] },
  { value: "cancelled", label: t("Last run cancelled"), statuses: ["cancelled"] },
  { value: "never", label: t("Never run"), statuses: [] },
] as const;

const SORTS = [
  { value: "", label: t("Recent activity") },
  { value: "name", label: t("Name A–Z") },
  { value: "changed", label: t("Recently changed") },
];

/** When something last happened: its last run, or its last change. */
function activity(pipeline: PipelineSummary): string {
  const run = pipeline.lastRun?.createdAt ?? "";
  return run > pipeline.updatedAt ? run : pipeline.updatedAt;
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
  const filters = useListParams(`pipelines.${teamId}`, ["q", "last", "on", "starred", "sort"]);
  const q = filters.get("q");
  const last = filters.get("last");
  const on = filters.get("on");
  const starred = filters.get("starred") === "1";
  const sort = filters.get("sort");

  if (list.isLoading) return <Spinner />;
  const all = list.data?.pipelines ?? [];
  if (all.length === 0) {
    return (
      <EmptyState
        title={t("No pipelines yet")}
        description={t(
          "A pipeline is a short file: stages, and the commands in each. Start from a template — Node, Python or Docker.",
        )}
        action={
          canWrite && (
            <Link to={teamHref("/pipelines/new")} className={buttonClass("primary")}>
              <Plus size={14} />
              {t("New pipeline")}
            </Link>
          )
        }
      />
    );
  }
  const outcome = OUTCOMES.find((choice) => choice.value === last);
  const machines = [...new Set(all.map((pipeline) => pipeline.runsOn))].sort();
  const shown = all
    .filter(
      (pipeline) =>
        matches(q, pipeline.name, pipeline.runsOn, pipeline.repoPath, pipeline.updatedBy?.name) &&
        (!on || pipeline.runsOn === on) &&
        (!starred || pipeline.favorite) &&
        (!outcome ||
          (outcome.value === "never"
            ? !pipeline.lastRun
            : (outcome.statuses as readonly string[]).includes(pipeline.lastRun?.status ?? ""))),
    )
    .sort((a, b) => {
      // Starred first, then the chosen order.
      if (a.favorite !== b.favorite) return Number(b.favorite) - Number(a.favorite);
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "changed") return b.updatedAt.localeCompare(a.updatedAt);
      return activity(b).localeCompare(activity(a));
    });
  const { rows, page } = pageOf(shown, filters.page);
  const count = (statuses: readonly string[], never: boolean) =>
    all.filter((pipeline) =>
      never ? !pipeline.lastRun : statuses.includes(pipeline.lastRun?.status ?? ""),
    ).length;

  return (
    <>
      <ListToolbar>
        <SearchBox
          value={q}
          onChange={(value) => filters.set({ q: value })}
          placeholder={t("Search pipelines")}
        />
        <FilterSelect
          label={t("Last run")}
          value={last}
          onChange={(value) => filters.set({ last: value })}
          options={[
            { value: "", label: t("Any last run") },
            ...OUTCOMES.map((choice) => ({
              value: choice.value,
              label: `${choice.label} (${count(choice.statuses, choice.value === "never")})`,
            })),
          ]}
        />
        {machines.length > 1 && (
          <FilterSelect
            label={t("Runs on")}
            value={on}
            onChange={(value) => filters.set({ on: value })}
            options={[
              { value: "", label: t("Any machine") },
              ...machines.map((machine) => ({
                value: machine,
                label: t("On {machine}", { machine }),
              })),
            ]}
          />
        )}
        <FilterToggle on={starred} onChange={(value) => filters.set({ starred: value ? "1" : "" })}>
          <Star size={13} className={starred ? "fill-warning text-warning" : ""} /> {t("Starred")}
        </FilterToggle>
        <FilterSelect
          label={t("Order")}
          value={sort}
          onChange={(value) => filters.set({ sort: value })}
          options={SORTS}
        />
      </ListToolbar>
      {shown.length === 0 ? (
        <NothingMatches onClear={filters.clear} />
      ) : (
        <ul className="divide-y divide-border-default rounded-md border border-border-default">
          {rows.map((pipeline) => {
            const status = pipeline.lastRun ? RUN_STATUS[pipeline.lastRun.status] : null;
            return (
              <li key={pipeline.id} className="flex items-center hover:bg-surface-hover">
                <button
                  type="button"
                  aria-label={
                    pipeline.favorite
                      ? t("Unstar {name}", { name: pipeline.name })
                      : t("Star {name}", { name: pipeline.name })
                  }
                  aria-pressed={pipeline.favorite}
                  title={
                    pipeline.favorite ? t("Starred: shown first") : t("Star it, to show it first")
                  }
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
                  to={teamHref(`/pipelines/${pipeline.id}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-3 pl-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{pipeline.name}</span>
                      {pipeline.repoPath && (
                        <GitBranch
                          size={12}
                          className="shrink-0 text-fg-muted"
                          aria-label={t("File kept in the repository at {repoPath}", {
                            repoPath: pipeline.repoPath,
                          })}
                        >
                          <title>
                            {t("Kept in the repository at {repoPath}", {
                              repoPath: pipeline.repoPath,
                            })}
                          </title>
                        </GitBranch>
                      )}
                    </p>
                    <p className="text-xs text-fg-secondary">
                      {t("runs on {runsOn}", {
                        runsOn: <span className="font-mono">{pipeline.runsOn}</span>,
                      })}
                      {pipeline.updatedBy && (
                        <> {t("· changed by {name}", { name: pipeline.updatedBy.name })}</>
                      )}{" "}
                      · {formatRelative(pipeline.updatedAt)}
                    </p>
                  </div>
                  {pipeline.lastRun && status ? (
                    <span className="flex items-center gap-2 text-xs text-fg-secondary">
                      <StageStrip stages={pipeline.lastRun.stages} />#{pipeline.lastRun.number}
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </span>
                  ) : (
                    <span className="text-xs text-fg-muted">{t("never run")}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Pager
        page={page}
        total={shown.length}
        noun="pipelines"
        all={all.length}
        onPage={(n) => filters.set({ page: String(n) })}
      />
    </>
  );
}
