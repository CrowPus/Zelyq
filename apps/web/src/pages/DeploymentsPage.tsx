import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type DeploymentSummary,
  type EnvironmentHttps,
  type EnvironmentSummary,
  roleAtLeast,
  type TeamMembership,
} from "@zelyq/core";
import {
  Activity,
  CheckCircle2,
  ExternalLink,
  History,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
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

export const STATUS: Record<
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
        {environment.domain && (
          <>
            {" "}
            · apps at <span className="font-mono text-fg">*.{environment.domain}</span>
            {environment.https === "off"
              ? " (HTTP)"
              : environment.https === "internal"
                ? " (Zelyq's certificate)"
                : " (HTTPS)"}
          </>
        )}
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
        <Link
          to={`/deployments/${environment.id}/apps/${encodeURIComponent(deployment.app)}`}
          className="font-medium hover:underline"
        >
          {deployment.app}
        </Link>
        <span className="font-mono text-xs text-fg-secondary">#{deployment.number}</span>
        <Badge tone={STATUS[deployment.status].tone}>{STATUS[deployment.status].label}</Badge>
        <span className="text-xs text-fg-muted">
          {deployment.by ? deployment.by.name : "a pipeline"} ·{" "}
          {formatRelative(deployment.createdAt)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<History size={12} />}
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide history" : "History"}
          </Button>
          <Link
            to={`/deployments/${environment.id}/apps/${encodeURIComponent(deployment.app)}`}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border-default px-2 text-xs font-medium hover:bg-surface-hover"
          >
            <Activity size={12} /> Logs · manage
          </Link>
        </span>
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
      {deployment.error && deployment.status === "live" && (
        <ReachWarning team={team} deployment={deployment} />
      )}
      {open && <HistoryList team={team} environment={environment} app={deployment.app} />}
    </li>
  );
}

/** Why people cannot open a live app yet, with a way to check again once it is fixed. */
export function ReachWarning({
  team,
  deployment,
}: {
  team: TeamMembership;
  deployment: DeploymentSummary;
}) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: () => api.deploys.checkAgain(team.id, deployment.id),
    onSuccess: ({ deployment: checked }) => {
      setResult(checked.error ? "Still not reachable." : null);
      void queryClient.invalidateQueries({ queryKey: ["environments", team.id] });
    },
    onError: (caught) => setResult(vaultErrorMessage(caught)),
  });
  return (
    <div className="mt-1 grid gap-1.5 rounded-md border border-warning/30 bg-warning-subtle p-2 text-xs">
      <p>{deployment.error}</p>
      {roleAtLeast(team.role, "editor") && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            icon={check.isPending ? <Spinner /> : <RefreshCw size={12} />}
            disabled={check.isPending}
            onClick={() => check.mutate()}
          >
            {check.isPending ? "Checking (up to half a minute)…" : "Check again"}
          </Button>
          {result && !check.isPending && <span className="text-fg-secondary">{result}</span>}
        </div>
      )}
    </div>
  );
}

export function HistoryList({
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
                : deployment.kind === "promote"
                  ? deployment.promotedFrom
                    ? `promoted from ${deployment.promotedFrom.environment} #${deployment.promotedFrom.number}`
                    : "promoted"
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
            {deployment.error && (
              <p
                className={`w-full pl-10 ${deployment.status === "failed" ? "text-danger" : "text-warning"}`}
              >
                {deployment.error}
              </p>
            )}
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
  const [domain, setDomain] = useState(environment?.domain ?? "");
  const [https, setHttps] = useState<EnvironmentHttps>(environment?.https ?? "auto");
  const [httpPort, setHttpPort] = useState(String(environment?.httpPort ?? 80));
  const [httpsPort, setHttpsPort] = useState(String(environment?.httpsPort ?? 443));
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
        domain: domain.trim() || null,
        https,
        httpPort: Number(httpPort) || 80,
        httpsPort: Number(httpsPort) || 443,
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
      className="mb-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-md border border-border-default p-3"
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
            className="h-[30px] w-full min-w-0 rounded-md border border-border-default bg-surface px-2 text-sm"
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
      <WebAddresses
        domain={domain}
        onDomain={setDomain}
        https={https}
        onHttps={setHttps}
        httpPort={httpPort}
        onHttpPort={setHttpPort}
        httpsPort={httpsPort}
        onHttpsPort={setHttpsPort}
        pointTo={address.trim() || machines.find((runner) => runner.id === runnerId)?.host || null}
      />
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
          <div key={variable.id} className="flex min-w-0 gap-2">
            <Input
              aria-label="Variable name"
              className="w-32 shrink-0 font-mono sm:w-56"
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
              className="min-w-0 font-mono"
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

const HTTPS_CHOICES: { value: EnvironmentHttps; label: string }[] = [
  { value: "auto", label: "Automatic: a free certificate from Let's Encrypt (recommended)" },
  { value: "internal", label: "Zelyq's own certificate: for testing or a private network" },
  { value: "off", label: "Off: plain HTTP" },
];

/**
 * An environment's domain: apps get <app>.<domain>, with HTTPS, through a
 * proxy Zelyq runs on the machine. Shows the one DNS record to add.
 */
function WebAddresses({
  domain,
  onDomain,
  https,
  onHttps,
  httpPort,
  onHttpPort,
  httpsPort,
  onHttpsPort,
  pointTo,
}: {
  domain: string;
  onDomain: (value: string) => void;
  https: EnvironmentHttps;
  onHttps: (value: EnvironmentHttps) => void;
  httpPort: string;
  onHttpPort: (value: string) => void;
  httpsPort: string;
  onHttpsPort: (value: string) => void;
  pointTo: string | null;
}) {
  const name = domain.trim().toLowerCase();
  // An A record takes an IP address; a name (test.example.com) needs a CNAME.
  const record = !pointTo
    ? { type: "A", value: "the machine's public IP address" }
    : /^\d{1,3}(\.\d{1,3}){3}$/.test(pointTo)
      ? { type: "A", value: pointTo }
      : { type: "CNAME", value: pointTo };
  return (
    <fieldset className="grid min-w-0 gap-2 rounded-md border border-border-default p-3">
      <legend className="px-1">
        <FieldLabel>Web addresses</FieldLabel>
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-xs" htmlFor="environment-domain">
            Domain
          </label>
          <Input
            id="environment-domain"
            value={domain}
            placeholder="staging.example.com"
            spellCheck={false}
            onChange={(event) => onDomain(event.target.value)}
          />
          <p className="text-2xs text-fg-muted">
            {name
              ? `Each app gets its own address: shop.${name}`
              : "Empty: apps are reached at the public address and a port."}
          </p>
        </div>
        {name && (
          <div className="grid gap-1">
            <label className="text-xs" htmlFor="environment-https">
              HTTPS
            </label>
            <select
              id="environment-https"
              className="h-[30px] w-full min-w-0 rounded-md border border-border-default bg-surface px-2 text-sm"
              value={https}
              onChange={(event) => onHttps(event.target.value as EnvironmentHttps)}
            >
              {HTTPS_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {name && (
        <>
          <div className="rounded-md bg-surface-subtle p-2 text-xs">
            <p className="mb-1 font-medium">Add one DNS record where your domain is managed:</p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-2xs">
              <dt className="text-fg-muted">Type</dt>
              <dd>{record.type}</dd>
              <dt className="text-fg-muted">Name</dt>
              <dd className="break-all">*.{name}</dd>
              <dt className="text-fg-muted">Value</dt>
              <dd className="break-all">{record.value}</dd>
            </dl>
            {record.type === "CNAME" && (
              <p className="mt-1 text-fg-secondary">
                Or an A record with the machine's IP address as the value: an A record takes only an
                IP.
              </p>
            )}
            <p className="mt-1 text-fg-secondary">
              {https === "auto"
                ? "Ports 80 and 443 must be open on the machine; certificates then come by themselves."
                : "Open the proxy ports below on the machine."}
            </p>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-fg-secondary">Proxy ports (advanced)</summary>
            <div className="mt-2 flex flex-wrap gap-3">
              <div className="grid gap-1">
                <label htmlFor="proxy-httpport">HTTP</label>
                <Input
                  id="proxy-httpport"
                  className="w-24"
                  inputMode="numeric"
                  value={httpPort}
                  onChange={(event) => onHttpPort(event.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <label htmlFor="proxy-httpsport">HTTPS</label>
                <Input
                  id="proxy-httpsport"
                  className="w-24"
                  inputMode="numeric"
                  value={httpsPort}
                  onChange={(event) => onHttpsPort(event.target.value)}
                />
              </div>
            </div>
            <p className="mt-1 text-fg-muted">
              Change them only if another web server already uses 80 and 443 on the machine.
              Automatic certificates need 80 and 443.
            </p>
          </details>
        </>
      )}
    </fieldset>
  );
}

function HowTo() {
  return (
    <details className="mt-6 rounded-md border border-border-default p-3 text-xs text-fg-secondary">
      <summary className="cursor-pointer font-medium text-fg">How do I deploy an app?</summary>
      <p className="mt-2">
        Add a <code className="font-mono">deploy</code> step to the app's pipeline. No Dockerfile is
        needed: Zelyq recognises Node, Python, Go and static sites and builds them (the app's own{" "}
        <code className="font-mono">Dockerfile</code> is used when it has one).
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
          health: /           # checked after starting; default /`}</pre>
      <p className="mt-2">
        With a domain on the environment, the app is at{" "}
        <code className="font-mono">https://&lt;app&gt;.&lt;domain&gt;</code>, and a new version
        replaces the old one without downtime. Without one, add{" "}
        <code className="font-mono">host-port: 8080</code> and it is at the public address and that
        port.
      </p>
      <p className="mt-2">
        To deploy every change the agent makes, add the trigger{" "}
        <span className="font-medium">When the app changes</span> on the pipeline's Triggers tab.
      </p>
    </details>
  );
}

/** A roll back as it happens: a spinner and its lines, then ✓ or ✗. */
export function RollBackProgress({
  teamId,
  deploymentId,
  app,
  to,
  onFinished,
  onClose,
  words = {
    running: `Rolling back ${app} to #${to}…`,
    ok: `${app} #${to} is live again.`,
    failed: "The roll back did not go through.",
  },
}: {
  teamId: string;
  deploymentId: string;
  app: string;
  to: number;
  onFinished: () => void;
  onClose: () => void;
  /** What to say while it runs, and after. */
  words?: { running: string; ok: string; failed: string };
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
            <Spinner /> {words.running}
          </>
        ) : ok ? (
          <>
            <CheckCircle2 size={14} className="text-success" /> {words.ok}
          </>
        ) : (
          <>
            <XCircle size={14} className="text-danger" /> {words.failed}
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

export function LogLines({ lines }: { lines: { stream: string; text: string }[] }) {
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
