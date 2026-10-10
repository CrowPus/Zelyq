import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PIPELINE_TEMPLATES,
  type PipelineTriggerSummary,
  parsePipelineFile,
  roleAtLeast,
} from "@zelyq/core";
import { Clock, GitBranch, Play, Plus, Save, TerminalSquare, Trash2, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { StageStrip, StatusIcon } from "../components/pipelines/Stages";
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

type Tab = "runs" | "file" | "triggers";

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
    mutationFn: () => api.pipelines.start(team?.id ?? "", id),
    onSuccess: ({ run }) => navigate(`/pipelines/${id}/runs/${run.id}`),
  });

  const name = isNew ? "New pipeline" : (pipeline.data?.pipeline.name ?? "…");
  return (
    <AppShell crumbs={[{ label: "Pipelines", to: "/pipelines" }, { label: name }]}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-6">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Workflow size={18} strokeWidth={1.75} /> {name}
            </h1>
            {!isNew && canWrite && (
              <Button
                variant="primary"
                icon={<Play size={14} />}
                disabled={start.isPending}
                onClick={() => start.mutate()}
              >
                Run now
              </Button>
            )}
          </header>
          {start.error && (
            <p className="mb-3 text-xs text-danger">{vaultErrorMessage(start.error)}</p>
          )}

          {!isNew && (
            <div role="tablist" className="mb-4 flex gap-1 border-b border-border-default">
              {(["runs", "file", "triggers"] as const).map((value) => (
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
                  {value === "runs" ? "Runs" : value === "file" ? "File" : "Triggers"}
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
              canWrite={canWrite}
              onSaved={() => {
                void queryClient.invalidateQueries({ queryKey: ["pipeline", team.id, id] });
              }}
            />
          ) : tab === "triggers" ? (
            <Triggers teamId={team.id} pipelineId={id} canWrite={canWrite} />
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
              <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary">
                {run.triggeredBy ? run.triggeredBy.name : TRIGGER_WORDS[run.trigger]}
                {run.runner && <> · on {run.runner}</>}
                {run.error && <> · {run.error}</>}
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

function FileEditor({
  teamId,
  pipelineId,
  initial,
  isNew = false,
  canWrite,
  onSaved,
}: {
  teamId: string;
  pipelineId?: string;
  initial: string;
  isNew?: boolean;
  canWrite: boolean;
  onSaved: (id: string) => void;
}) {
  const [source, setSource] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<PipelineCheck | null>(null);
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
      {canWrite && (
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            icon={<Save size={14} />}
            disabled={!parsed.ok || save.isPending || (!isNew && source === initial)}
            onClick={() => save.mutate()}
          >
            {isNew ? "Create pipeline" : "Save"}
          </Button>
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
  on: [failed]`}</pre>
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
  const [kind, setKind] = useState<"push" | "schedule" | null>(null);
  const [branches, setBranches] = useState("main");
  const [cron, setCron] = useState("0 3 * * *");
  const [created, setCreated] = useState<{
    trigger: PipelineTriggerSummary;
    secret: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["pipeline-triggers", teamId, pipelineId] });

  const add = useMutation({
    mutationFn: () =>
      api.pipelines.addTrigger(
        teamId,
        pipelineId,
        kind === "push"
          ? {
              kind: "push",
              branches: branches
                .split(",")
                .map((b) => b.trim())
                .filter(Boolean),
            }
          : { kind: "schedule", cron: cron.trim() },
      ),
    onSuccess: (result) => {
      setCreated(result);
      setKind(null);
      setError(null);
      void refresh();
    },
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
            GitHub: Settings → Webhooks → Add webhook, events "Just the push event". GitLab:
            Settings → Webhooks, put the secret in "Secret token", tick "Push events".
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
              {trigger.kind === "push" ? <GitBranch size={14} /> : <Clock size={14} />}
              <span className="min-w-0 flex-1">
                {trigger.kind === "push" ? (
                  <>
                    On a push to <span className="font-mono">{trigger.branches?.join(", ")}</span>
                    <span className="block truncate font-mono text-2xs text-fg-muted">
                      {absolute(trigger.webhookUrl)}
                    </span>
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
          </div>
        ) : (
          <div className="grid gap-2 rounded-md border border-border-default p-3">
            {kind === "push" ? (
              <div className="grid gap-1">
                <FieldLabel>Branches (comma-separated, release/* allowed)</FieldLabel>
                <Input
                  aria-label="Branches"
                  value={branches}
                  onChange={(event) => setBranches(event.target.value)}
                />
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
                icon={<Plus size={13} />}
                disabled={add.isPending}
                onClick={() => add.mutate()}
              >
                Add trigger
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setKind(null)}>
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
