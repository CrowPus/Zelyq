import { useQuery } from "@tanstack/react-query";
import {
  PIPELINE_SHELLS,
  PIPELINE_TOOLS,
  type PipelinePluginSummary,
  type PipelineRunSummary,
  parsePipelineFile,
  STEP_KINDS,
  type StepKind,
  type StepStatus,
} from "@zelyq/core";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  GitBranch,
  Hand,
  HardDrive,
  Link2,
  Package,
  Plus,
  Rocket,
  Settings2,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { type DragEvent, Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import {
  type DocPath,
  editable,
  insertIn,
  moveAcross,
  moveIn,
  readFile,
  removeIn,
  replaceStep,
  setIn,
} from "../../lib/pipeline-doc";
import { duration, RUN_STATUS } from "../../lib/pipelines";
import { formatRelative } from "../../lib/vault";
import { Button, FieldLabel, IconButton, Input, Textarea } from "../ui";
import { StatusIcon } from "./Stages";

/**
 * The pipeline file as a picture you can edit: stages left to right (those
 * that run together stacked in one column), their steps inside, and a form
 * for whatever is selected. Every change rewrites the same YAML file, so
 * comments and anything this editor does not show stay as they were.
 */

type Raw = Record<string, unknown>;
type Selection =
  | { kind: "pipeline" }
  | { kind: "stage"; stage: number }
  | { kind: "add-step"; stage: number }
  | { kind: "step"; stage: number; step: number };

const KIND_LABEL: Record<StepKind, string> = {
  run: "Commands",
  checkout: "Check out the code",
  setup: "Set up a language",
  cache: "Cache a folder",
  docker: "Build a Docker image",
  approval: "Wait for approval",
  deploy: "Deploy",
  pipeline: "Run another pipeline",
  download: "Download an artifact",
  plugin: "Plugin",
};

/** What each kind of step is for, in plain words. */
const KIND_HELP: Record<StepKind, string> = {
  run: "Runs commands, as you would in a terminal.",
  checkout: "Copies the code (the app, or the repository) into the run's folder.",
  setup: "Installs a language at a version: Node, Python, Java or Go.",
  cache: "Keeps a folder such as node_modules between runs, so installs get faster.",
  docker: "Builds a Docker image, and can push it to a registry.",
  approval: "Stops the run until someone approves or rejects it.",
  deploy: "Puts the app on an environment's machine with Docker; rolls back if it does not start.",
  pipeline: "Starts another pipeline of this team, and can wait for it.",
  download: "Takes a file another run kept, instead of building it again.",
  plugin: "A ready-made step your team installed in Pipelines → Plugins.",
};

const KIND_ICON: Record<StepKind, typeof Box> = {
  run: TerminalSquare,
  checkout: GitBranch,
  setup: Wrench,
  cache: HardDrive,
  docker: Box,
  approval: Hand,
  deploy: Rocket,
  pipeline: Link2,
  download: Download,
  plugin: Package,
};

/** What a new step of each kind starts as. */
function newStep(kind: StepKind, plugin: string | null): Raw {
  switch (kind) {
    case "run":
      return { run: 'echo "Hello"' };
    case "checkout":
      return { checkout: true };
    case "setup":
      return { setup: "node@22" };
    case "cache":
      return { cache: "node_modules" };
    case "docker":
      return { docker: { image: "registry.example.com/team/app" } };
    case "approval":
      return { approval: "Continue?" };
    case "deploy":
      return { deploy: { to: "staging", port: 3000 } };
    case "pipeline":
      return { pipeline: { run: "Other pipeline" } };
    case "download":
      return { download: { artifact: "dist" } };
    case "plugin":
      return { plugin: plugin ?? "publisher/name@1.0.0" };
  }
}

function kindOf(step: Raw): StepKind {
  return STEP_KINDS.find((kind) => step[kind] !== undefined) ?? "run";
}

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function stepLabel(step: Raw): string {
  if (typeof step.name === "string" && step.name) return step.name;
  const kind = kindOf(step);
  const value = step[kind];
  switch (kind) {
    case "run": {
      const first = text(value).trim().split("\n")[0] ?? "";
      return first.length > 48 ? `${first.slice(0, 45)}…` : first || "Commands";
    }
    case "setup":
      return `Set up ${typeof value === "string" ? value : text((value as Raw)?.tool)}`;
    case "cache":
      return `Cache ${typeof value === "string" ? value : text((value as Raw)?.path)}`;
    case "deploy":
      return `Deploy to ${text((value as Raw)?.to)}`;
    case "plugin":
      return text(value);
    case "pipeline":
      return `Run ${text((value as Raw)?.run)}`;
    case "download":
      return `Download ${text((value as Raw)?.artifact)}`;
    case "approval":
      return typeof value === "string" ? value : text((value as Raw)?.message) || "Approval";
    default:
      return KIND_LABEL[kind];
  }
}

/** Consecutive stages that run together: [[0], [1, 2], [3]]. */
function columnsOf(stages: Raw[]): number[][] {
  const columns: number[][] = [];
  stages.forEach((stage, index) => {
    const last = columns[columns.length - 1];
    if (stage.parallel === true && last) last.push(index);
    else columns.push([index]);
  });
  return columns;
}

export function VisualEditor({
  teamId,
  pipelineId,
  source,
  onChange,
  canWrite,
}: {
  teamId: string;
  /** A saved pipeline: its latest run is shown on the stages. */
  pipelineId?: string;
  source: string;
  onChange: (next: string) => void;
  canWrite: boolean;
}) {
  const [selection, setSelection] = useState<Selection>({ kind: "pipeline" });
  // On a narrow screen the form is below the picture: bring it into view on a click.
  const panel = useRef<HTMLElement>(null);
  const [picked, setPicked] = useState(0);
  useEffect(() => {
    if (picked > 0 && window.innerWidth < 1024) {
      panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [picked]);
  const select = (next: Selection) => {
    setSelection(next);
    setPicked((count) => count + 1);
  };
  const plugins = useQuery({
    queryKey: ["pipeline-plugins", teamId],
    queryFn: () => api.pipelines.plugins(teamId),
  });
  const latest = useLatestRun(teamId, pipelineId);
  const file = editable(source) ? readFile(source) : null;
  if (!file) {
    return (
      <p className="rounded-md border border-warning/40 bg-warning-subtle p-3 text-sm">
        The file is not valid YAML, so it cannot be shown as a picture. Fix it in the YAML view
        first.
      </p>
    );
  }
  const stages = (Array.isArray(file.stages) ? file.stages : []).map((stage) =>
    stage && typeof stage === "object" ? (stage as Raw) : {},
  );
  // What is wrong, shown on the stage or step it belongs to.
  const checked = parsePipelineFile(source);
  const issues = checked.ok ? [] : checked.issues;
  const problemsAt = (prefix: string) =>
    issues
      .filter((issue) => issue.path === prefix || issue.path.startsWith(`${prefix}.`))
      .map((issue) => issue.message);
  const pipelineProblems = issues
    .filter((issue) => !/^stages\.\d+/.test(issue.path))
    .map((issue) => issue.message);
  const edit = (next: string) => {
    if (canWrite) onChange(next);
  };
  const installed = plugins.data?.plugins ?? [];
  const firstPlugin = installed[0];
  const pluginRef = firstPlugin ? `${firstPlugin.pluginId}@${firstPlugin.version}` : null;
  // A plugin step is shown by the plugin's name, when it is installed.
  const pluginNames = new Map(
    installed.map((plugin) => [`${plugin.pluginId}@${plugin.version}`, plugin.name]),
  );
  const labelOf = (step: Raw) =>
    !step.name && typeof step.plugin === "string" && pluginNames.has(step.plugin)
      ? (pluginNames.get(step.plugin) as string)
      : stepLabel(step);

  // A selection that no longer exists (after a delete) falls back to the pipeline.
  const current: Selection =
    (selection.kind === "stage" || selection.kind === "add-step") && !stages[selection.stage]
      ? { kind: "pipeline" }
      : selection.kind === "step" &&
          !(stages[selection.stage]?.steps as unknown[] | undefined)?.[selection.step]
        ? { kind: "pipeline" }
        : selection;

  const addStage = (at: number, parallel = false) => {
    edit(
      insertIn(source, ["stages"], at, {
        name: `Stage ${stages.length + 1}`,
        ...(parallel ? { parallel: true } : {}),
        steps: [{ run: 'echo "Hello"' }],
      }),
    );
    setSelection({ kind: "stage", stage: at });
  };
  const addStep = (stage: number, kind: StepKind) => {
    const steps = (stages[stage]?.steps as unknown[] | undefined) ?? [];
    edit(insertIn(source, ["stages", stage, "steps"], steps.length, newStep(kind, pluginRef)));
    setSelection({ kind: "step", stage, step: steps.length });
  };

  // Dragging: a step to another place or stage, a stage before another.
  const moveStep = (from: { stage: number; step: number }, toStage: number, to: number) => {
    edit(
      moveAcross(
        source,
        ["stages", from.stage, "steps"],
        from.step,
        ["stages", toStage, "steps"],
        to,
      ),
    );
    const step = toStage === from.stage && to > from.step ? to - 1 : to;
    setSelection({ kind: "step", stage: toStage, step });
  };
  const moveStage = (from: number, before: number) => {
    const to = from < before ? before - 1 : before;
    if (to === from) return;
    edit(moveIn(source, ["stages"], from, to));
    setSelection({ kind: "stage", stage: to });
  };

  const columns = columnsOf(stages);
  const order = new Map(
    columns.flatMap((column, position) => column.map((index) => [index, position + 1] as const)),
  );
  return (
    <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
      <div className="min-w-0 rounded-md border border-border-default bg-surface-subtle p-3">
        <button
          type="button"
          onClick={() => select({ kind: "pipeline" })}
          className={`mb-3 flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-surface px-3 py-2 text-left text-sm ${
            current.kind === "pipeline"
              ? "border-primary ring-1 ring-primary"
              : pipelineProblems.length > 0
                ? "border-danger/60"
                : "border-border-default hover:border-border-strong"
          }`}
        >
          <Settings2 size={14} className="text-fg-secondary" />
          <span className="font-medium">{text(file.name) || "Pipeline"}</span>
          <span className="text-xs text-fg-secondary">
            runs on{" "}
            <span className="font-mono">
              {Array.isArray(file["runs-on"])
                ? (file["runs-on"] as unknown[]).join(", ")
                : text(file["runs-on"])}
            </span>
          </span>
          {pipelineProblems.length > 0 && (
            <Chip tone="danger">
              {pipelineProblems.length} problem{pipelineProblems.length === 1 ? "" : "s"}
            </Chip>
          )}
          <span className="ml-auto text-2xs text-fg-muted">Pipeline settings</span>
        </button>

        {latest.run && (
          <RunStrip
            run={latest.run}
            changed={latest.detail !== null && latest.detail.source !== source}
            pipelineId={pipelineId ?? ""}
          />
        )}
        <StageRow count={stages.length}>
          {columns.map((column, position) => {
            const last = column[column.length - 1] ?? 0;
            return (
              <Fragment key={column[0]}>
                {position > 0 && (
                  <Connector
                    onAdd={canWrite ? () => addStage(column[0] ?? 0) : null}
                    title="Add a stage here"
                  />
                )}
                <div className="group/column flex w-52 shrink-0 flex-col items-stretch gap-2">
                  <div
                    className={
                      column.length > 1
                        ? "grid gap-2 rounded-lg border border-dashed border-border-strong p-1.5"
                        : "grid"
                    }
                  >
                    {column.length > 1 && (
                      <span className="px-1 text-2xs text-fg-muted">
                        {column.length} at the same time
                      </span>
                    )}
                    {column.map((index) => (
                      <StageCard
                        key={index}
                        stage={stages[index] ?? {}}
                        index={index}
                        order={order.get(index) ?? index + 1}
                        selection={current}
                        onSelect={select}
                        canAdd={canWrite}
                        labelOf={labelOf}
                        problems={problemsAt(`stages.${index}`)}
                        stepProblems={(step) => problemsAt(`stages.${index}.steps.${step}`)}
                        runStatus={latest.stageStatus(stages[index] ?? {})}
                        onMoveStep={moveStep}
                        onMoveStage={moveStage}
                        stepStatus={(step) =>
                          latest.detail?.source === source
                            ? latest.stepStatus(stages[index] ?? {}, step)
                            : null
                        }
                      />
                    ))}
                  </div>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => addStage(last + 1, true)}
                      title="Add a stage that runs at the same time"
                      aria-label="Add a stage that runs at the same time"
                      className="mx-auto flex size-6 items-center justify-center rounded-full border border-dashed border-border-strong bg-surface text-fg-muted opacity-0 transition-opacity group-hover/column:opacity-100 hover:border-primary hover:text-fg focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </div>
              </Fragment>
            );
          })}
          {canWrite &&
            (stages.length === 0 ? (
              <Button size="sm" icon={<Plus size={13} />} onClick={() => addStage(0)}>
                Add the first stage
              </Button>
            ) : (
              <Connector onAdd={() => addStage(stages.length)} title="Add a stage at the end" end />
            ))}
        </StageRow>
      </div>

      <aside
        ref={panel}
        className="min-w-0 scroll-mt-4 rounded-md border border-border-default bg-surface p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
      >
        {current.kind === "pipeline" ? (
          <PipelineForm
            problems={pipelineProblems}
            file={file}
            source={source}
            edit={edit}
            canWrite={canWrite}
            teamId={teamId}
          />
        ) : current.kind === "add-step" ? (
          <StepChooser
            stageName={text(stages[current.stage]?.name)}
            onChoose={(kind) => addStep(current.stage, kind)}
            onCancel={() => setSelection({ kind: "stage", stage: current.stage })}
          />
        ) : current.kind === "stage" ? (
          <StageForm
            key={`stage-${current.stage}`}
            problems={problemsAt(`stages.${current.stage}`).filter(
              (message) =>
                !issues.some(
                  (issue) =>
                    issue.message === message &&
                    issue.path.startsWith(`stages.${current.stage}.steps.`),
                ),
            )}
            stages={stages}
            index={current.stage}
            source={source}
            edit={edit}
            canWrite={canWrite}
            teamId={teamId}
            onSelect={setSelection}
            onAddStage={(parallel) => {
              const column = columns.find((members) => members.includes(current.stage)) ?? [];
              addStage((column[column.length - 1] ?? current.stage) + 1, parallel);
            }}
          />
        ) : (
          <StepForm
            key={`step-${current.stage}-${current.step}`}
            problems={problemsAt(`stages.${current.stage}.steps.${current.step}`)}
            stages={stages}
            stage={current.stage}
            index={current.step}
            source={source}
            edit={edit}
            canWrite={canWrite}
            teamId={teamId}
            plugins={installed}
            pluginRef={pluginRef}
            onSelect={setSelection}
          />
        )}
      </aside>
    </div>
  );
}

/**
 * Picks an installed plugin by searching, so it stays quick with hundreds of
 * them: the chosen one is shown on its own, and Change opens the search.
 */
function PluginPicker({
  value,
  plugins,
  disabled,
  onChange,
}: {
  value: string;
  plugins: PipelinePluginSummary[];
  disabled: boolean;
  onChange: (ref: string) => void;
}) {
  const chosen = plugins.find((plugin) => `${plugin.pluginId}@${plugin.version}` === value);
  const [searching, setSearching] = useState(!chosen);
  const [query, setQuery] = useState("");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = plugins.filter((plugin) => {
    const haystack = `${plugin.name} ${plugin.pluginId} ${plugin.description}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  if (!searching) {
    return (
      <div className="flex min-w-0 items-start gap-2 rounded-md border border-border-default p-2">
        <Package size={14} className="mt-0.5 shrink-0 text-fg-secondary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {chosen ? chosen.name : value || "No plugin"}
          </span>
          <span className="block truncate font-mono text-2xs text-fg-muted">
            {chosen ? `${chosen.pluginId}@${chosen.version}` : "not installed"}
          </span>
        </span>
        {!disabled && (
          <Button size="sm" variant="ghost" onClick={() => setSearching(true)}>
            Change
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="grid min-w-0 gap-1.5">
      {value && !chosen && (
        <span className="text-2xs text-danger">{value} is not installed in this team.</span>
      )}
      <Input
        autoFocus
        value={query}
        disabled={disabled}
        placeholder={`Search ${plugins.length} plugin${plugins.length === 1 ? "" : "s"}`}
        onChange={(event) => setQuery(event.target.value)}
        className="text-sm"
      />
      <ul className="max-h-64 overflow-y-auto rounded-md border border-border-default">
        {found.length === 0 ? (
          <li className="px-2.5 py-2 text-xs text-fg-muted">No plugin matches.</li>
        ) : (
          found.slice(0, 100).map((plugin) => {
            const ref = `${plugin.pluginId}@${plugin.version}`;
            return (
              <li key={ref} className="border-b border-border-default last:border-b-0">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onChange(ref);
                    setSearching(false);
                    setQuery("");
                  }}
                  className={`block w-full min-w-0 px-2.5 py-1.5 text-left hover:bg-surface-hover ${
                    ref === value ? "bg-surface-hover" : ""
                  }`}
                >
                  <span className="block truncate text-sm">{plugin.name}</span>
                  <span className="block truncate font-mono text-2xs text-fg-muted">{ref}</span>
                </button>
              </li>
            );
          })
        )}
      </ul>
      {chosen && (
        <Button size="sm" variant="ghost" onClick={() => setSearching(false)}>
          Cancel
        </Button>
      )}
    </div>
  );
}

/** What a drag carries: a step (its stage and place) or a stage (its place). */
const STEP_DRAG = "application/x-zelyq-step";
const STAGE_DRAG = "application/x-zelyq-stage";

const ACTIVE = new Set(["queued", "running", "waiting"]);
/** Which ending wins when a stage ran as several (matrix copies, a template's stages). */
const WEIGHT: Record<string, number> = {
  running: 7,
  waiting: 6,
  failed: 5,
  timed_out: 5,
  cancelled: 4,
  pending: 3,
  passed: 2,
  skipped: 1,
};

/**
 * The pipeline's latest run, kept fresh while it runs, and how each stage of
 * the file went in it. A stage is found by its name: a matrix stage's copies
 * ("Node (20)") and a template's stages ("Checks › Lint") count as that stage.
 */
function useLatestRun(teamId: string, pipelineId: string | undefined) {
  const runs = useQuery({
    queryKey: ["pipeline-runs", teamId, pipelineId],
    queryFn: () => api.pipelines.runs(teamId, pipelineId ?? ""),
    enabled: Boolean(pipelineId),
    refetchInterval: 4000,
  });
  const run = runs.data?.runs[0] ?? null;
  const detail = useQuery({
    queryKey: ["pipeline-run", teamId, run?.id, run?.status],
    queryFn: () => api.pipelines.run(teamId, run?.id ?? ""),
    enabled: Boolean(run),
    refetchInterval: run && ACTIVE.has(run.status) ? 3000 : false,
  });
  const ran = (stage: Raw) => {
    const name = text(stage.name);
    return (run?.stages ?? []).filter(
      (candidate) =>
        candidate.name === name ||
        candidate.name.startsWith(`${name} (`) ||
        candidate.name.startsWith(`${name} › `),
    );
  };
  return {
    run,
    detail: detail.data?.run ?? null,
    stageStatus(stage: Raw): StepStatus | null {
      const matching = ran(stage);
      if (matching.length === 0) return null;
      return matching.reduce<StepStatus>(
        (worst, candidate) =>
          (WEIGHT[candidate.status] ?? 0) > (WEIGHT[worst] ?? 0) ? candidate.status : worst,
        "skipped",
      );
    },
    stepStatus(stage: Raw, step: number): StepStatus | null {
      if (stage.matrix !== undefined || stage.uses !== undefined) return null;
      const name = text(stage.name);
      return (
        detail.data?.run.steps.find(
          (candidate) => candidate.stage === name && candidate.stepIndex === step,
        )?.status ?? null
      );
    },
  };
}

/** The latest run, above the stages: how it went, and a way into it. */
function RunStrip({
  run,
  changed,
  pipelineId,
}: {
  run: PipelineRunSummary;
  changed: boolean;
  pipelineId: string;
}) {
  const status = RUN_STATUS[run.status];
  return (
    <div className="mb-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border-default bg-surface px-3 py-1.5 text-xs">
      <StatusIcon status={run.status} />
      <span className="font-medium">Latest run #{run.number}</span>
      <span className="text-fg-secondary">
        {status.label}
        {run.startedAt && ` · ${duration(run.startedAt, run.finishedAt)}`} ·{" "}
        {formatRelative(run.createdAt)}
      </span>
      {changed && (
        <span className="text-fg-muted">· the file has changed since, so steps are not marked</span>
      )}
      <Link
        to={`/pipelines/${pipelineId}/runs/${run.id}`}
        className="ml-auto font-medium text-fg-secondary underline-offset-2 hover:text-fg hover:underline"
      >
        Open the run
      </Link>
    </div>
  );
}

/**
 * The stages in one row, left to right as they run. When they do not all fit,
 * the row scrolls, and says so: faded edges, arrows and the number of stages,
 * so no stage is ever out of sight without a sign of it.
 */
function StageRow({ count, children }: { count: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const element = box.current;
    if (!element) return;
    // Only a hidden stage counts, not the small + at the very end.
    setEdges({
      left: element.scrollLeft > 40,
      right: element.scrollLeft + element.clientWidth < element.scrollWidth - 40,
    });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure again when stages change
  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, [count]);
  const scroll = (direction: number) =>
    box.current?.scrollBy({ left: direction * 240, behavior: "smooth" });
  const arrow =
    "flex size-6 items-center justify-center rounded-md border border-border-default bg-surface text-fg-secondary hover:text-fg disabled:opacity-30";
  return (
    // minmax(0, 1fr): the row stays as wide as its column and scrolls, never pushes past it.
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      {(edges.left || edges.right) && (
        <div className="flex items-center justify-end gap-1 text-2xs text-fg-muted">
          <span className="mr-1">{count} stages · scroll to see them all</span>
          <button
            type="button"
            aria-label="Earlier stages"
            disabled={!edges.left}
            onClick={() => scroll(-1)}
            className={arrow}
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            aria-label="Later stages"
            disabled={!edges.right}
            onClick={() => scroll(1)}
            className={arrow}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}
      <div className="relative min-w-0">
        <div ref={box} onScroll={measure} className="min-w-0 overflow-x-auto pb-2">
          <div className="flex w-max items-start pr-1">{children}</div>
        </div>
        {edges.left && (
          <span className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface-subtle to-transparent" />
        )}
        {edges.right && (
          <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface-subtle to-transparent" />
        )}
      </div>
    </div>
  );
}

/** The line between two stages, with a small + to put a stage there. */
function Connector({
  onAdd,
  title,
  end = false,
}: {
  onAdd: (() => void) | null;
  title: string;
  end?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center self-start pt-[18px]" aria-hidden={!onAdd}>
      <span className="h-px w-3 bg-border-strong" />
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          title={title}
          aria-label={title}
          className="flex size-6 items-center justify-center rounded-full border border-border-default bg-surface text-fg-secondary shadow-sm hover:border-primary hover:text-fg"
        >
          <Plus size={12} />
        </button>
      ) : (
        <span className="h-px w-6 bg-border-strong" />
      )}
      {!end && <span className="h-px w-3 bg-border-strong" />}
    </div>
  );
}

/** A small label in plain words, not shouting like a badge. */
function Chip({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "info" | "warning" | "danger";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-surface-hover text-fg-secondary",
    info: "bg-info/10 text-info",
    warning: "bg-warning-subtle text-warning",
    danger: "bg-danger-subtle text-danger",
  };
  return (
    <span
      className={`inline-flex max-w-full truncate rounded px-1.5 py-0.5 text-2xs ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

const WHEN: Record<string, string> = {
  "failure()": "Only after a failure",
  "always()": "Always runs",
};

function StageCard({
  stage,
  index,
  order,
  selection,
  onSelect,
  canAdd,
  labelOf,
  problems,
  stepProblems,
  runStatus = null,
  stepStatus = () => null,
  onMoveStep,
  onMoveStage,
}: {
  /** A step dropped here, at this place in this stage. */
  onMoveStep?: (from: { stage: number; step: number }, toStage: number, to: number) => void;
  /** A stage dropped on this one: it moves before it. */
  onMoveStage?: (from: number, before: number) => void;
  stage: Raw;
  index: number;
  /** How this stage went in the latest run, if it ran. */
  runStatus?: StepStatus | null;
  /** How each step went, when the file is still the one that ran. */
  stepStatus?: (step: number) => StepStatus | null;
  /** Its place in the run: stages at the same time share one. */
  order: number;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  canAdd: boolean;
  labelOf: (step: Raw) => string;
  /** Everything wrong in this stage, its steps included. */
  problems: string[];
  stepProblems: (step: number) => string[];
}) {
  const steps = (Array.isArray(stage.steps) ? stage.steps : []).map((step) =>
    step && typeof step === "object" ? (step as Raw) : {},
  );
  // Where a dragged step would land (a place in this stage), or a stage would.
  const [stepOver, setStepOver] = useState<number | null>(null);
  const [stageOver, setStageOver] = useState(false);
  const dropStep = (event: DragEvent, to: number) => {
    const data = event.dataTransfer.getData(STEP_DRAG);
    setStepOver(null);
    if (!data || !onMoveStep) return;
    event.preventDefault();
    onMoveStep(JSON.parse(data) as { stage: number; step: number }, index, to);
  };
  const overStep = (event: DragEvent, to: number) => {
    if (!onMoveStep || !event.dataTransfer.types.includes(STEP_DRAG)) return;
    event.preventDefault();
    event.stopPropagation();
    if (stepOver !== to) setStepOver(to);
  };
  const selected =
    (selection.kind === "stage" || selection.kind === "add-step") && selection.stage === index;
  const matrix =
    stage.matrix && typeof stage.matrix === "object"
      ? Object.values(stage.matrix as Raw).reduce<number>(
          (count, values) => count * (Array.isArray(values) ? values.length : 1),
          1,
        )
      : 0;
  return (
    // A drop target for a dragged stage; the stage's own button is what is dragged.
    // biome-ignore lint/a11y/noStaticElementInteractions: dropping is a mouse shortcut; the arrows in the stage form do the same
    <div
      onDragOver={(event) => {
        if (!onMoveStage || !event.dataTransfer.types.includes(STAGE_DRAG)) return;
        event.preventDefault();
        if (!stageOver) setStageOver(true);
      }}
      onDragLeave={() => setStageOver(false)}
      onDrop={(event) => {
        const data = event.dataTransfer.getData(STAGE_DRAG);
        setStageOver(false);
        if (data && onMoveStage) {
          event.preventDefault();
          onMoveStage(Number(data), index);
        }
      }}
      className={`min-w-0 rounded-md border bg-surface ${stageOver ? "shadow-[-3px_0_0_0_var(--info)]" : ""} ${
        selected
          ? "border-primary ring-1 ring-primary"
          : problems.length > 0
            ? "border-danger/60"
            : "border-border-default"
      }`}
    >
      <button
        type="button"
        draggable={Boolean(onMoveStage)}
        onDragStart={(event) => {
          event.dataTransfer.setData(STAGE_DRAG, String(index));
          event.dataTransfer.effectAllowed = "move";
        }}
        title={onMoveStage ? "Drag to move this stage before another" : undefined}
        onClick={() => onSelect({ kind: "stage", stage: index })}
        className="flex w-full min-w-0 flex-col gap-1 rounded-t-md border-b border-border-default px-3 py-2 text-left hover:bg-surface-hover"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-hover text-2xs text-fg-secondary">
            {order}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {text(stage.name) || "Stage"}
          </span>
          {runStatus && <StatusIcon status={runStatus} size={13} />}
        </span>
        {(stage["runs-on"] !== undefined ||
          matrix > 0 ||
          WHEN[text(stage.if)] ||
          stage.uses !== undefined ||
          problems.length > 0) && (
          <span className="flex min-w-0 flex-wrap gap-1">
            {stage["runs-on"] !== undefined && (
              <Chip>
                On{" "}
                {Array.isArray(stage["runs-on"])
                  ? (stage["runs-on"] as unknown[]).join(", ")
                  : text(stage["runs-on"])}
              </Chip>
            )}
            {matrix > 0 && <Chip tone="info">Matrix × {matrix}</Chip>}
            {WHEN[text(stage.if)] && <Chip tone="warning">{WHEN[text(stage.if)]}</Chip>}
            {stage.uses !== undefined && <Chip tone="info">Template: {text(stage.uses)}</Chip>}
            {problems.length > 0 && (
              <Chip tone="danger">
                {problems.length} problem{problems.length === 1 ? "" : "s"}
              </Chip>
            )}
          </span>
        )}
      </button>
      {stage.uses === undefined && (
        <ul className="grid gap-0.5 p-1.5">
          {steps.map((step, stepIndex) => {
            const kind = kindOf(step);
            const Icon = KIND_ICON[kind];
            const active =
              selection.kind === "step" &&
              selection.stage === index &&
              selection.step === stepIndex;
            const wrong = stepProblems(stepIndex);
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: steps have no identity but their place
                key={stepIndex}
                className={`min-w-0 rounded ${stepOver === stepIndex ? "shadow-[0_-2px_0_0_var(--info)]" : ""}`}
                draggable={Boolean(onMoveStep)}
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.setData(
                    STEP_DRAG,
                    JSON.stringify({ stage: index, step: stepIndex }),
                  );
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => overStep(event, stepIndex)}
                onDragLeave={() => setStepOver(null)}
                onDrop={(event) => dropStep(event, stepIndex)}
              >
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "step", stage: index, step: stepIndex })}
                  title={labelOf(step)}
                  className={`flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left text-xs ${
                    active
                      ? "bg-surface-hover font-medium text-fg ring-1 ring-primary"
                      : "text-fg-secondary hover:bg-surface-hover hover:text-fg"
                  }`}
                >
                  <Icon size={12} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{labelOf(step)}</span>
                  {stepStatus(stepIndex) && (
                    <StatusIcon status={stepStatus(stepIndex) as StepStatus} size={11} />
                  )}
                  {wrong.length > 0 && (
                    <span
                      role="img"
                      aria-label="Has a problem"
                      title={wrong.join("\n")}
                      className="size-1.5 shrink-0 rounded-full bg-danger"
                    />
                  )}
                </button>
              </li>
            );
          })}
          {canAdd && (
            <li
              className={`rounded ${stepOver === steps.length ? "shadow-[0_-2px_0_0_var(--info)]" : ""}`}
              onDragOver={(event) => overStep(event, steps.length)}
              onDragLeave={() => setStepOver(null)}
              onDrop={(event) => dropStep(event, steps.length)}
            >
              <button
                type="button"
                onClick={() => onSelect({ kind: "add-step", stage: index })}
                className="flex w-full items-center gap-1 rounded px-2 py-1 text-2xs text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                <Plus size={11} /> Add a step
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Choosing the kind of a new step, with what each kind is for. */
function StepChooser({
  stageName,
  onChoose,
  onCancel,
}: {
  stageName: string;
  onChoose: (kind: StepKind) => void;
  onCancel: () => void;
}) {
  return (
    <div className="grid gap-2">
      <Heading icon={<Plus size={14} />}>Add a step to {stageName || "this stage"}</Heading>
      <ul className="grid gap-1">
        {STEP_KINDS.map((kind) => {
          const Icon = KIND_ICON[kind];
          return (
            <li key={kind}>
              <button
                type="button"
                onClick={() => onChoose(kind)}
                className="grid w-full grid-cols-[16px_1fr] items-start gap-x-2 rounded-md border border-border-default px-2.5 py-2 text-left hover:border-primary hover:bg-surface-hover"
              >
                <Icon size={14} className="mt-0.5 text-fg-secondary" />
                <span>
                  <span className="block text-sm font-medium">{KIND_LABEL[kind]}</span>
                  <span className="block text-xs text-fg-secondary">{KIND_HELP[kind]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- the forms

type FormProps = {
  /** What is wrong with this pipeline, stage or step. */
  problems: string[];
  source: string;
  edit: (next: string) => void;
  canWrite: boolean;
  teamId: string;
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child
    <label className="grid gap-1">
      <FieldLabel>{label}</FieldLabel>
      {children}
      {hint && <span className="text-2xs text-fg-muted">{hint}</span>}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  mono = false,
  disabled,
  list,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled: boolean;
  list?: string;
  className?: string;
}) {
  // While typing, the field keeps its own text: "20, " would otherwise come
  // back from the file as "20" before the next value could be typed.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      value={draft ?? value}
      placeholder={placeholder}
      disabled={disabled}
      list={list}
      onFocus={() => setDraft(value)}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(event.target.value);
      }}
      className={`${mono ? "font-mono text-xs" : "text-sm"} ${className}`}
    />
  );
}

function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
  disabled: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-[30px] w-full min-w-0 truncate rounded-md border border-border-default bg-surface px-2 text-sm"
    >
      {options.map(([option, label]) => (
        <option key={option} value={option}>
          {label}
        </option>
      ))}
    </select>
  );
}

function Check({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

/** Name → value rows, written back as one map (env, with, matrix). */
function Pairs({
  value,
  onChange,
  disabled,
  keyPlaceholder,
  valuePlaceholder,
}: {
  value: Raw;
  onChange: (next: Record<string, string>) => void;
  disabled: boolean;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  const rows = Object.entries(value).map(([key, item]) => [
    key,
    Array.isArray(item) ? item.join(", ") : text(item),
  ]);
  const write = (next: string[][]) =>
    onChange(
      Object.fromEntries(next.filter(([key]) => key !== undefined).map(([k, v]) => [k, v ?? ""])),
    );
  return (
    <div className="grid gap-1">
      {rows.map(([key, item], index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a row is its place while being renamed
        <div key={index} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_1.75rem] gap-1">
          <TextInput
            mono
            value={key ?? ""}
            disabled={disabled}
            placeholder={keyPlaceholder}
            onChange={(next) =>
              write(rows.map((row, at) => (at === index ? [next, row[1] ?? ""] : row)))
            }
          />
          <TextInput
            mono
            value={item ?? ""}
            disabled={disabled}
            placeholder={valuePlaceholder}
            onChange={(next) =>
              write(rows.map((row, at) => (at === index ? [row[0] ?? "", next] : row)))
            }
          />
          {disabled ? (
            <span />
          ) : (
            <IconButton
              size="sm"
              label="Remove"
              onClick={() => write(rows.filter((_, at) => at !== index))}
            >
              <X size={12} />
            </IconButton>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          onClick={() => write([...rows, [`NAME${rows.length + 1}`, ""]])}
          className="justify-self-start text-2xs text-primary hover:underline"
        >
          + Add
        </button>
      )}
    </div>
  );
}

function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="grid gap-1 rounded-md border border-danger/30 bg-danger-subtle p-2 text-xs text-danger">
      {problems.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

function Heading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
      {icon}
      {children}
    </h3>
  );
}

/** Everything of the team's a form may choose from: runners, apps, pipelines, environments. */
function useTeamLists(teamId: string) {
  const runners = useQuery({
    queryKey: ["runners", teamId],
    queryFn: () => api.runners.list(teamId),
  });
  const apps = useQuery({ queryKey: ["projects"], queryFn: () => api.listProjects() });
  const pipelines = useQuery({
    queryKey: ["pipelines", teamId],
    queryFn: () => api.pipelines.list(teamId),
  });
  const environments = useQuery({
    queryKey: ["environments", teamId],
    queryFn: () => api.deploys.environments(teamId),
  });
  return {
    runners: runners.data?.runners ?? [],
    apps: (apps.data?.projects ?? []).filter((app) => app.teamId === teamId),
    pipelines: pipelines.data?.pipelines ?? [],
    environments: environments.data?.environments ?? [],
  };
}

/**
 * A dropdown of what exists. A value the file names that does not exist (a
 * typo, a removed runner) stays in the list, marked, so it is never lost.
 */
function Choose({
  value,
  options,
  onChange,
  disabled,
  empty,
}: {
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  disabled: boolean;
  /** The first entry, for no value at all. */
  empty?: string;
}) {
  const known = value === "" || options.some(([option]) => option === value);
  return (
    <Select
      value={value}
      disabled={disabled}
      onChange={onChange}
      options={[
        ...(empty !== undefined
          ? [["", empty] as [string, string]]
          : value === ""
            ? [["", "Choose…"] as [string, string]]
            : []),
        ...(known ? [] : [[value, `${value} (not found)`] as [string, string]]),
        ...options,
      ]}
    />
  );
}

const LABELS = "__labels";

/** Where a pipeline or stage runs: this server, one runner, or any runner with some labels. */
function RunsOn({
  value,
  onChange,
  disabled,
  runners,
  inherit,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
  runners: { name: string; os: string | null; enabled: boolean; labels: string[] }[];
  /** For a stage: the first entry, "the pipeline's machine". */
  inherit?: string;
}) {
  const labels = Array.isArray(value);
  return (
    <div className="grid gap-1.5">
      <Choose
        value={labels ? LABELS : text(value)}
        disabled={disabled}
        empty={inherit}
        options={[
          ["local", "This Zelyq server (local)"],
          ...runners.map((runner): [string, string] => [
            runner.name,
            `${runner.name}${runner.os ? ` · ${runner.os}` : ""}${runner.enabled ? "" : " (turned off)"}`,
          ]),
          [LABELS, "Any runner with these labels…"],
        ]}
        onChange={(next) => onChange(next === LABELS ? ["linux"] : next === "" ? undefined : next)}
      />
      {labels && (
        <TextInput
          mono
          value={(value as unknown[]).join(", ")}
          placeholder="linux, docker"
          disabled={disabled}
          onChange={(next) =>
            onChange(
              next
                .split(",")
                .map((label) => label.trim())
                .filter(Boolean),
            )
          }
        />
      )}
    </div>
  );
}

function PipelineForm({
  file,
  source,
  edit,
  canWrite,
  teamId,
  problems,
}: FormProps & { file: Raw }) {
  const lists = useTeamLists(teamId);
  const origin = (file.source && typeof file.source === "object" ? file.source : {}) as Raw;
  const kind = origin.repo !== undefined ? "repo" : origin.app !== undefined ? "app" : "none";
  const off = !canWrite;
  return (
    <div className="grid gap-3">
      <Heading icon={<Settings2 size={14} />}>Pipeline</Heading>
      <Problems problems={problems} />
      <Field label="Name" hint="What the pipeline is called in the list.">
        <TextInput
          value={text(file.name)}
          disabled={off}
          onChange={(v) => edit(setIn(source, ["name"], v))}
        />
      </Field>
      <Field label="Runs on" hint="Runners are added in Pipelines → Runners.">
        <RunsOn
          value={file["runs-on"]}
          runners={lists.runners}
          disabled={off}
          onChange={(next) => edit(setIn(source, ["runs-on"], next ?? "local"))}
        />
      </Field>
      <Field label="Where the code comes from" hint="What a Check out step fetches.">
        <Select
          value={kind}
          disabled={off}
          options={[
            ["none", "Nothing (no checkout)"],
            ["app", "An app built in Zelyq"],
            ["repo", "A git repository"],
          ]}
          onChange={(next) =>
            edit(
              setIn(
                source,
                ["source"],
                next === "app"
                  ? { app: text(origin.app) || lists.apps[0]?.name || "My app" }
                  : next === "repo"
                    ? { repo: text(origin.repo) || "https://github.com/you/app" }
                    : undefined,
              ),
            )
          }
        />
      </Field>
      {kind === "app" && (
        <Field label="App">
          <Choose
            value={text(origin.app)}
            disabled={off}
            options={lists.apps.map((app): [string, string] => [app.name, app.name])}
            onChange={(v) => edit(setIn(source, ["source", "app"], v))}
          />
        </Field>
      )}
      {kind === "repo" && (
        <>
          <Field label="Repository (https)">
            <TextInput
              mono
              value={text(origin.repo)}
              disabled={off}
              onChange={(v) => edit(setIn(source, ["source", "repo"], v))}
            />
          </Field>
          <Field label="Branch, tag or commit" hint="Empty: the default branch">
            <TextInput
              mono
              value={text(origin.ref)}
              disabled={off}
              onChange={(v) => edit(setIn(source, ["source", "ref"], v))}
            />
          </Field>
          <Field label="Token" hint="For a private repository: vault://GITHUB_TOKEN">
            <TextInput
              mono
              placeholder="vault://GITHUB_TOKEN"
              value={text(origin.token)}
              disabled={off}
              onChange={(v) => edit(setIn(source, ["source", "token"], v))}
            />
          </Field>
          <Check
            checked={origin["report-status"] === true}
            disabled={off}
            label="Show ✓ / ✗ on the commit and the pull request"
            onChange={(on) => edit(setIn(source, ["source", "report-status"], on || undefined))}
          />
        </>
      )}
      <Field label="Timeout for the whole run" hint="Such as 30m or 2h; empty: 1h">
        <TextInput
          mono
          value={text(file.timeout)}
          disabled={off}
          onChange={(v) => edit(setIn(source, ["timeout"], v))}
        />
      </Field>
      <Field label="Variables for every step" hint="A value may be vault://NAME">
        <Pairs
          value={(file.env as Raw) ?? {}}
          disabled={off}
          keyPlaceholder="NAME"
          valuePlaceholder="value or vault://NAME"
          onChange={(next) => edit(setIn(source, ["env"], next))}
        />
      </Field>
      <p className="text-2xs text-fg-muted">
        Inputs, services, artifacts, notifications and the rest: switch to YAML.
      </p>
    </div>
  );
}

function StageForm({
  stages,
  index,
  problems,
  source,
  edit,
  canWrite,
  teamId,
  onSelect,
  onAddStage,
}: FormProps & {
  stages: Raw[];
  index: number;
  onSelect: (selection: Selection) => void;
  /** Adds a stage after this one (or its group), or beside it. */
  onAddStage: (parallel: boolean) => void;
}) {
  const lists = useTeamLists(teamId);
  const stage = stages[index] ?? {};
  const at = ["stages", index];
  const off = !canWrite;
  const matrix = (stage.matrix && typeof stage.matrix === "object" ? stage.matrix : {}) as Raw;
  return (
    <div className="grid gap-3">
      <Heading icon={<CheckCircle2 size={14} />}>Stage</Heading>
      <Problems problems={problems} />
      <Field label="Name" hint="Shown on the stage's box in every run.">
        <TextInput
          value={text(stage.name)}
          disabled={off}
          onChange={(v) => edit(setIn(source, [...at, "name"], v))}
        />
      </Field>
      <Field
        label="Runs"
        hint="A stage that runs only on failure is how you send an alert or clean up."
      >
        <Select
          value={text(stage.if) || "success()"}
          disabled={off}
          options={[
            ["success()", "When everything before it passed"],
            ["failure()", "Only when something before it failed"],
            ["always()", "Always"],
          ]}
          onChange={(v) => edit(setIn(source, [...at, "if"], v === "success()" ? undefined : v))}
        />
      </Field>
      <Check
        checked={stage.parallel === true}
        disabled={off || index === 0}
        label="At the same time as the stage before it"
        onChange={(on) => edit(setIn(source, [...at, "parallel"], on || undefined))}
      />
      <Field
        label="Its own machine"
        hint="A stage on a machine of its own starts in an empty folder: check out again there."
      >
        <RunsOn
          value={stage["runs-on"]}
          runners={lists.runners}
          inherit="The pipeline's machine"
          disabled={off}
          onChange={(next) => edit(setIn(source, [...at, "runs-on"], next))}
        />
      </Field>
      {stage.uses !== undefined ? (
        <>
          <Field
            label="Uses the stages of"
            hint="Another pipeline of this team, copied in when a run starts"
          >
            <Choose
              value={text(stage.uses)}
              disabled={off}
              options={lists.pipelines.map((pipeline): [string, string] => [
                pipeline.name,
                pipeline.name,
              ])}
              onChange={(v) => edit(setIn(source, [...at, "uses"], v))}
            />
          </Field>
          <Field label="Its inputs">
            <Pairs
              value={(stage.with as Raw) ?? {}}
              disabled={off}
              keyPlaceholder="input"
              valuePlaceholder="value"
              onChange={(next) => edit(setIn(source, [...at, "with"], next))}
            />
          </Field>
        </>
      ) : (
        <Field
          label="Matrix"
          hint="One copy of the stage per combination, at the same time: node → 20, 22. Use ${{ matrix.node }} in its steps."
        >
          <Pairs
            value={matrix}
            disabled={off}
            keyPlaceholder="node"
            valuePlaceholder="20, 22"
            onChange={(next) =>
              edit(
                setIn(
                  source,
                  [...at, "matrix"],
                  Object.fromEntries(
                    Object.entries(next).map(([name, values]) => [
                      name,
                      values
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    ]),
                  ),
                ),
              )
            }
          />
        </Field>
      )}
      {canWrite && (
        <div className="grid gap-1.5">
          <Button size="sm" icon={<Plus size={12} />} onClick={() => onAddStage(false)}>
            Add a stage after this one
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={12} />}
            onClick={() => onAddStage(true)}
          >
            Add a stage at the same time as this one
          </Button>
        </div>
      )}
      {canWrite && (
        <div className="flex flex-wrap gap-1 border-t border-border-default pt-3">
          <IconButton
            size="sm"
            label="Move left"
            disabled={index === 0}
            onClick={() => {
              edit(moveIn(source, ["stages"], index, index - 1));
              onSelect({ kind: "stage", stage: index - 1 });
            }}
          >
            <ArrowLeft size={13} />
          </IconButton>
          <IconButton
            size="sm"
            label="Move right"
            disabled={index >= stages.length - 1}
            onClick={() => {
              edit(moveIn(source, ["stages"], index, index + 1));
              onSelect({ kind: "stage", stage: index + 1 });
            }}
          >
            <ArrowRight size={13} />
          </IconButton>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 size={12} />}
            className="ml-auto"
            disabled={stages.length <= 1}
            onClick={() => {
              edit(removeIn(source, at));
              onSelect({ kind: "pipeline" });
            }}
          >
            Delete stage
          </Button>
        </div>
      )}
    </div>
  );
}

function StepForm({
  stages,
  stage,
  index,
  problems,
  source,
  edit,
  canWrite,
  teamId,
  plugins,
  pluginRef,
  onSelect,
}: FormProps & {
  stages: Raw[];
  stage: number;
  index: number;
  plugins: PipelinePluginSummary[];
  pluginRef: string | null;
  onSelect: (selection: Selection) => void;
}) {
  const lists = useTeamLists(teamId);
  const steps = (stages[stage]?.steps as Raw[] | undefined) ?? [];
  const step = (steps[index] ?? {}) as Raw;
  const kind = kindOf(step);
  const at = ["stages", stage, "steps", index];
  const off = !canWrite;
  const set = (path: DocPath, value: unknown) => edit(setIn(source, [...at, ...path], value));
  const value = step[kind];
  const object = (value && typeof value === "object" ? value : {}) as Raw;

  let fields: ReactNode = null;
  switch (kind) {
    case "run":
      fields = (
        <>
          <Field label="Commands" hint="One per line; the step stops at the first that fails.">
            <Textarea
              value={text(value)}
              disabled={off}
              spellCheck={false}
              rows={Math.min(14, Math.max(4, text(value).split("\n").length + 1))}
              onChange={(event) => set(["run"], event.target.value || " ")}
              wrap="off"
              className="overflow-x-auto font-mono text-xs leading-5 whitespace-pre"
            />
          </Field>
          <Field label="Shell" hint="The program that runs the commands.">
            <Select
              value={text(step.shell)}
              disabled={off}
              options={[
                ["", "Default (bash; pwsh on Windows)"],
                ...PIPELINE_SHELLS.map((shell): [string, string] => [shell, shell]),
              ]}
              onChange={(v) => set(["shell"], v || undefined)}
            />
          </Field>
        </>
      );
      break;
    case "setup": {
      const [tool, version] =
        typeof value === "string" ? value.split("@") : [text(object.tool), text(object.version)];
      const write = (nextTool: string, nextVersion: string) =>
        set(["setup"], nextVersion ? `${nextTool}@${nextVersion}` : nextTool);
      fields = (
        <>
          <Field label="Language" hint="Installed for this and every later step.">
            <Select
              value={tool || "node"}
              disabled={off}
              options={PIPELINE_TOOLS.map((name): [string, string] => [name, name])}
              onChange={(v) => write(v, version ?? "")}
            />
          </Field>
          <Field label="Version" hint="Such as 22 or lts; empty: the project's own file (.nvmrc…)">
            <TextInput
              mono
              value={version ?? ""}
              disabled={off}
              onChange={(v) => write(tool || "node", v)}
            />
          </Field>
        </>
      );
      break;
    }
    case "cache": {
      const path = typeof value === "string" ? value : text(object.path);
      fields = (
        <Field
          label="Folder to keep between runs"
          hint="Saved when the run passes, put back next time: installs get faster."
        >
          <TextInput
            mono
            value={path}
            disabled={off}
            onChange={(v) => set(["cache"], typeof value === "string" ? v : { ...object, path: v })}
          />
        </Field>
      );
      break;
    }
    case "docker":
      fields = (
        <>
          <Field label="Image (without a tag)" hint="Needs a runner with Docker.">
            <TextInput
              mono
              value={text(object.image)}
              disabled={off}
              onChange={(v) => set(["docker", "image"], v)}
            />
          </Field>
          <Field label="Tags" hint="Comma-separated; empty: latest">
            <TextInput
              mono
              value={Array.isArray(object.tags) ? object.tags.join(", ") : ""}
              disabled={off}
              onChange={(v) =>
                set(
                  ["docker", "tags"],
                  v
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                )
              }
            />
          </Field>
          <Check
            checked={object.push === true}
            disabled={off}
            label="Push to the registry"
            onChange={(on) => set(["docker", "push"], on || undefined)}
          />
          <p className="text-2xs text-fg-muted">A registry login is set in YAML.</p>
        </>
      );
      break;
    case "deploy":
      fields = (
        <>
          <Field label="Environment" hint="Environments are added in Deployments.">
            <Choose
              value={text(object.to)}
              disabled={off}
              options={lists.environments.map((environment): [string, string] => [
                environment.name,
                `${environment.name}${environment.protected ? " (protected)" : ""}${environment.frozen ? " (frozen)" : ""}`,
              ])}
              onChange={(v) => set(["deploy", "to"], v)}
            />
          </Field>
          <Field label="Port inside the container" hint="The port the app listens on.">
            <TextInput
              mono
              value={text(object.port)}
              disabled={off}
              onChange={(v) => set(["deploy", "port"], v ? Number(v) || v : undefined)}
            />
          </Field>
          <Field label="Port on the machine" hint="Empty: the same">
            <TextInput
              mono
              value={text(object["host-port"])}
              disabled={off}
              onChange={(v) => set(["deploy", "host-port"], v ? Number(v) || v : undefined)}
            />
          </Field>
          <Field label="Health check path" hint="Empty: /">
            <TextInput
              mono
              value={text(object.health)}
              disabled={off}
              onChange={(v) => set(["deploy", "health"], v)}
            />
          </Field>
          <Field label="Public address" hint="Where people reach it, if not the machine's">
            <TextInput
              mono
              value={text(object.url)}
              disabled={off}
              onChange={(v) => set(["deploy", "url"], v)}
            />
          </Field>
        </>
      );
      break;
    case "approval": {
      const message = typeof value === "string" ? value : text(object.message);
      const approvers = typeof value === "string" ? "" : text(object.approvers);
      const write = (nextMessage: string, nextApprovers: string) =>
        set(
          ["approval"],
          nextApprovers
            ? { ...object, message: nextMessage, approvers: nextApprovers }
            : nextMessage || "Continue?",
        );
      fields = (
        <>
          <Field label="Question" hint="The run waits here until someone answers.">
            <TextInput value={message} disabled={off} onChange={(v) => write(v, approvers)} />
          </Field>
          <Field label="Who may answer">
            <Select
              value={approvers}
              disabled={off}
              options={[
                ["", "Admins and owners"],
                ["editors", "Editors, admins and owners"],
              ]}
              onChange={(v) => write(message, v)}
            />
          </Field>
        </>
      );
      break;
    }
    case "pipeline":
      fields = (
        <>
          <Field label="Pipeline to run">
            <Choose
              value={text(object.run)}
              disabled={off}
              options={lists.pipelines.map((pipeline): [string, string] => [
                pipeline.name,
                pipeline.name,
              ])}
              onChange={(v) => set(["pipeline", "run"], v)}
            />
          </Field>
          <Check
            checked={object.wait !== false}
            disabled={off}
            label="Wait for it, and pass or fail with it"
            onChange={(on) => set(["pipeline", "wait"], on ? undefined : false)}
          />
          <Field label="Its inputs">
            <Pairs
              value={(object.with as Raw) ?? {}}
              disabled={off}
              keyPlaceholder="input"
              valuePlaceholder="value"
              onChange={(next) => set(["pipeline", "with"], next)}
            />
          </Field>
        </>
      );
      break;
    case "download":
      fields = (
        <>
          <Field label="Artifact" hint="A file or folder another run kept.">
            <TextInput
              mono
              value={text(object.artifact)}
              disabled={off}
              onChange={(v) => set(["download", "artifact"], v)}
            />
          </Field>
          <Field label="From" hint="Empty: the run that started this one; or a pipeline's name">
            <TextInput
              value={text(object.from)}
              disabled={off}
              onChange={(v) => set(["download", "from"], v)}
            />
          </Field>
          <Field label="Unpack into" hint="Empty: the step's folder">
            <TextInput
              mono
              value={text(object.path)}
              disabled={off}
              onChange={(v) => set(["download", "path"], v)}
            />
          </Field>
        </>
      );
      break;
    case "plugin": {
      const ref = text(value);
      const installed = plugins.find((plugin) => `${plugin.pluginId}@${plugin.version}` === ref);
      const given = (step.with && typeof step.with === "object" ? step.with : {}) as Raw;
      fields = (
        <>
          <Field
            label="Plugin"
            hint={plugins.length === 0 ? "No plugins installed: Pipelines → Plugins." : undefined}
          >
            <PluginPicker
              value={ref}
              plugins={plugins}
              disabled={off}
              onChange={(next) => set(["plugin"], next)}
            />
          </Field>
          {installed?.inputs.map((input) => (
            <Field
              key={input.name}
              label={`${input.name}${input.required ? " *" : ""}`}
              hint={
                [input.description, input.secret ? "A secret: vault://NAME" : null]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
            >
              <TextInput
                mono
                value={text(given[input.name])}
                placeholder={input.secret ? "vault://NAME" : (input.default ?? "")}
                disabled={off}
                onChange={(v) => set(["with", input.name], v)}
              />
            </Field>
          ))}
        </>
      );
      break;
    }
    default:
      fields = (
        <p className="text-xs text-fg-secondary">Fetches the source into the run's folder.</p>
      );
  }

  return (
    <div className="grid gap-3">
      <Heading
        icon={(() => {
          const Icon = KIND_ICON[kind];
          return <Icon size={14} />;
        })()}
      >
        Step
      </Heading>
      <Problems problems={problems} />
      <Field label="Kind" hint={KIND_HELP[kind]}>
        <Select
          value={kind}
          disabled={off}
          options={STEP_KINDS.map((option): [string, string] => [option, KIND_LABEL[option]])}
          onChange={(next) =>
            edit(replaceStep(source, at, STEP_KINDS, newStep(next as StepKind, pluginRef)))
          }
        />
      </Field>
      <Field label="Name" hint="Empty: worked out from what it does">
        <TextInput value={text(step.name)} disabled={off} onChange={(v) => set(["name"], v)} />
      </Field>
      {fields}
      <details className="rounded-md border border-border-default p-2">
        <summary className="cursor-pointer text-xs font-medium">More</summary>
        <div className="mt-2 grid gap-3">
          <Field label="Id" hint="To read its outputs: ${{ steps.ID.outputs.NAME }}">
            <TextInput mono value={text(step.id)} disabled={off} onChange={(v) => set(["id"], v)} />
          </Field>
          <Field label="Runs">
            <Select
              value={text(step.if)}
              disabled={off}
              options={[
                ["", "Like its stage"],
                ["success()", "When everything before it passed"],
                ["failure()", "Only when something before it failed"],
                ["always()", "Always"],
              ]}
              onChange={(v) => set(["if"], v || undefined)}
            />
          </Field>
          <Field label="Timeout" hint="Such as 10m">
            <TextInput
              mono
              value={text(step.timeout)}
              disabled={off}
              onChange={(v) => set(["timeout"], v)}
            />
          </Field>
          <Field label="Folder" hint="A subfolder of the project to run in">
            <TextInput
              mono
              value={text(step["working-directory"])}
              disabled={off}
              onChange={(v) => set(["working-directory"], v)}
            />
          </Field>
          <Check
            checked={step["continue-on-error"] === true}
            disabled={off}
            label="If it fails, carry on as if it passed"
            onChange={(on) => set(["continue-on-error"], on || undefined)}
          />
          <Field label="Variables" hint="A value may be vault://NAME">
            <Pairs
              value={(step.env as Raw) ?? {}}
              disabled={off}
              keyPlaceholder="NAME"
              valuePlaceholder="value or vault://NAME"
              onChange={(next) => set(["env"], next)}
            />
          </Field>
        </div>
      </details>
      {canWrite && (
        <div className="flex flex-wrap gap-1 border-t border-border-default pt-3">
          <IconButton
            size="sm"
            label="Move up"
            disabled={index === 0}
            onClick={() => {
              edit(moveIn(source, ["stages", stage, "steps"], index, index - 1));
              onSelect({ kind: "step", stage, step: index - 1 });
            }}
          >
            <ArrowUp size={13} />
          </IconButton>
          <IconButton
            size="sm"
            label="Move down"
            disabled={index >= steps.length - 1}
            onClick={() => {
              edit(moveIn(source, ["stages", stage, "steps"], index, index + 1));
              onSelect({ kind: "step", stage, step: index + 1 });
            }}
          >
            <ArrowDown size={13} />
          </IconButton>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 size={12} />}
            className="ml-auto"
            disabled={steps.length <= 1}
            onClick={() => {
              edit(removeIn(source, at));
              onSelect({ kind: "stage", stage });
            }}
          >
            Delete step
          </Button>
        </div>
      )}
    </div>
  );
}
