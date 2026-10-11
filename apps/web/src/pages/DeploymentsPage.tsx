import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type DeploymentSummary,
  type EnvironmentSummary,
  roleAtLeast,
  type TeamMembership,
} from "@zelyq/core";
import {
  CheckCircle2,
  ExternalLink,
  History,
  Lock,
  Pencil,
  Plus,
  Rocket,
  RotateCcw,
  Snowflake,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
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
import { api } from "../lib/api";
import { formatRelative, vaultErrorMessage } from "../lib/vault";

const STATUS: Record<
  DeploymentSummary["status"],
  { label: string; tone: "success" | "danger" | "info" | "neutral" | "warning" }
> = {
  deploying: { label: "Deploying", tone: "info" },
  live: { label: "Live", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  rolled_back: { label: "Rolled back", tone: "warning" },
  replaced: { label: "Replaced", tone: "neutral" },
};

/**
 * Deployments — where a team's apps run. One card per environment (staging,
 * production…) with what is live there, its history, and roll back. A deploy
 * itself is a step in a pipeline, so it is always tested first.
 */
export function DeploymentsPage() {
  const { team } = useActiveTeam();
  const [adding, setAdding] = useState(false);
  const environments = useQuery({
    queryKey: ["environments", team?.id],
    queryFn: () => api.deploys.environments(team?.id ?? ""),
    enabled: Boolean(team),
    refetchInterval: 10_000,
  });
  const isAdmin = team ? roleAtLeast(team.role, "admin") : false;

  return (
    <AppShell crumbs={[{ label: "Deployments" }]}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
          <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold">
                <Rocket size={18} strokeWidth={1.75} /> Deployments
              </h1>
              <p className="mt-1 max-w-xl text-xs text-fg-secondary">
                Where your apps run. A pipeline deploys an app to an environment once its tests
                pass; if the new version does not come up, the previous one is put back by itself.
              </p>
            </div>
            {isAdmin && !adding && (
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
                New environment
              </Button>
            )}
          </header>

          {!team ? null : (
            <>
              {adding && <EnvironmentForm team={team} onDone={() => setAdding(false)} />}
              {environments.isLoading ? (
                <Spinner />
              ) : (environments.data?.environments.length ?? 0) === 0 ? (
                !adding && (
                  <EmptyState
                    title="No environments yet"
                    description="An environment is a place your apps run, like staging or production: one of your machines with Docker. Add a machine in Pipelines → Runners first."
                  />
                )
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {environments.data?.environments.map((environment) => (
                    <EnvironmentCard key={environment.id} team={team} environment={environment} />
                  ))}
                </div>
              )}
              <HowTo />
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function EnvironmentCard({
  team,
  environment,
}: {
  team: TeamMembership;
  environment: EnvironmentSummary;
}) {
  const queryClient = useQueryClient();
  const isAdmin = roleAtLeast(team.role, "admin");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["environments", team.id] });
  const update = useMutation({
    mutationFn: (input: { frozen: boolean; frozenReason?: string | null }) =>
      api.deploys.updateEnvironment(team.id, environment.id, input),
    onSuccess: () => void refresh(),
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const remove = useMutation({
    mutationFn: () => api.deploys.removeEnvironment(team.id, environment.id),
    onSuccess: () => void refresh(),
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });

  if (editing) {
    return (
      <EnvironmentForm team={team} environment={environment} onDone={() => setEditing(false)} />
    );
  }
  return (
    <section className="rounded-md border border-border-default">
      <header className="flex flex-wrap items-center gap-2 border-b border-border-default px-3 py-2">
        <h2 className="text-sm font-semibold">{environment.name}</h2>
        {environment.protected && (
          <span title="Every deploy needs an admin's approval">
            <Badge tone="warning">
              <Lock size={10} className="mr-1" /> Needs approval
            </Badge>
          </span>
        )}
        {environment.frozen && (
          <span title={environment.frozenReason ?? "No deploys"}>
            <Badge tone="info">
              <Snowflake size={10} className="mr-1" /> Frozen
            </Badge>
          </span>
        )}
        {isAdmin && (
          <span className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (environment.frozen) update.mutate({ frozen: false });
                else {
                  const reason = window.prompt(
                    "Freeze: no deploys until it is unfrozen. Why?",
                    "release freeze",
                  );
                  if (reason !== null)
                    update.mutate({ frozen: true, frozenReason: reason || null });
                }
              }}
            >
              {environment.frozen ? "Unfreeze" : "Freeze"}
            </Button>
            <IconButton size="sm" label="Edit environment" onClick={() => setEditing(true)}>
              <Pencil size={13} />
            </IconButton>
            <IconButton
              size="sm"
              variant="danger"
              label="Remove environment"
              onClick={() => {
                if (window.confirm(`Remove ${environment.name}?`)) remove.mutate();
              }}
            >
              <Trash2 size={13} />
            </IconButton>
          </span>
        )}
      </header>
      <div className="px-3 py-2 text-xs text-fg-secondary">
        on{" "}
        {environment.runner ? (
          <span className="font-medium text-fg">{environment.runner.name}</span>
        ) : (
          "no machine"
        )}
        {environment.address && <> ({environment.address})</>}
        {environment.variables.length > 0 && (
          <>
            {" "}
            · {environment.variables.length} variable{environment.variables.length === 1 ? "" : "s"}
          </>
        )}
        {environment.frozen && environment.frozenReason && (
          <> · frozen: {environment.frozenReason}</>
        )}
      </div>
      {environment.live.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-fg-muted">Nothing deployed here yet.</p>
      ) : (
        <ul className="divide-y divide-border-default border-t border-border-default">
          {environment.live.map((deployment) => (
            <LiveApp
              key={deployment.id}
              team={team}
              environment={environment}
              deployment={deployment}
            />
          ))}
        </ul>
      )}
      {error && <p className="px-3 pb-2 text-xs text-danger">{error}</p>}
    </section>
  );
}

function LiveApp({
  team,
  environment,
  deployment,
}: {
  team: TeamMembership;
  environment: EnvironmentSummary;
  deployment: DeploymentSummary;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{deployment.app}</span>
        <span className="font-mono text-xs text-fg-secondary">#{deployment.number}</span>
        <Badge tone={STATUS[deployment.status].tone}>{STATUS[deployment.status].label}</Badge>
        <span className="text-xs text-fg-muted">
          {deployment.by ? deployment.by.name : "a pipeline"} ·{" "}
          {formatRelative(deployment.createdAt)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          icon={<History size={12} />}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide history" : "History · roll back"}
        </Button>
      </div>
      {deployment.url && (
        <a
          href={deployment.url}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 inline-flex items-center gap-1 text-xs text-info hover:underline"
        >
          {deployment.url} <ExternalLink size={11} />
        </a>
      )}
      {open && <HistoryList team={team} environment={environment} app={deployment.app} />}
    </li>
  );
}

function HistoryList({
  team,
  environment,
  app,
}: {
  team: TeamMembership;
  environment: EnvironmentSummary;
  app: string;
}) {
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: ["deploy-history", team.id, environment.id, app],
    queryFn: () => api.deploys.history(team.id, environment.id, app),
  });
  // The roll back being followed on screen, and which log lines are open.
  const [following, setFollowing] = useState<{ id: string; to: number } | null>(null);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: ["deploy-history", team.id, environment.id, app],
    });
    void queryClient.invalidateQueries({ queryKey: ["environments", team.id] });
  };
  const rollBack = useMutation({
    mutationFn: (target: { id: string; number: number }) =>
      api.deploys.rollBack(team.id, target.id),
    onSuccess: ({ deployment }, target) => {
      setFollowing({ id: deployment.id, to: target.number });
      refresh();
    },
  });
  const mayRollBack = roleAtLeast(team.role, environment.protected ? "admin" : "editor");
  if (history.isLoading) return <Spinner className="mt-2" />;
  return (
    <div className="mt-2 rounded border border-border-default">
      {rollBack.isPending && (
        <p className="flex items-center gap-2 border-b border-border-default bg-info-subtle px-2 py-2 text-xs">
          <Spinner /> Starting the roll back…
        </p>
      )}
      {following && (
        <RollBackProgress
          teamId={team.id}
          deploymentId={following.id}
          app={app}
          to={following.to}
          onFinished={refresh}
          onClose={() => setFollowing(null)}
        />
      )}
      <ul className="divide-y divide-border-default text-xs">
        {history.data?.deployments.map((deployment) => (
          <li key={deployment.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
            <span className="w-8 font-mono">#{deployment.number}</span>
            <Badge tone={STATUS[deployment.status].tone}>{STATUS[deployment.status].label}</Badge>
            <span className="text-fg-secondary">
              {deployment.kind === "rollback"
                ? `roll back to #${deployment.rolledBackTo}`
                : "deploy"}
              {" · "}
              {deployment.by ? deployment.by.name : "a pipeline"} ·{" "}
              {formatRelative(deployment.createdAt)}
            </span>
            {deployment.run && (
              <Link
                to={`/pipelines/${deployment.run.pipelineId}/runs/${deployment.run.id}`}
                className="text-info hover:underline"
              >
                run #{deployment.run.number}
              </Link>
            )}
            <button
              type="button"
              className="text-fg-secondary hover:underline"
              onClick={() => setOpenLog(openLog === deployment.id ? null : deployment.id)}
            >
              {openLog === deployment.id ? "Hide log" : "Log"}
            </button>
            {deployment.canRollBackTo && mayRollBack && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                icon={<RotateCcw size={12} />}
                disabled={rollBack.isPending}
                onClick={() => {
                  if (window.confirm(`Put #${deployment.number} back on ${environment.name}?`)) {
                    rollBack.mutate({ id: deployment.id, number: deployment.number });
                  }
                }}
              >
                Roll back to this
              </Button>
            )}
            {deployment.error && <p className="w-full pl-10 text-danger">{deployment.error}</p>}
            {openLog === deployment.id && (
              <div className="w-full">
                <DeploymentLog teamId={team.id} deploymentId={deployment.id} live={false} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {rollBack.error && (
        <p className="px-2 py-1 text-xs text-danger">{vaultErrorMessage(rollBack.error)}</p>
      )}
    </div>
  );
}

function EnvironmentForm({
  team,
  environment,
  onDone,
}: {
  team: TeamMembership;
  environment?: EnvironmentSummary;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const runners = useQuery({
    queryKey: ["runners", team.id],
    queryFn: () => api.runners.list(team.id),
  });
  const [name, setName] = useState(environment?.name ?? "");
  const [runnerId, setRunnerId] = useState(environment?.runner?.id ?? "");
  const [address, setAddress] = useState(environment?.address ?? "");
  const [protectedEnv, setProtected] = useState(environment?.protected ?? false);
  // Each row keeps its own id, so typing a name does not re-create the row.
  const [variables, setVariables] = useState<{ id: number; name: string; value: string }[]>(
    environment?.variables.map((variable, index) => ({
      id: index,
      name: variable.name,
      value: "",
    })) ?? [{ id: 0, name: "", value: "" }],
  );
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        runnerId,
        address: address.trim() || null,
        protected: protectedEnv,
        variables: Object.fromEntries(
          variables
            .filter((variable) => variable.name.trim())
            .map((variable) => [variable.name.trim(), variable.value]),
        ),
      };
      return environment
        ? api.deploys.updateEnvironment(team.id, environment.id, input)
        : api.deploys.createEnvironment(team.id, input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["environments", team.id] });
      onDone();
    },
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const machines = (runners.data?.runners ?? []).filter((runner) => runner.os !== "windows");

  return (
    <form
      className="mb-4 grid gap-3 rounded-md border border-border-default p-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <FieldLabel>Name</FieldLabel>
          <Input
            aria-label="Name"
            value={name}
            placeholder="staging"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <FieldLabel>Machine (with Docker)</FieldLabel>
          <select
            aria-label="Machine"
            className="h-[30px] rounded-md border border-border-default bg-surface px-2 text-sm"
            value={runnerId}
            onChange={(event) => setRunnerId(event.target.value)}
          >
            <option value="">Choose a runner…</option>
            {machines.map((runner) => (
              <option key={runner.id} value={runner.id}>
                {runner.name} ({runner.host})
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <FieldLabel>Public address</FieldLabel>
          <Input
            aria-label="Public address"
            value={address}
            placeholder="35.202.251.235 or apps.example.com"
            onChange={(event) => setAddress(event.target.value)}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={protectedEnv}
          onChange={(event) => setProtected(event.target.checked)}
        />
        Protected: every deploy needs an admin's approval (use for production)
      </label>
      <div className="grid gap-1">
        <FieldLabel>Variables the apps get here</FieldLabel>
        <p className="text-2xs text-fg-muted">
          Type a value, or vault://NAME to take it from the team's Vault.
          {environment && " Leave a value empty to keep the one saved."}
        </p>
        {variables.map((variable, index) => (
          <div key={variable.id} className="flex gap-2">
            <Input
              aria-label="Variable name"
              className="w-56 font-mono"
              placeholder="STRIPE_KEY"
              value={variable.name}
              onChange={(event) =>
                setVariables(
                  variables.map((v, i) => (i === index ? { ...v, name: event.target.value } : v)),
                )
              }
            />
            <Input
              aria-label="Variable value"
              className="font-mono"
              placeholder={environment ? "(unchanged)" : "value or vault://NAME"}
              value={variable.value}
              onChange={(event) =>
                setVariables(
                  variables.map((v, i) => (i === index ? { ...v, value: event.target.value } : v)),
                )
              }
            />
            <IconButton
              size="sm"
              label="Remove variable"
              onClick={() => setVariables(variables.filter((_, i) => i !== index))}
            >
              <Trash2 size={13} />
            </IconButton>
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="w-fit"
          icon={<Plus size={12} />}
          onClick={() =>
            setVariables([
              ...variables,
              { id: Math.max(-1, ...variables.map((v) => v.id)) + 1, name: "", value: "" },
            ])
          }
        >
          Add variable
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={save.isPending || !name.trim() || !runnerId}
        >
          {environment ? "Save" : "Add environment"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function HowTo() {
  return (
    <details className="mt-6 rounded-md border border-border-default p-3 text-xs text-fg-secondary">
      <summary className="cursor-pointer font-medium text-fg">How do I deploy an app?</summary>
      <p className="mt-2">
        The app needs a <code className="font-mono">Dockerfile</code> (ask the agent: "add a
        Dockerfile that serves the app"). Then add a <code className="font-mono">deploy</code> step
        to its pipeline:
      </p>
      <pre className="mt-2 overflow-x-auto rounded bg-surface-subtle p-2 font-mono text-2xs leading-5">{`source:
  app: Shop
stages:
  - name: Test
    steps:
      - checkout: true
      - run: npm ci && npm test
  - name: Staging
    steps:
      - deploy:
          to: staging
          port: 3000          # what the app listens on inside its container
          host-port: 8080     # on the machine (default: the same)
          health: /           # checked after starting; default /`}</pre>
      <p className="mt-2">
        To deploy every change the agent makes, add the trigger{" "}
        <span className="font-medium">When the app changes</span> on the pipeline's Triggers tab.
      </p>
    </details>
  );
}

/** A roll back as it happens: a spinner and its lines, then ✓ or ✗. */
function RollBackProgress({
  teamId,
  deploymentId,
  app,
  to,
  onFinished,
  onClose,
}: {
  teamId: string;
  deploymentId: string;
  app: string;
  to: number;
  onFinished: () => void;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ["deployment", teamId, deploymentId],
    queryFn: () => api.deploys.deployment(teamId, deploymentId),
    refetchInterval: (query) =>
      query.state.data?.deployment.status === "deploying" ? 1000 : false,
  });
  const deployment = detail.data?.deployment;
  const running = !deployment || deployment.status === "deploying";
  const ok = deployment?.status === "live";
  const reported = useRef(false);
  useEffect(() => {
    if (!running && !reported.current) {
      reported.current = true;
      onFinished();
    }
  }, [running, onFinished]);

  return (
    <div
      className={`border-b border-border-default p-2 text-xs ${
        running ? "bg-info-subtle" : ok ? "bg-success-subtle" : "bg-danger-subtle"
      }`}
    >
      <p className="flex items-center gap-2 font-medium">
        {running ? (
          <>
            <Spinner /> Rolling back {app} to #{to}…
          </>
        ) : ok ? (
          <>
            <CheckCircle2 size={14} className="text-success" /> {app} #{to} is live again.
          </>
        ) : (
          <>
            <XCircle size={14} className="text-danger" /> The roll back did not go through.
          </>
        )}
        {!running && (
          <button
            type="button"
            className="ml-auto text-fg-secondary hover:underline"
            onClick={onClose}
          >
            Close
          </button>
        )}
      </p>
      {deployment && <LogLines lines={deployment.log} />}
    </div>
  );
}

/** A deploy's log, read once (or every second while it is still going). */
function DeploymentLog({
  teamId,
  deploymentId,
  live,
}: {
  teamId: string;
  deploymentId: string;
  live: boolean;
}) {
  const detail = useQuery({
    queryKey: ["deployment", teamId, deploymentId],
    queryFn: () => api.deploys.deployment(teamId, deploymentId),
    refetchInterval: (query) =>
      live || query.state.data?.deployment.status === "deploying" ? 1000 : false,
  });
  if (detail.isLoading) return <Spinner className="m-2" />;
  const lines = detail.data?.deployment.log ?? [];
  if (lines.length === 0) {
    return (
      <p className="mt-1 text-fg-muted">
        No log was kept for this one (it is from before logs were kept).
      </p>
    );
  }
  return <LogLines lines={lines} />;
}

function LogLines({ lines }: { lines: { stream: string; text: string }[] }) {
  const box = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new lines
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length]);
  return (
    <div
      ref={box}
      className="mt-1 max-h-64 overflow-auto rounded bg-surface-subtle p-2 font-mono text-2xs leading-[1.6]"
    >
      {lines.map((line, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only
          key={index}
          className={`break-all whitespace-pre-wrap ${
            line.stream === "system"
              ? "font-semibold text-fg-secondary"
              : line.stream === "err"
                ? "text-warning"
                : "text-fg"
          }`}
        >
          {line.text || "\u00a0"}
        </div>
      ))}
    </div>
  );
}
