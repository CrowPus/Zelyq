import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PIPELINE_TEMPLATES,
  type PipelineRunSummary,
  type PipelineTriggerSummary,
  parsePipelineFile,
  roleAtLeast,
  type TriggerInput,
} from "@zelyq/core";
import {
  Clock,
  GitBranch,
  GitPullRequest,
  Link2,
  Pencil,
  Play,
  Plus,
  Save,
  Sparkles,
  TerminalSquare,
  Trash2,
  Workflow,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { RepoFileBar } from "../components/pipelines/RepoFile";
import { StageStrip, StatusIcon } from "../components/pipelines/Stages";
import { VisualEditor } from "../components/pipelines/VisualEditor";
import {
  Badge,
  Button,
  EmptyState,
  FieldLabel,
  IconButton,
  Input,
  Spinner,
} from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { api, type PipelineCheck } from "../lib/api";
import { duration, RUN_STATUS, TRIGGER_WORDS } from "../lib/pipelines";
import { formatRelative, vaultErrorMessage } from "../lib/vault";

type Tab = "runs" | "branches" | "file" | "triggers";

/** One pipeline: its runs, its file, and what starts it. `/pipelines/new` is the file alone. */
export function PipelinePage() {
  const { id = "new" } = useParams();
  const isNew = id === "new";
  const { team } = useActiveTeam();
  const [params, setParams] = useSearchParams();
  const tab: Tab = isNew ? "file" : ((params.get("tab") as Tab | null) ?? "runs");
  const canWrite = team ? roleAtLeast(team.role, "editor") : false;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const pipeline = useQuery({
    queryKey: ["pipeline", team?.id, id],
    queryFn: () => api.pipelines.get(team?.id ?? "", id),
    enabled: Boolean(team) && !isNew,
  });
  const start = useMutation({
    mutationFn: (inputs?: Record<string, string>) =>
      api.pipelines.start(team?.id ?? "", id, inputs),
    onSuccess: ({ run }) => navigate(`/pipelines/${id}/runs/${run.id}`),
  });
  // A pipeline with inputs asks for them first.
  const [asking, setAsking] = useState(false);
  const declaredInputs = useMemo(() => {
    const parsed = pipeline.data ? parsePipelineFile(pipeline.data.pipeline.source) : null;
    return parsed?.ok ? (parsed.file.inputs ?? {}) : {};
  }, [pipeline.data]);

  const name = isNew ? "New pipeline" : (pipeline.data?.pipeline.name ?? "…");
  return (
    <AppShell crumbs={[{ label: "Pipelines", to: "/pipelines" }, { label: name }]}>
      <div className="h-full overflow-y-auto">
        <div className={`mx-auto w-full px-4 py-6 ${tab === "file" ? "max-w-6xl" : "max-w-4xl"}`}>
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Workflow size={18} strokeWidth={1.75} /> {name}
            </h1>
            {!isNew && canWrite && (
              <Button
                variant="primary"
                icon={<Play size={14} />}
                disabled={start.isPending}
                onClick={() =>
                  Object.keys(declaredInputs).length > 0 ? setAsking(true) : start.mutate(undefined)
                }
              >
                Run now
              </Button>
            )}
          </header>
          {start.error && (
            <p className="mb-3 text-xs text-danger">{vaultErrorMessage(start.error)}</p>
          )}
          {asking && (
            <InputsForm
              inputs={declaredInputs}
              busy={start.isPending}
              onCancel={() => setAsking(false)}
              onStart={(values) => start.mutate(values)}
            />
          )}

          {!isNew && (
            <div role="tablist" className="mb-4 flex gap-1 border-b border-border-default">
              {(["runs", "branches", "file", "triggers"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() =>
                    setParams(value === "runs" ? {} : { tab: value }, { replace: true })
                  }
                  className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
                    tab === value
                      ? "border-primary font-medium text-fg"
                      : "border-transparent text-fg-secondary hover:text-fg"
                  }`}
                >
                  {value === "runs"
                    ? "Runs"
                    : value === "branches"
                      ? "Branches"
                      : value === "file"
                        ? "File"
                        : "Triggers"}
                </button>
              ))}
            </div>
          )}

          {!team ? null : isNew ? (
            <FileEditor
              teamId={team.id}
              initial={PIPELINE_TEMPLATES[0]?.source ?? ""}
              isNew
              canWrite={canWrite}
              onSaved={(saved) => {
                void queryClient.invalidateQueries({ queryKey: ["pipelines", team.id] });
                navigate(`/pipelines/${saved}`);
              }}
            />
          ) : pipeline.isLoading ? (
            <Spinner />
          ) : !pipeline.data ? (
            <EmptyState
              title="Not found"
              description="This pipeline is not in the team you have chosen."
            />
          ) : tab === "file" ? (
            <FileEditor
              key={pipeline.data.pipeline.updatedAt}
              teamId={team.id}
              pipelineId={id}
              initial={pipeline.data.pipeline.source}
              name={pipeline.data.pipeline.name}
              repoPath={pipeline.data.pipeline.repoPath}
              canWrite={canWrite}
              onSaved={() => {
                void queryClient.invalidateQueries({ queryKey: ["pipeline", team.id, id] });
              }}
            />
          ) : tab === "triggers" ? (
            <Triggers teamId={team.id} pipelineId={id} canWrite={canWrite} />
          ) : tab === "branches" ? (
            <Branches teamId={team.id} pipelineId={id} />
          ) : (
            <Runs teamId={team.id} pipelineId={id} />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Runs({ teamId, pipelineId }: { teamId: string; pipelineId: string }) {
  const runs = useQuery({
    queryKey: ["pipeline-runs", teamId, pipelineId],
    queryFn: () => api.pipelines.runs(teamId, pipelineId),
    refetchInterval: 3000,
  });
  if (runs.isLoading) return <Spinner />;
  if ((runs.data?.runs.length ?? 0) === 0) {
    return <EmptyState title="No runs yet" description="Press Run now, or add a trigger." />;
  }
  return (
    <ul className="divide-y divide-border-default rounded-md border border-border-default">
      {runs.data?.runs.map((run) => {
        const status = RUN_STATUS[run.status];
        return (
          <li key={run.id}>
            <Link
              to={`/pipelines/${pipelineId}/runs/${run.id}`}
              className="flex items-center gap-3 px-3 py-2 hover:bg-surface-hover"
            >
              <StatusIcon status={run.status} />
              <span className="w-10 font-mono text-sm">#{run.number}</span>
              <Badge tone={status.tone}>{status.label}</Badge>
              <StageStrip stages={run.stages} />
              <span className="min-w-0 flex-1 text-xs text-fg-secondary">
                <span className="block truncate">
                  {run.triggeredBy ? run.triggeredBy.name : TRIGGER_WORDS[run.trigger]}
                  {run.runner && <> · on {run.runner}</>}
                  {run.error && <> · {run.error}</>}
                </span>
                <RunSource run={run} />
              </span>
              <span className="text-xs text-fg-muted">
                {duration(run.startedAt, run.finishedAt)} · {formatRelative(run.createdAt)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Where a run's code came from: its pull request or branch, and its commit. */
function RunSource({ run }: { run: PipelineRunSummary }) {
  if (!run.pullRequest && !run.branch && !run.commit) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate text-2xs text-fg-muted">
      {run.pullRequest ? (
        <>
          <GitPullRequest size={11} className="shrink-0" />
          <span className="truncate">
            #{run.pullRequest.number} {run.pullRequest.title}
          </span>
        </>
      ) : run.branch ? (
        <>
          <GitBranch size={11} className="shrink-0" />
          <span className="font-mono">{run.branch}</span>
        </>
      ) : null}
      {run.commit && <span className="font-mono">{run.commit.slice(0, 7)}</span>}
      {run.commitMessage && <span className="truncate">{run.commitMessage}</span>}
    </span>
  );
}

/**
 * Each pull request and branch the pipeline ran for, with its newest run:
 * what is green and what is red, at a glance.
 */
function Branches({ teamId, pipelineId }: { teamId: string; pipelineId: string }) {
  const runs = useQuery({
    queryKey: ["pipeline-runs", teamId, pipelineId],
    queryFn: () => api.pipelines.runs(teamId, pipelineId),
    refetchInterval: 5000,
  });
  if (runs.isLoading) return <Spinner />;
  const all = runs.data?.runs ?? [];
  // Runs come newest first, so the first one seen for each is its latest.
  const requests = new Map<number, PipelineRunSummary>();
  const branches = new Map<string, PipelineRunSummary>();
  for (const run of all) {
    if (run.pullRequest) {
      if (!requests.has(run.pullRequest.number)) requests.set(run.pullRequest.number, run);
    } else if (run.branch && !branches.has(run.branch)) {
      branches.set(run.branch, run);
    }
  }
  if (requests.size === 0 && branches.size === 0) {
    return (
      <EmptyState
        title="No branches yet"
        description="Runs started by a git push or a pull request show here, one row per branch and pull request, with its latest result."
      />
    );
  }
  const row = (run: PipelineRunSummary, label: ReactNode) => (
    <li key={run.id} className="flex items-center gap-3 px-3 py-2 text-sm">
      <StatusIcon status={run.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {run.commitMessage && (
          <span className="block truncate text-2xs text-fg-muted">
            {run.commit && <span className="font-mono">{run.commit.slice(0, 7)} </span>}
            {run.commitMessage}
          </span>
        )}
      </span>
      <StageStrip stages={run.stages} />
      <Link
        to={`/pipelines/${pipelineId}/runs/${run.id}`}
        className="font-mono text-xs text-primary hover:underline"
      >
        #{run.number}
      </Link>
      <span className="w-20 text-right text-xs text-fg-muted">{formatRelative(run.createdAt)}</span>
    </li>
  );
  return (
    <div className="grid gap-4">
      {requests.size > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <GitPullRequest size={14} /> Pull requests
          </h2>
          <ul className="divide-y divide-border-default rounded-md border border-border-default">
            {[...requests.values()].map((run) => {
              const request = run.pullRequest as NonNullable<PipelineRunSummary["pullRequest"]>;
              return row(
                run,
                <>
                  {request.url ? (
                    <a
                      href={request.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:underline"
                    >
                      #{request.number} {request.title}
                    </a>
                  ) : (
                    <span className="font-medium">
                      #{request.number} {request.title}
                    </span>
                  )}
                  <span className="ml-2 font-mono text-2xs text-fg-muted">
                    {run.branch} → {request.base}
                  </span>
                </>,
              );
            })}
          </ul>
        </section>
      )}
      {branches.size > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <GitBranch size={14} /> Branches
          </h2>
          <ul className="divide-y divide-border-default rounded-md border border-border-default">
            {[...branches.entries()].map(([branch, run]) =>
              row(run, <span className="font-mono">{branch}</span>),
            )}
          </ul>
        </section>
      )}
      <p className="text-2xs text-fg-muted">From the newest 100 runs.</p>
    </div>
  );
}

function FileEditor({
  teamId,
  pipelineId,
  initial,
  isNew = false,
  name = "",
  repoPath = null,
  canWrite: allowed,
  onSaved,
}: {
  teamId: string;
  pipelineId?: string;
  initial: string;
  isNew?: boolean;
  name?: string;
  /** Kept in the repository: changed there, so shown here without editing. */
  repoPath?: string | null;
  canWrite: boolean;
  onSaved: (id: string) => void;
}) {
  const canWrite = allowed && !repoPath;
  const [source, setSource] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<PipelineCheck | null>(null);
  // Visual or YAML: the same file either way; the last choice is remembered.
  const [mode, setMode] = useState<"visual" | "yaml">(() => {
    try {
      return localStorage.getItem("zelyq.pipeline-editor") === "yaml" ? "yaml" : "visual";
    } catch {
      return "visual";
    }
  });
  const choose = (next: "visual" | "yaml") => {
    setMode(next);
    try {
      localStorage.setItem("zelyq.pipeline-editor", next);
    } catch {
      // Private windows may refuse; the choice just is not remembered.
    }
  };
  const parsed = useMemo(() => parsePipelineFile(source), [source]);

  // The same rules the server uses, as you type; the server adds what only it
  // knows (is the secret in Vault, is there such a runner) a moment later.
  useEffect(() => {
    if (!parsed.ok) return;
    const timer = setTimeout(() => {
      void api.pipelines
        .check(teamId, source)
        .then(setCheck)
        .catch(() => setCheck(null));
    }, 600);
    return () => clearTimeout(timer);
  }, [teamId, source, parsed.ok]);

  const save = useMutation({
    mutationFn: () =>
      pipelineId
        ? api.pipelines.update(teamId, pipelineId, source)
        : api.pipelines.create(teamId, source),
    onSuccess: ({ pipeline }) => {
      setError(null);
      onSaved(pipeline.id);
    },
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => api.pipelines.remove(teamId, pipelineId ?? ""),
    onSuccess: () => navigate("/pipelines"),
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });

  return (
    <div className="grid gap-3">
      {!isNew && pipelineId && (
        <RepoFileBar
          teamId={teamId}
          pipelineId={pipelineId}
          name={name}
          source={initial}
          repoPath={repoPath}
          canWrite={allowed && source === initial}
          onChanged={() => onSaved(pipelineId)}
        />
      )}
      {isNew && (
        <div className="flex flex-wrap items-center gap-2">
          <FieldLabel>Start from</FieldLabel>
          {PIPELINE_TEMPLATES.map((template) => (
            <Button key={template.id} size="sm" onClick={() => setSource(template.source)}>
              {template.label}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Editor"
          className="inline-flex rounded-md border border-border-default bg-surface p-0.5 text-xs"
        >
          {(["visual", "yaml"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={mode === option}
              onClick={() => choose(option)}
              className={`rounded px-3 py-1 ${
                mode === option
                  ? "bg-surface-hover font-medium text-fg"
                  : "text-fg-secondary hover:text-fg"
              }`}
            >
              {option === "visual" ? "Visual" : "YAML"}
            </button>
          ))}
        </div>
        {canWrite && (
          <span className="ml-auto flex items-center gap-2">
            {!isNew && source !== initial && (
              <>
                <span className="text-xs text-warning">Unsaved changes</span>
                <Button size="sm" variant="ghost" onClick={() => setSource(initial)}>
                  Undo all
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="primary"
              icon={<Save size={13} />}
              disabled={!parsed.ok || save.isPending || (!isNew && source === initial)}
              onClick={() => save.mutate()}
            >
              {isNew ? "Create pipeline" : "Save"}
            </Button>
          </span>
        )}
      </div>
      {mode === "visual" ? (
        <VisualEditor
          teamId={teamId}
          pipelineId={pipelineId}
          source={source}
          onChange={setSource}
          canWrite={canWrite}
        />
      ) : (
        <textarea
          aria-label="Pipeline file"
          spellCheck={false}
          readOnly={!canWrite}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          onKeyDown={(event) => {
            // Tab indents, as in any editor, instead of leaving the field.
            if (event.key === "Tab" && !event.shiftKey) {
              event.preventDefault();
              const target = event.currentTarget;
              const at = target.selectionStart;
              setSource(`${source.slice(0, at)}  ${source.slice(target.selectionEnd)}`);
              requestAnimationFrame(() => target.setSelectionRange(at + 2, at + 2));
            }
          }}
          rows={Math.min(40, Math.max(16, source.split("\n").length + 2))}
          className="w-full rounded-md border border-border-default bg-surface p-3 font-mono text-xs leading-5 focus-visible:outline-2 focus-visible:outline-focus"
        />
      )}
      {!parsed.ok ? (
        <ul className="grid gap-1 rounded-md border border-danger/30 bg-danger-subtle p-2 text-xs text-danger">
          {parsed.issues.map((issue) => (
            <li key={`${issue.path}-${issue.message}`}>
              {issue.line ? `Line ${issue.line}: ` : ""}
              {issue.message}
            </li>
          ))}
        </ul>
      ) : check?.warnings.length ? (
        <ul className="grid gap-1 rounded-md border border-warning/30 bg-warning-subtle p-2 text-xs">
          {check.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {error && <p className="text-xs text-danger">{error}</p>}
      {allowed && (
        <div className="flex items-center gap-2">
          {!isNew && (
            <Button
              variant="danger"
              icon={<Trash2 size={14} />}
              className="ml-auto"
              onClick={() => {
                if (window.confirm("Delete this pipeline and all its runs?")) remove.mutate();
              }}
            >
              Delete pipeline
            </Button>
          )}
        </div>
      )}
      <Help />
    </div>
  );
}

function Help() {
  return (
    <details className="rounded-md border border-border-default p-3 text-xs text-fg-secondary">
      <summary className="cursor-pointer font-medium text-fg">What can go in the file?</summary>
      <pre className="mt-2 overflow-x-auto font-mono text-2xs leading-5">{`name: Deploy                 # shown in the list
runs-on: local               # or a runner's name (build-01), or labels: [linux, docker]
source:                      # what checkout: true fetches
  app: My app                #   one of this team's apps
  # repo: https://github.com/you/app
  # ref: main
  # token: vault://GITHUB_TOKEN
env:
  API_KEY: vault://API_KEY   # from the team's Vault; hidden in the log
timeout: 30m                 # whole run (default 1h)
stages:
  - name: Build
    steps:
      - checkout: true
      - run: npm ci && npm run build
        timeout: 10m
        shell: bash          # bash, sh, zsh, pwsh (Windows default), powershell
        working-directory: web
        continue-on-error: true
  - name: Tell someone
    if: failure()            # success() (default), failure(), always()
    steps:
      - run: echo "it broke"
artifacts:
  - name: site
    path: dist               # kept for download after the run
notify:
  webhook: vault://SLACK_WEBHOOK   # Slack, Discord or any URL
  on: [failed, waiting]`}</pre>
      <p className="mt-3 font-medium text-fg">Built-in steps</p>
      <pre className="mt-1 overflow-x-auto font-mono text-2xs leading-5">{`- setup: node@22             # also node@lts, python@3.12, java@21, go@1.26
- setup: node                # the version in .nvmrc / .node-version
- cache: node_modules        # kept between runs; also .venv, ~/.m2, …
- cache: {path: build/deps, key: deps.lock}
- docker:                    # needs a runner with Docker
    image: registry.example.com/team/app
    tags: [latest, "$ZELYQ_RUN_NUMBER"]
    push: true
    login: {username: deploy, password: vault://REGISTRY_PASSWORD}
- approval: Deploy to production?   # waits for an admin's Approve
- approval:
    message: Ship it?
    approvers: editors       # admins (default) or editors
    timeout: 4h              # default 24h, at most 7d
    allow-self: false        # someone else than who started the run
- deploy:                    # to an environment in Deployments (needs a Dockerfile)
    to: production
    port: 3000               # the app's port inside its container
    host-port: 80            # on the machine; default the same
    health: /health          # checked after starting; default /
- pipeline: {run: Shop deploy, with: {environment: staging}}   # start another; waits by default
- download: {artifact: dist}  # files the run that started this one kept`}</pre>
      <p className="mt-3 font-medium text-fg">Inputs, one at a time, retry, keeping runs</p>
      <pre className="mt-1 overflow-x-auto font-mono text-2xs leading-5">{`inputs:                      # asked for by Run now
  environment: {choices: [staging, production], default: staging}
  version: {}                # no default: required
concurrency: one-at-a-time   # or newest-wins
keep: {runs: 50, artifacts: 14d}
stages:
  - name: Ship
    steps:
      - run: npm ci
        retry: 2             # try a failed step again, up to 5
      - deploy: {to: "\${{ inputs.environment }}", port: 3000}
      - run: echo "$ZELYQ_INPUT_VERSION"`}</pre>
      <p className="mt-3 font-medium text-fg">Outputs, services, test reports, commit status</p>
      <pre className="mt-1 overflow-x-auto font-mono text-2xs leading-5">{`source:
  repo: https://github.com/you/shop
  token: vault://GITHUB_TOKEN
  report-status: true        # ✓ / ✗ on the commit and the pull request
services:                    # removed when the run ends; Docker on Linux/macOS
  postgres: {image: postgres:16, env: {POSTGRES_PASSWORD: test}, port: 5432}
stages:
  - name: Test
    steps:
      - id: meta
        run: echo "version=1.4.2" >> "$ZELYQ_OUTPUT"
      - run: npx vitest run --reporter=junit --outputFile=reports/junit.xml
        tests: reports/*.xml   # JUnit files: passed / failed on the step
        env:
          DATABASE_URL: postgres://postgres:test@\${{ services.postgres.host }}:\${{ services.postgres.port }}/postgres
      - run: echo "Shipping \${{ steps.meta.outputs.version }}"`}</pre>
      <p className="mt-3 font-medium text-fg">
        Stages at the same time, a machine per stage, matrix
      </p>
      <pre className="mt-1 overflow-x-auto font-mono text-2xs leading-5">{`stages:
  - name: Build
    steps: [{checkout: true}, {run: npm run build}]
  - name: Test on Mac
    runs-on: mac-mini          # this stage on another runner
    steps: [{checkout: true}, {run: npm test}]
  - name: Lint
    parallel: true             # at the same time as the stage above
    steps: [{checkout: true}, {run: npm run lint}]
  - name: Node
    matrix: {node: [20, 22]}   # one copy per value, all at the same time
    steps:
      - checkout: true
      - setup: node@\${{ matrix.node }}
      - run: npm test
  - name: Ship                 # waits for all of them
    steps: [{run: echo ok}]

# A stage with runs-on, or beside another, starts in an empty folder
# of its own: check out again there. No approvals in such a stage.`}</pre>
      <p className="mt-3 font-medium text-fg">Templates: reuse another pipeline's stages</p>
      <pre className="mt-1 overflow-x-auto font-mono text-2xs leading-5">{`stages:
  - name: Checks
    uses: Node checks          # another pipeline of this team, by name
    with: {node: "22"}         # its inputs
  - name: Ship
    steps: [{run: ./deploy.sh}]

# Its stages (and env) are copied in when a run starts; the run keeps
# that copy, so changing the template changes only later runs.`}</pre>
      <p className="mt-3 font-medium text-fg">Plugins: ready-made steps</p>
      <pre className="mt-1 overflow-x-auto font-mono text-2xs leading-5">{`- id: hello
  plugin: acme/hello@1.0.0     # installed in Pipelines → Plugins
  with:
    who: team
    token: vault://API_TOKEN   # a secret input comes from Vault
- run: echo "\${{ steps.hello.outputs.greeting }}"`}</pre>
    </details>
  );
}

function absolute(url: string | null): string {
  if (!url) return "";
  return url.startsWith("/") ? `${window.location.origin}${url}` : url;
}

function Triggers({
  teamId,
  pipelineId,
  canWrite,
}: {
  teamId: string;
  pipelineId: string;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const triggers = useQuery({
    queryKey: ["pipeline-triggers", teamId, pipelineId],
    queryFn: () => api.pipelines.triggers(teamId, pipelineId),
  });
  const [kind, setKind] = useState<"push" | "schedule" | "pipeline" | null>(null);
  /** The trigger being changed; null when adding one. */
  const [editing, setEditing] = useState<string | null>(null);
  const [upstreamId, setUpstreamId] = useState("");
  const [onFailed, setOnFailed] = useState(false);
  const otherPipelines = useQuery({
    queryKey: ["pipelines", teamId],
    queryFn: () => api.pipelines.list(teamId),
    enabled: kind === "pipeline",
  });
  const [branches, setBranches] = useState("main");
  const [paths, setPaths] = useState("");
  const [pullRequests, setPullRequests] = useState(false);
  const [cron, setCron] = useState("0 3 * * *");
  const [created, setCreated] = useState<{
    trigger: PipelineTriggerSummary;
    secret: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["pipeline-triggers", teamId, pipelineId] });

  const input = (): TriggerInput =>
    kind === "push"
      ? {
          kind: "push",
          branches: branches
            .split(",")
            .map((b) => b.trim())
            .filter(Boolean),
          paths: paths
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
          pullRequests,
        }
      : kind === "pipeline"
        ? {
            kind: "pipeline",
            pipelineId: upstreamId,
            on: onFailed ? ["passed", "failed"] : ["passed"],
          }
        : { kind: "schedule", cron: cron.trim() };
  const close = () => {
    setKind(null);
    setEditing(null);
    setError(null);
  };
  const add = useMutation({
    mutationFn: () => api.pipelines.addTrigger(teamId, pipelineId, input()),
    onSuccess: (result) => {
      setCreated(result);
      close();
      void refresh();
    },
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const save = useMutation({
    mutationFn: (triggerId: string) =>
      api.pipelines.editTrigger(teamId, pipelineId, triggerId, input()),
    onSuccess: () => {
      close();
      void refresh();
    },
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const startEditing = (trigger: PipelineTriggerSummary) => {
    if (trigger.kind === "app") return;
    setCreated(null);
    setError(null);
    setEditing(trigger.id);
    setKind(trigger.kind);
    if (trigger.kind === "push") {
      setBranches(trigger.branches?.join(", ") ?? "main");
      setPaths(trigger.paths.join(", "));
      setPullRequests(trigger.pullRequests);
    } else if (trigger.kind === "schedule") {
      setCron(trigger.cron ?? "");
    } else {
      setUpstreamId(trigger.upstream?.id ?? "");
      setOnFailed(trigger.upstream?.on.includes("failed") ?? false);
    }
  };
  const addApp = useMutation({
    mutationFn: () => api.pipelines.addTrigger(teamId, pipelineId, { kind: "app" }),
    onSuccess: () => void refresh(),
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const toggle = useMutation({
    mutationFn: (trigger: PipelineTriggerSummary) =>
      api.pipelines.setTrigger(teamId, pipelineId, trigger.id, !trigger.enabled),
    onSuccess: () => void refresh(),
  });
  const remove = useMutation({
    mutationFn: (triggerId: string) => api.pipelines.removeTrigger(teamId, pipelineId, triggerId),
    onSuccess: () => void refresh(),
  });

  return (
    <div className="grid gap-4">
      {created?.secret && (
        <div className="rounded-md border border-warning/40 bg-warning-subtle p-3 text-xs">
          <p className="font-medium">
            Add this webhook to your repository — the secret is shown only now.
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-fg-secondary">Payload URL</dt>
            <dd className="font-mono break-all">{absolute(created.trigger.webhookUrl)}</dd>
            <dt className="text-fg-secondary">Secret</dt>
            <dd className="font-mono break-all">{created.secret}</dd>
            <dt className="text-fg-secondary">Content type</dt>
            <dd className="font-mono">application/json</dd>
          </dl>
          <p className="mt-2 text-fg-secondary">
            GitHub: Settings → Webhooks → Add webhook, events "Just the push event" (also "Pull
            requests" when ticked). GitLab: Settings → Webhooks, put the secret in "Secret token",
            tick "Push events".
          </p>
          <Button size="sm" className="mt-2" onClick={() => setCreated(null)}>
            I've added it
          </Button>
        </div>
      )}

      {triggers.isLoading ? (
        <Spinner />
      ) : (triggers.data?.triggers.length ?? 0) === 0 ? (
        <p className="text-xs text-fg-secondary">Nothing starts this pipeline on its own yet.</p>
      ) : (
        <ul className="divide-y divide-border-default rounded-md border border-border-default">
          {triggers.data?.triggers.map((trigger) => (
            <li key={trigger.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              {trigger.kind === "push" ? (
                <GitBranch size={14} />
              ) : trigger.kind === "app" ? (
                <Sparkles size={14} />
              ) : trigger.kind === "pipeline" ? (
                <Link2 size={14} />
              ) : (
                <Clock size={14} />
              )}
              <span className="min-w-0 flex-1">
                {trigger.kind === "push" ? (
                  <>
                    On a push to <span className="font-mono">{trigger.branches?.join(", ")}</span>
                    {trigger.paths?.length ? (
                      <>
                        {" "}
                        changing <span className="font-mono">{trigger.paths.join(", ")}</span>
                      </>
                    ) : null}
                    {trigger.pullRequests ? <> · also pull requests</> : null}
                    <span className="block truncate font-mono text-2xs text-fg-muted">
                      {absolute(trigger.webhookUrl)}
                    </span>
                  </>
                ) : trigger.kind === "app" ? (
                  <>When the agent changes the app</>
                ) : trigger.kind === "pipeline" ? (
                  <>
                    After <span className="font-medium">{trigger.upstream?.name}</span>{" "}
                    {trigger.upstream?.on.includes("failed") ? "ends (passed or failed)" : "passes"}
                  </>
                ) : (
                  <>
                    On the schedule <span className="font-mono">{trigger.cron}</span>{" "}
                    <span className="text-xs text-fg-muted">(UTC)</span>
                  </>
                )}
              </span>
              {trigger.lastFiredAt && (
                <span className="text-xs text-fg-muted">
                  last {formatRelative(trigger.lastFiredAt)}
                </span>
              )}
              {!trigger.enabled && <Badge>Off</Badge>}
              {canWrite && (
                <>
                  {trigger.kind !== "app" && (
                    <IconButton
                      size="sm"
                      label="Edit trigger"
                      onClick={() => startEditing(trigger)}
                    >
                      <Pencil size={13} />
                    </IconButton>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(trigger)}>
                    {trigger.enabled ? "Turn off" : "Turn on"}
                  </Button>
                  <IconButton
                    size="sm"
                    variant="danger"
                    label="Remove trigger"
                    onClick={() => remove.mutate(trigger.id)}
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite &&
        (kind === null ? (
          <div className="flex gap-2">
            <Button size="sm" icon={<GitBranch size={13} />} onClick={() => setKind("push")}>
              On a git push
            </Button>
            <Button size="sm" icon={<Clock size={13} />} onClick={() => setKind("schedule")}>
              On a schedule
            </Button>
            <Button
              size="sm"
              icon={<Sparkles size={13} />}
              disabled={addApp.isPending}
              onClick={() => addApp.mutate()}
              title="For pipelines whose source is an app: run whenever the agent changes it"
            >
              When the app changes
            </Button>
            <Button size="sm" icon={<Link2 size={13} />} onClick={() => setKind("pipeline")}>
              After another pipeline
            </Button>
          </div>
        ) : (
          <div className="grid gap-2 rounded-md border border-border-default p-3">
            {editing && (
              <p className="text-xs font-medium">
                Changing a trigger
                {kind === "push" && (
                  <span className="font-normal text-fg-secondary">
                    {" "}
                    — its webhook address and secret stay the same.
                  </span>
                )}
              </p>
            )}
            {kind === "pipeline" ? (
              <div className="grid gap-2">
                <FieldLabel>Start this pipeline after</FieldLabel>
                <select
                  aria-label="Upstream pipeline"
                  className="h-[30px] rounded-md border border-border-default bg-surface px-2 text-sm"
                  value={upstreamId}
                  onChange={(event) => setUpstreamId(event.target.value)}
                >
                  <option value="">Choose a pipeline…</option>
                  {otherPipelines.data?.pipelines
                    .filter((other) => other.id !== pipelineId)
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.name}
                      </option>
                    ))}
                </select>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={onFailed}
                    onChange={(event) => setOnFailed(event.target.checked)}
                  />
                  Also when it fails (default: only when it passes)
                </label>
                <span className="text-2xs text-fg-muted">
                  It runs with the same commit, and can take that run's artifacts with a download
                  step.
                </span>
              </div>
            ) : kind === "push" ? (
              <div className="grid gap-1">
                <FieldLabel>Branches (comma-separated, release/* allowed)</FieldLabel>
                <Input
                  aria-label="Branches"
                  value={branches}
                  onChange={(event) => setBranches(event.target.value)}
                />
                <FieldLabel>Only when these files change (optional, comma-separated)</FieldLabel>
                <Input
                  aria-label="Paths"
                  value={paths}
                  placeholder="frontend/**, package.json"
                  onChange={(event) => setPaths(event.target.value)}
                  className="font-mono"
                />
                <span className="text-2xs text-fg-muted">
                  * matches within a folder, ** across folders. Empty: any change.
                </span>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={pullRequests}
                    onChange={(event) => setPullRequests(event.target.checked)}
                  />
                  Also for pull requests (GitHub) and merge requests (GitLab)
                </label>
                <span className="text-2xs text-fg-muted">
                  Runs on the request's newest commit, when it targets one of the branches. Requests
                  from forks never run.
                </span>
              </div>
            ) : (
              <div className="grid gap-1">
                <FieldLabel>When (cron, UTC): minute hour day month weekday</FieldLabel>
                <Input
                  aria-label="Schedule"
                  value={cron}
                  onChange={(event) => setCron(event.target.value)}
                  className="font-mono"
                />
                <span className="text-2xs text-fg-muted">
                  0 3 * * * — every day at 03:00 · */15 * * * * — every 15 minutes · 0 9 * * 1-5 —
                  weekdays at 09:00
                </span>
              </div>
            )}
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                icon={editing ? <Save size={13} /> : <Plus size={13} />}
                disabled={add.isPending || save.isPending || (kind === "pipeline" && !upstreamId)}
                onClick={() => (editing ? save.mutate(editing) : add.mutate())}
              >
                {editing ? "Save trigger" : "Add trigger"}
              </Button>
              <Button size="sm" variant="ghost" onClick={close}>
                Cancel
              </Button>
            </div>
          </div>
        ))}

      <details className="rounded-md border border-border-default p-3 text-xs text-fg-secondary">
        <summary className="flex cursor-pointer items-center gap-1 font-medium text-fg">
          <TerminalSquare size={13} /> Start a run from a script or another CI
        </summary>
        <p className="mt-2">
          Make a service key with the "Start pipeline runs" permission in Vault → Service keys,
          then:
        </p>
        <pre className="mt-1 overflow-x-auto rounded bg-surface-subtle p-2 font-mono text-2xs">
          {`curl -X POST ${window.location.origin}/api/v1/pipelines/${pipelineId}/runs \\
  -H "Authorization: Bearer $ZELYQ_KEY" -H "content-type: application/json" -d '{}'`}
        </pre>
      </details>
    </div>
  );
}

/** Run now, for a pipeline with inputs: one field each (a list for choices). */
function InputsForm({
  inputs,
  busy,
  onStart,
  onCancel,
}: {
  inputs: Record<string, { description?: string; choices?: string[]; default?: string }>;
  busy: boolean;
  onStart: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(inputs).map(([name, input]) => [
        name,
        input.default ?? input.choices?.[0] ?? "",
      ]),
    ),
  );
  const missing = Object.entries(values)
    .filter(([, value]) => !value.trim())
    .map(([name]) => name);
  return (
    <form
      className="mb-4 grid gap-3 rounded-md border border-border-default p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onStart(values);
      }}
    >
      <p className="text-sm font-medium">Start with:</p>
      {Object.entries(inputs).map(([name, input]) => (
        <div key={name} className="grid gap-1">
          <FieldLabel>{name}</FieldLabel>
          {input.choices ? (
            <select
              aria-label={name}
              className="h-[30px] rounded-md border border-border-default bg-surface px-2 text-sm"
              value={values[name]}
              onChange={(event) => setValues({ ...values, [name]: event.target.value })}
            >
              {input.choices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          ) : (
            <Input
              aria-label={name}
              value={values[name] ?? ""}
              onChange={(event) => setValues({ ...values, [name]: event.target.value })}
            />
          )}
          {input.description && <span className="text-2xs text-fg-muted">{input.description}</span>}
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          icon={<Play size={14} />}
          disabled={busy || missing.length > 0}
        >
          Start the run
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
