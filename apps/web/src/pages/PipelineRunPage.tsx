import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type RunApproval,
  type RunLogLine,
  type RunStep,
  summariseStages,
  type TestSummary,
} from "@zelyq/core";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileDown,
  GitBranch,
  Hand,
  RotateCw,
  Search,
  Server,
  Square,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { StageGraph, StatusIcon } from "../components/pipelines/Stages";
import { Badge, Button, EmptyState, Input, Spinner } from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { api } from "../lib/api";
import { duration, formatBytes, RUN_STATUS, TRIGGER_WORDS } from "../lib/pipelines";
import { formatRelative, vaultErrorMessage } from "../lib/vault";

/** Colour codes some tools print even when asked not to. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

/**
 * One run, the way CI tools show it: the stages as boxes joined by arrows,
 * and under the chosen stage its steps, each opening onto its own log.
 *
 * The log is read in pages after the last line seen, so a long run never
 * sends its whole log twice.
 */
export function PipelineRunPage() {
  const { id = "", runId = "" } = useParams();
  const { team } = useActiveTeam();
  const teamId = team?.id ?? "";
  const navigate = useNavigate();
  const [lines, setLines] = useState<RunLogLine[]>([]);
  const [done, setDone] = useState(false);
  const lastSeq = useRef(0);

  const run = useQuery({
    queryKey: ["pipeline-run", teamId, runId],
    queryFn: () => api.pipelines.run(teamId, runId),
    enabled: Boolean(team),
    refetchInterval: (query) =>
      ["queued", "running", "waiting"].includes(query.state.data?.run.status ?? "queued")
        ? 1500
        : false,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another run is opened
  useEffect(() => {
    setLines([]);
    setDone(false);
    lastSeq.current = 0;
  }, [runId]);

  useEffect(() => {
    if (!team || done) return;
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        try {
          const page = await api.pipelines.logs(teamId, runId, lastSeq.current);
          if (page.lines.length > 0) {
            lastSeq.current = page.lines[page.lines.length - 1]?.seq ?? lastSeq.current;
            setLines((current) => [...current, ...page.lines]);
          }
          if (page.done) {
            setDone(true);
            return;
          }
          if (page.lines.length >= 2000) continue;
        } catch {
          // A blip in the connection: try again shortly.
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [team, teamId, runId, done]);

  const cancel = useMutation({ mutationFn: () => api.pipelines.cancel(teamId, runId) });
  const rerun = useMutation({
    mutationFn: (stage: number | null) => api.pipelines.rerun(teamId, runId, stage),
    onSuccess: ({ run: next }) => navigate(`/pipelines/${id}/runs/${next.id}`),
  });

  const detail = run.data?.run;
  const steps = useMemo(() => detail?.steps ?? [], [detail]);
  const stages = useMemo(() => summariseStages(steps), [steps]);
  const byStep = useMemo(() => {
    const map = new Map<string, RunLogLine[]>();
    for (const line of lines) {
      if (!line.stepId) continue;
      map.set(line.stepId, [...(map.get(line.stepId) ?? []), line]);
    }
    return map;
  }, [lines]);
  const runLines = useMemo(() => lines.filter((line) => !line.stepId), [lines]);

  // The stage on show follows the run (running, else failed, else the last
  // that ran) until someone clicks one.
  const [picked, setPicked] = useState<number | null>(null);
  const automatic =
    stages.find((stage) => stage.status === "running")?.index ??
    stages.find((stage) => ["failed", "timed_out", "cancelled"].includes(stage.status))?.index ??
    [...stages].reverse().find((stage) => stage.status !== "skipped" && stage.status !== "pending")
      ?.index ??
    stages[0]?.index ??
    null;
  const selected = picked ?? automatic;
  const [query, setQuery] = useState("");
  // Where the run went wrong: the first failed step, shown at the top and scrolled to.
  const failure = steps.find((step) => step.status === "failed" || step.status === "timed_out");
  const [focus, setFocus] = useState(0);

  if (run.isLoading || !detail) {
    return (
      <AppShell crumbs={[{ label: "Pipelines", to: "/pipelines" }, { label: "Run" }]}>
        {run.isLoading ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : (
          <EmptyState
            title="Not found"
            description="This run is not in the team you have chosen."
          />
        )}
      </AppShell>
    );
  }

  const status = RUN_STATUS[detail.status];
  const active = ["queued", "running", "waiting"].includes(detail.status);
  const stageSteps = steps.filter((step) => step.stageIndex === selected);
  const firstStepSeq = lines.find((line) => line.stepId)?.seq ?? Number.POSITIVE_INFINITY;
  const setupLines = runLines.filter((line) => line.seq < firstStepSeq);
  const finishLines = runLines.filter((line) => line.seq > firstStepSeq);

  return (
    <AppShell
      crumbs={[
        { label: "Pipelines", to: "/pipelines" },
        { label: detail.pipelineName, to: `/pipelines/${id}` },
        { label: `#${detail.number}` },
      ]}
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6">
          <header className="mb-4 flex flex-wrap items-start gap-3">
            <span className="mt-1">
              <StatusIcon status={detail.status} size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold">
                {detail.pipelineName}{" "}
                <span className="font-mono font-normal text-fg-secondary">#{detail.number}</span>
              </h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-secondary">
                <Badge tone={status.tone}>{status.label}</Badge>
                <span className="flex items-center gap-1">
                  {detail.triggeredBy ? <UserRound size={12} /> : <GitBranch size={12} />}
                  {detail.triggeredBy ? detail.triggeredBy.name : TRIGGER_WORDS[detail.trigger]}
                </span>
                {detail.upstream && (
                  <Link
                    to={`/pipelines/${detail.upstream.pipelineId}/runs/${detail.upstream.id}`}
                    className="text-info hover:underline"
                  >
                    started by {detail.upstream.pipelineName} #{detail.upstream.number}
                  </Link>
                )}
                {Object.entries(detail.inputs).map(([name, value]) => (
                  <span key={name} className="rounded bg-surface-subtle px-1.5 font-mono">
                    {name}={value}
                  </span>
                ))}
                {detail.runner && (
                  <span className="flex items-center gap-1">
                    <Server size={12} /> {detail.runner}
                  </span>
                )}
                <span>{formatRelative(detail.createdAt)}</span>
                {detail.startedAt && (
                  <span>took {duration(detail.startedAt, detail.finishedAt)}</span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/api/teams/${teamId}/pipeline-runs/${runId}/log.txt`}>
                <Button icon={<FileDown size={13} />}>Download log</Button>
              </a>
              {active ? (
                <Button
                  variant="danger"
                  icon={<Square size={13} />}
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate()}
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="primary"
                  icon={<RotateCw size={13} />}
                  disabled={rerun.isPending}
                  onClick={() => rerun.mutate(null)}
                >
                  Run again
                </Button>
              )}
            </div>
          </header>

          {detail.error && (
            <p className="mb-3 rounded-md border border-danger/30 bg-danger-subtle p-2 text-xs text-danger">
              {detail.error}
            </p>
          )}
          {(cancel.error || rerun.error) && (
            <p className="mb-3 text-xs text-danger">
              {vaultErrorMessage(cancel.error ?? rerun.error)}
            </p>
          )}

          {detail.approvals
            .filter((approval) => !approval.decision && detail.status === "waiting")
            .map((approval) => (
              <ApprovalBox
                key={approval.id}
                teamId={teamId}
                runId={runId}
                approval={approval}
                onAnswered={() => void run.refetch()}
              />
            ))}

          {failure && (
            <button
              type="button"
              onClick={() => {
                setPicked(failure.stageIndex);
                setFocus((count) => count + 1);
              }}
              className="mb-3 flex w-full items-center gap-2 rounded-md border border-danger/40 bg-danger-subtle px-3 py-2 text-left text-sm hover:border-danger"
            >
              <StatusIcon status={failure.status} />
              <span className="min-w-0 flex-1 truncate">
                {failure.status === "timed_out" ? "Timed out at " : "Failed at "}
                <span className="font-medium">
                  {failure.stage} › {failure.name}
                </span>
                {failure.exitCode !== null && failure.exitCode !== 0 && (
                  <span className="font-mono text-xs text-danger"> exit {failure.exitCode}</span>
                )}
              </span>
              <span className="text-xs text-fg-secondary">Show the error</span>
            </button>
          )}

          {/* A run that could not start (no file at that commit) has no steps to show. */}
          {stages.length > 0 && (
            <section className="mb-4 rounded-md border border-border-default bg-surface-subtle p-3">
              <StageGraph
                stages={stages}
                groups={detail?.stageGroups}
                selected={selected}
                onSelect={setPicked}
              />
            </section>
          )}

          {detail.artifacts.length > 0 && (
            <section className="mb-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">Artifacts</span>
              {detail.artifacts.map((artifact) => (
                <a
                  key={artifact.id}
                  href={api.pipelines.artifactUrl(teamId, artifact.id)}
                  className="flex items-center gap-1 rounded border border-border-default px-2 py-1 hover:bg-surface-hover"
                >
                  <Download size={12} /> {artifact.name}
                  <span className="text-fg-muted">{formatBytes(artifact.sizeBytes)}</span>
                </a>
              ))}
            </section>
          )}

          <RunTests steps={steps} onShow={(stageIndex) => setPicked(stageIndex)} />

          {stages.length > 0 && (
            <section className="rounded-md border border-border-default">
              <div className="flex flex-wrap items-center gap-2 border-b border-border-default px-3 py-2">
                <h2 className="flex-1 text-sm font-semibold">
                  {stages.find((stage) => stage.index === selected)?.name ?? "Steps"}
                </h2>
                {!active && selected !== null && selected > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RotateCw size={12} />}
                    onClick={() => rerun.mutate(selected)}
                  >
                    Run again from this stage
                  </Button>
                )}
                <div className="relative w-56">
                  <Search
                    size={12}
                    className="pointer-events-none absolute top-2 left-2 text-fg-muted"
                  />
                  <Input
                    aria-label="Search the log"
                    placeholder="Search the log"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="h-7 pl-6 text-xs"
                  />
                </div>
              </div>

              {selected === stages[0]?.index && setupLines.length > 0 && (
                <LogSection title="Set up" lines={setupLines} query={query} defaultOpen={false} />
              )}
              {stageSteps.map((step) => (
                <StepSection
                  key={step.id}
                  step={step}
                  lines={byStep.get(step.id) ?? []}
                  query={query}
                  focus={step.id === failure?.id && !active ? focus + 1 : 0}
                />
              ))}
              {selected === stages[stages.length - 1]?.index && finishLines.length > 0 && (
                <LogSection title="Finish" lines={finishLines} query={query} defaultOpen={false} />
              )}
            </section>
          )}

          <p className="mt-3">
            <Link to={`/pipelines/${id}`} className="text-xs text-fg-secondary hover:underline">
              All runs of {detail.pipelineName}
            </Link>
          </p>
        </div>
      </div>
    </AppShell>
  );
}

/** A step: a row that opens onto its own log. Running and failed steps open by themselves. */
function StepSection({
  step,
  lines,
  query,
  focus = 0,
}: {
  step: RunStep;
  lines: RunLogLine[];
  query: string;
  /** Above 0: this is where the run failed; scroll to it (again, each time it grows). */
  focus?: number;
}) {
  const failed = step.status === "failed" || step.status === "timed_out";
  const wantsOpen = step.status === "running" || failed;
  const [toggled, setToggled] = useState<boolean | null>(null);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus > 0) {
      setToggled(true);
      row.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [focus]);
  const matches = query ? lines.some((line) => matchLine(line, query)) : false;
  const open = toggled ?? (wantsOpen || matches);
  const canOpen = step.status !== "skipped" && step.status !== "pending";

  return (
    <div ref={row} className="scroll-mt-4 border-b border-border-default last:border-b-0">
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => setToggled(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent"
      >
        {canOpen ? (
          open ? (
            <ChevronDown size={14} className="text-fg-muted" />
          ) : (
            <ChevronRight size={14} className="text-fg-muted" />
          )
        ) : (
          <span className="w-3.5" />
        )}
        <StatusIcon status={step.status} />
        <span
          className={`min-w-0 flex-1 truncate ${step.status === "skipped" ? "text-fg-muted" : ""}`}
        >
          {step.name}
        </span>
        {step.attempt > 1 && (
          <span className="text-2xs text-fg-muted" title="It was tried again after failing">
            attempt {step.attempt}
          </span>
        )}
        {step.exitCode !== null && step.exitCode !== 0 && (
          <span className="font-mono text-2xs text-danger">exit {step.exitCode}</span>
        )}
        {step.tests && (
          <span className="text-2xs">
            <span className="text-success">{step.tests.passed} passed</span>
            {step.tests.failed > 0 && (
              <span className="text-danger"> · {step.tests.failed} failed</span>
            )}
            {step.tests.skipped > 0 && (
              <span className="text-fg-muted"> · {step.tests.skipped} skipped</span>
            )}
          </span>
        )}
        <span className="text-xs text-fg-muted">
          {step.status === "skipped" ? "skipped" : duration(step.startedAt, step.finishedAt)}
        </span>
      </button>
      {open && Object.keys(step.outputs).length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 px-10 pb-2 text-xs">
          {Object.entries(step.outputs).map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="font-mono text-fg-muted">{name}</dt>
              <dd className="min-w-0 truncate font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {open && step.tests && step.tests.failures.length > 0 && <TestFailures tests={step.tests} />}
      {step.child && (
        <Link
          to={`/pipelines/${step.child.pipelineId}/runs/${step.child.id}`}
          className="block px-10 pb-2 text-xs text-info hover:underline"
        >
          → the run it started: #{step.child.number}
        </Link>
      )}
      {open && canOpen && (
        // A failed step's log opens at its end, where the error is.
        <LogLines lines={lines} query={query} follow={step.status === "running" || failed} />
      )}
    </div>
  );
}

/** The failing tests of a step's report, each opening onto what it said. */
/**
 * Every test report of the run in one place: the totals, and each failed
 * test with the step it came from. Opens by itself when something failed.
 */
function RunTests({ steps, onShow }: { steps: RunStep[]; onShow: (stageIndex: number) => void }) {
  const reported = steps.filter((step) => step.tests);
  if (reported.length === 0) return null;
  const total = (key: "passed" | "failed" | "skipped") =>
    reported.reduce((sum, step) => sum + (step.tests?.[key] ?? 0), 0);
  const failed = total("failed");
  return (
    <details open={failed > 0} className="mb-4 rounded-md border border-border-default text-xs">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
        <span className="font-semibold">Tests</span>
        <span className="text-success">{total("passed")} passed</span>
        {failed > 0 && <span className="text-danger">· {failed} failed</span>}
        {total("skipped") > 0 && (
          <span className="text-fg-muted">· {total("skipped")} skipped</span>
        )}
        <span className="text-fg-muted">
          · from {reported.length} step{reported.length === 1 ? "" : "s"}
        </span>
      </summary>
      {failed > 0 && (
        <ul className="divide-y divide-border-default border-t border-border-default">
          {reported.flatMap((step) =>
            (step.tests?.failures ?? []).map((failure, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: a report may list the same test twice
                key={`${step.id}-${failure.suite}-${failure.name}-${index}`}
                className="px-3 py-1.5"
              >
                <details>
                  <summary className="cursor-pointer">
                    <span className="font-medium">{failure.name}</span>
                    {failure.suite && <span className="text-fg-muted"> · {failure.suite}</span>}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        onShow(step.stageIndex);
                      }}
                      className="ml-2 text-info hover:underline"
                    >
                      {step.stage} › {step.name}
                    </button>
                    {failure.message && (
                      <span className="block truncate text-danger">{failure.message}</span>
                    )}
                  </summary>
                  {failure.details && (
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-2xs text-fg-secondary">
                      {failure.details}
                    </pre>
                  )}
                </details>
              </li>
            )),
          )}
        </ul>
      )}
    </details>
  );
}

function TestFailures({ tests }: { tests: TestSummary }) {
  return (
    <div className="mx-10 mb-2 rounded-md border border-border-default">
      <p className="border-b border-border-default px-3 py-1.5 text-xs font-medium">Failed tests</p>
      <ul className="divide-y divide-border-default">
        {tests.failures.map((failure, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: a report may list the same test twice
            key={`${failure.suite}-${failure.name}-${index}`}
            className="px-3 py-1.5 text-xs"
          >
            <details>
              <summary className="cursor-pointer">
                <span className="font-medium">{failure.name}</span>
                {failure.suite && <span className="text-fg-muted"> · {failure.suite}</span>}
                {failure.message && (
                  <span className="block truncate text-danger">{failure.message}</span>
                )}
              </summary>
              {failure.details && (
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-2xs text-fg-secondary">
                  {failure.details}
                </pre>
              )}
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LogSection({
  title,
  lines,
  query,
  defaultOpen,
}: {
  title: string;
  lines: RunLogLine[];
  query: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border-default last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface-hover"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {open && <LogLines lines={lines} query={query} follow={false} />}
    </div>
  );
}

function matchLine(line: RunLogLine, query: string): boolean {
  return line.text.toLowerCase().includes(query.toLowerCase());
}

/** A step's log with line numbers; while the step runs it stays scrolled to the end. */
function LogLines({
  lines,
  query,
  follow,
}: {
  lines: RunLogLine[];
  query: string;
  follow: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  // The step's own heading line ("Build › npm ci") is already the row above.
  const numbered = lines
    .filter(
      (line, index) => !(index === 0 && line.stream === "system" && line.text.includes(" › ")),
    )
    .map((line, index) => ({ line, number: index + 1 }));
  const shown = query ? numbered.filter(({ line }) => matchLine(line, query)) : numbered;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll as new lines arrive
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length, follow]);

  return (
    <div
      ref={box}
      className="max-h-[60vh] overflow-auto bg-surface-subtle py-1 font-mono text-2xs leading-[1.6]"
    >
      {shown.length === 0 ? (
        <p className="px-4 py-1 text-fg-muted">{query ? "No matching lines." : "No output."}</p>
      ) : (
        shown.map(({ line, number }) => (
          <div key={line.seq} className="flex hover:bg-surface-hover">
            <span className="w-12 shrink-0 pr-3 text-right text-fg-muted select-none">
              {number}
            </span>
            <span
              className={`min-w-0 flex-1 pr-3 break-all whitespace-pre-wrap ${
                line.stream === "system"
                  ? "font-semibold text-fg-secondary"
                  : line.stream === "err"
                    ? "text-warning"
                    : "text-fg"
              }`}
            >
              {highlight(line.text.replace(ANSI, ""), query) || " "}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function highlight(text: string, query: string) {
  if (!query) return text;
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-warning-subtle text-fg">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
}

/** The open question of an approval step, with Approve and Reject for those who may answer. */
function ApprovalBox({
  teamId,
  runId,
  approval,
  onAnswered,
}: {
  teamId: string;
  runId: string;
  approval: RunApproval;
  onAnswered: () => void;
}) {
  const [comment, setComment] = useState("");
  const decide = useMutation({
    mutationFn: (decision: "approved" | "rejected") =>
      api.pipelines.decide(teamId, runId, approval.id, decision, comment.trim() || null),
    onSuccess: onAnswered,
  });
  const who =
    approval.approvers === "editors"
      ? "Editors, admins and owners"
      : "The team's admins and owners";
  return (
    <section className="mb-4 rounded-md border border-warning/40 bg-warning-subtle p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Hand size={16} /> {approval.message}
      </p>
      <p className="mt-1 text-xs text-fg-secondary">
        {who} can answer{approval.allowSelf ? "" : ", but not the person who started this run"}. If
        nobody answers by {new Date(approval.deadline).toLocaleString()}, the step times out.
      </p>
      {approval.canDecide ? (
        <div className="mt-3 grid gap-2">
          <Input
            aria-label="Comment"
            placeholder="Comment (optional)"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              icon={<Check size={14} />}
              disabled={decide.isPending}
              onClick={() => decide.mutate("approved")}
            >
              Approve
            </Button>
            <Button
              variant="danger"
              icon={<X size={14} />}
              disabled={decide.isPending}
              onClick={() => decide.mutate("rejected")}
            >
              Reject
            </Button>
          </div>
          {decide.error && <p className="text-xs text-danger">{vaultErrorMessage(decide.error)}</p>}
        </div>
      ) : (
        <p className="mt-2 text-xs font-medium">You cannot answer this one.</p>
      )}
    </section>
  );
}
