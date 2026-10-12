import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AppAction,
  type AppStatus,
  type EnvironmentSummary,
  roleAtLeast,
  type TeamMembership,
} from "@zelyq/core";
import {
  Activity,
  ArrowUpRight,
  Copy,
  Cpu,
  ExternalLink,
  Globe,
  MemoryStick,
  Play,
  RotateCw,
  Square,
  Timer,
  Trash2,
  Wand2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Badge, Button, EmptyState, Input, Spinner, StatTile } from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { api } from "../lib/api";
import { formatRelative, vaultErrorMessage } from "../lib/vault";
import { DnsRecord, HistoryList, ReachWarning, RollBackProgress } from "./DeploymentsPage";

const STATE: Record<
  AppStatus["state"],
  { label: string; tone: "success" | "danger" | "warning" | "neutral" }
> = {
  running: { label: "Running", tone: "success" },
  restarting: { label: "Restarting", tone: "warning" },
  stopped: { label: "Stopped", tone: "neutral" },
  missing: { label: "Not on the machine", tone: "danger" },
};

/** Lines kept on screen; older ones scroll away. */
const KEEP_LINES = 2000;

type LogLine = AppStatus["logs"][number] | { at: string; stream: "system"; text: string };

/**
 * One app on one environment: what its container is doing now (CPU, memory,
 * its output as it happens), restart and stop, promote the same image to
 * another environment, and its history.
 */
export function AppPage() {
  const { environmentId = "", app = "" } = useParams();
  const { team } = useActiveTeam();
  const environments = useQuery({
    queryKey: ["environments", team?.id],
    queryFn: () => api.deploys.environments(team?.id ?? ""),
    enabled: Boolean(team),
    refetchInterval: 10_000,
  });
  const environment = environments.data?.environments.find((env) => env.id === environmentId);

  return (
    <AppShell
      crumbs={[
        { label: "Deployments", to: "/deployments" },
        { label: environment ? `${app} on ${environment.name}` : app },
      ]}
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
          {!team || environments.isLoading ? (
            <Spinner />
          ) : !environment ? (
            <EmptyState
              title="No such environment"
              description="It may have been removed. Go back to Deployments."
            />
          ) : (
            <LiveAppView
              key={`${environment.id}/${app}`}
              team={team}
              app={app}
              environment={environment}
              others={(environments.data?.environments ?? []).filter(
                (env) => env.id !== environment.id,
              )}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function LiveAppView({
  team,
  app,
  environment,
  others,
}: {
  team: TeamMembership;
  app: string;
  environment: EnvironmentSummary;
  others: EnvironmentSummary[];
}) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const cursor = useRef<string | null>(null);
  const shown = useRef<string | null>(null);

  // Asks the machine every few seconds, for new lines only.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const { status: now } = await api.deploys.app(
            team.id,
            environment.id,
            app,
            cursor.current,
          );
          if (stopped) return;
          setStatus(now);
          setProblem(null);
          const live = now.deployment;
          const fresh: LogLine[] = [];
          // A new deploy went live while the page was open.
          if (live && shown.current && shown.current !== live.id) {
            fresh.push({
              at: new Date().toISOString(),
              stream: "system",
              text: `#${live.number} is live now.`,
            });
          }
          shown.current = live?.id ?? null;
          fresh.push(...now.logs);
          if (fresh.length > 0) setLines((before) => [...before, ...fresh].slice(-KEEP_LINES));
          cursor.current = now.cursor;
        } catch (caught) {
          if (!stopped) setProblem(vaultErrorMessage(caught));
        }
      }
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [team.id, environment.id, app]);

  const mayManage = roleAtLeast(team.role, environment.protected ? "admin" : "editor");
  const act = useMutation({
    mutationFn: (action: AppAction) => api.deploys.appAction(team.id, environment.id, app, action),
    onSuccess: ({ status: now }, action) => {
      // The log keeps its own place; only the state is taken from the answer.
      setStatus((before) => (before ? { ...now, logs: [], cursor: before.cursor } : now));
      setLines((before) =>
        [
          ...before,
          {
            at: new Date().toISOString(),
            stream: "system" as const,
            text: action === "restart" ? "Restarted." : action === "stop" ? "Stopped." : "Started.",
          },
        ].slice(-KEEP_LINES),
      );
    },
  });

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: (forget: boolean) => api.deploys.removeApp(team.id, environment.id, app, forget),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["environments", team.id] });
      navigate("/deployments");
    },
  });

  const deployment = status?.deployment ?? null;
  if (!status) {
    return problem ? (
      <p className="text-sm text-danger">{problem}</p>
    ) : (
      <p className="flex items-center gap-2 text-sm text-fg-secondary">
        <Spinner /> Asking the machine…
      </p>
    );
  }
  if (!deployment) {
    return (
      <EmptyState
        title={`${app} is not live on ${environment.name}`}
        description="Nothing of it runs there now. A pipeline's deploy step puts it there."
      />
    );
  }
  const state = STATE[status.state];
  const memoryShare =
    status.memoryBytes !== null && status.memoryLimitBytes
      ? Math.min(1, status.memoryBytes / status.memoryLimitBytes)
      : null;

  return (
    <div className="grid min-w-0 gap-5">
      <header className="grid min-w-0 gap-1">
        <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          <Activity size={18} strokeWidth={1.75} /> {app}
          <span className="font-normal text-fg-secondary">on {environment.name}</span>
          <Badge tone={state.tone}>{state.label}</Badge>
        </h1>
        <p className="text-xs text-fg-secondary">
          #{deployment.number}
          {deployment.kind === "promote" && deployment.promotedFrom
            ? `, promoted from ${deployment.promotedFrom.environment} #${deployment.promotedFrom.number}`
            : deployment.kind === "rollback"
              ? `, a roll back to #${deployment.rolledBackTo}`
              : ""}
          {" · "}
          {deployment.by ? deployment.by.name : "a pipeline"},{" "}
          {formatRelative(deployment.createdAt)}
          {deployment.run && (
            <>
              {" · "}
              <Link
                to={`/pipelines/${deployment.run.pipelineId}/runs/${deployment.run.id}`}
                className="text-info hover:underline"
              >
                run #{deployment.run.number}
              </Link>
            </>
          )}
        </p>
        {deployment.url && (
          <a
            href={deployment.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit max-w-full items-center gap-1 text-sm break-all text-info hover:underline"
          >
            {deployment.url} <ExternalLink size={12} className="shrink-0" />
          </a>
        )}
        {deployment.error && <ReachWarning team={team} deployment={deployment} />}
        {status.state === "missing" && (
          <p className="text-xs text-danger">
            Its container is gone from the machine (removed by hand?). Deploy it again, or roll back
            below.
          </p>
        )}
      </header>

      {mayManage && (
        <div className="flex flex-wrap items-center gap-2">
          {status.state !== "missing" && (
            <Button
              icon={
                act.isPending && act.variables === "restart" ? <Spinner /> : <RotateCw size={13} />
              }
              disabled={act.isPending}
              onClick={() => act.mutate("restart")}
            >
              Restart
            </Button>
          )}
          {status.state === "missing" ? null : status.state === "stopped" ? (
            <Button
              icon={act.isPending ? <Spinner /> : <Play size={13} />}
              disabled={act.isPending}
              onClick={() => act.mutate("start")}
            >
              Start
            </Button>
          ) : (
            <Button
              variant="danger"
              icon={act.isPending && act.variables === "stop" ? <Spinner /> : <Square size={13} />}
              disabled={act.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Stop ${app} on ${environment.name}? People cannot open it until it is started again (it also stays stopped after the machine restarts).`,
                  )
                )
                  act.mutate("stop");
              }}
            >
              Stop
            </Button>
          )}
          <Button
            variant="danger"
            className="ml-auto"
            icon={remove.isPending ? <Spinner /> : <Trash2 size={13} />}
            disabled={remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Remove ${app} from ${environment.name}? Zelyq stops it and removes its containers, its address on the proxy and its images from the machine. Its history stays.`,
                )
              )
                remove.mutate(false);
            }}
          >
            Remove app
          </Button>
          {act.error && <span className="text-xs text-danger">{vaultErrorMessage(act.error)}</span>}
        </div>
      )}
      {remove.error && (
        <div className="grid gap-1 text-xs">
          <p className="text-danger">{vaultErrorMessage(remove.error)}</p>
          <p className="text-fg-secondary">
            If the machine is gone for good,{" "}
            <button
              type="button"
              className="text-info hover:underline"
              onClick={() => {
                if (
                  window.confirm(
                    `Forget ${app} on ${environment.name}, without touching the machine?`,
                  )
                )
                  remove.mutate(true);
              }}
            >
              forget the app in Zelyq only
            </button>
            .
          </p>
        </div>
      )}

      <AppAddress
        team={team}
        app={app}
        environment={environment}
        status={status}
        mayManage={mayManage}
        onSaved={(deployment) =>
          setStatus((before) =>
            before ? { ...before, deployment: deployment ?? before.deployment } : before,
          )
        }
      />

      <section className="grid grid-cols-2 gap-4 rounded-md border border-border-default p-3 md:grid-cols-4">
        <StatTile
          icon={<Cpu size={15} />}
          label="CPU"
          value={status.cpuPercent === null ? "–" : `${status.cpuPercent.toFixed(1)}%`}
          hint="100% = one core"
        />
        <StatTile
          icon={<MemoryStick size={15} />}
          label="Memory"
          value={status.memoryBytes === null ? "–" : size(status.memoryBytes)}
          hint={
            memoryShare === null ? undefined : (
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-12 overflow-hidden rounded-full bg-surface-subtle">
                  <span
                    className={`block h-full rounded-full ${memoryShare > 0.85 ? "bg-danger" : "bg-fg-secondary"}`}
                    style={{ width: `${Math.max(2, memoryShare * 100)}%` }}
                  />
                </span>
                of {size(status.memoryLimitBytes ?? 0)}
              </span>
            )
          }
        />
        <StatTile
          icon={<Timer size={15} />}
          label="Started"
          value={
            status.state === "running" && status.startedAt ? formatRelative(status.startedAt) : "–"
          }
        />
        <StatTile
          icon={<RotateCw size={15} />}
          label="Crashes"
          value={status.restarts}
          hint={status.restarts > 0 ? "Restarted by itself" : "None so far"}
        />
      </section>

      <section className="grid min-w-0 gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          Logs
          <span className="flex items-center gap-1 text-xs font-normal text-fg-muted">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            live, the app's own output
          </span>
        </h2>
        {problem && <p className="text-xs text-warning">{problem} Trying again…</p>}
        <LiveLog lines={lines} />
      </section>

      {others.length > 0 && mayPromoteSomewhere(team, others) && (
        <Promote team={team} app={app} deploymentId={deployment.id} others={others} />
      )}

      <section className="grid min-w-0 gap-1">
        <h2 className="text-sm font-semibold">History · roll back</h2>
        <HistoryList team={team} environment={environment} app={app} />
      </section>
    </div>
  );
}

/**
 * The exact name people use for the app: example.com, www.example.com,
 * shop.example.com. Saved, it takes effect at once when the app is reached
 * by name, and the page shows the DNS record (and, behind the machine's own
 * web server, the lines to add to it).
 */
function AppAddress({
  team,
  app,
  environment,
  status,
  mayManage,
  onSaved,
}: {
  team: TeamMembership;
  app: string;
  environment: EnvironmentSummary;
  status: AppStatus;
  mayManage: boolean;
  onSaved: (deployment: AppStatus["deployment"]) => void;
}) {
  const queryClient = useQueryClient();
  const saved = status.address;
  const [domain, setDomain] = useState(saved.domain ?? "");
  const [www, setWww] = useState(saved.www);
  const [note, setNote] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (input: { domain: string | null; www: boolean }) =>
      api.deploys.setAddress(team.id, environment.id, app, input),
    onSuccess: ({ applied, deployment }, input) => {
      onSaved(deployment);
      void queryClient.invalidateQueries({ queryKey: ["environments", team.id] });
      setNote(
        applied
          ? input.domain
            ? `Saved: people are sent to ${input.domain} now.`
            : "Saved: it is back at its usual address."
          : "Saved. It is used from the next deploy.",
      );
    },
    onError: () => setNote(null),
  });
  const name = domain.trim().toLowerCase();
  const changed = name !== (saved.domain ?? "") || (Boolean(name) && www !== saved.www);
  // The name the app answers to now, for the DNS record and the web server's lines.
  const url = status.deployment?.url ? new URL(status.deployment.url) : null;
  const current =
    saved.domain ?? (url && !/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) ? url.hostname : null);
  const pointTo = environment.address ?? environment.runner?.host ?? null;
  return (
    <section className="grid min-w-0 gap-2 rounded-md border border-border-default p-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Globe size={15} /> Address
      </h2>
      {mayManage ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setNote(null);
            save.mutate({ domain: name || null, www: Boolean(name) && www });
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Address"
              className="w-72 max-w-full"
              value={domain}
              placeholder="example.com"
              spellCheck={false}
              onChange={(event) => setDomain(event.target.value)}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={!changed || save.isPending}
              icon={save.isPending ? <Spinner /> : undefined}
            >
              Save
            </Button>
            {saved.domain && (
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setDomain("");
                  setNote(null);
                  save.mutate({ domain: null, www: false });
                }}
              >
                Use the usual one
              </Button>
            )}
          </div>
          {name && !name.startsWith("www.") && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={www}
                onChange={(event) => setWww(event.target.checked)}
              />
              Also www.{name}, sending people on to {name}
            </label>
          )}
          <p className="text-2xs text-fg-muted">
            The exact name people type: the domain itself (example.com) or any name under it.
            {environment.domain
              ? ` Empty: ${app}.${environment.domain}.`
              : " Empty: the machine's address and a port."}
          </p>
        </form>
      ) : (
        <p className="text-xs">{saved.domain ?? "The usual one."}</p>
      )}
      {save.error && <p className="text-xs text-danger">{vaultErrorMessage(save.error)}</p>}
      {note && <p className="text-xs text-success">{note}</p>}
      {current && (
        <DnsRecord name={current} pointTo={pointTo}>
          {saved.domain && saved.www && (
            <p className="mt-1 text-fg-secondary">And the same record for www.{saved.domain}.</p>
          )}
          <p className="mt-1 text-fg-secondary">
            For the domain itself, the name is often written @ at your DNS provider.
          </p>
        </DnsRecord>
      )}
      {current && environment.https === "external" && (
        <WebServerLines
          names={[current, ...(saved.domain === current && saved.www ? [`www.${current}`] : [])]}
          port={environment.httpPort}
          machine={environment.runner?.name ?? "the machine"}
          setUp={
            mayManage && status.deployment
              ? () => api.deploys.setUpWebServer(team.id, environment.id, app)
              : null
          }
          onSetUp={(deployment) => {
            onSaved(deployment);
            void queryClient.invalidateQueries({ queryKey: ["environments", team.id] });
          }}
        />
      )}
    </section>
  );
}

/** What to paste on a machine whose own nginx is in front of Zelyq's proxy. */
function WebServerLines({
  names,
  port,
  machine,
  setUp,
  onSetUp,
}: {
  names: string[];
  port: number;
  machine: string;
  /** Zelyq does it over SSH, when the person may. */
  setUp: (() => Promise<{ log: string[]; deployment: AppStatus["deployment"] }>) | null;
  onSetUp: (deployment: AppStatus["deployment"]) => void;
}) {
  const run = useMutation({
    mutationFn: () => (setUp ? setUp() : Promise.reject(new Error("Not allowed."))),
    onSuccess: ({ deployment }) => onSetUp(deployment),
  });
  const [first] = names;
  const file = `/etc/nginx/sites-available/${first}`;
  const lines = [
    `sudo tee ${file} >/dev/null <<'EOF'`,
    "server {",
    "    listen 80;",
    `    server_name ${names.join(" ")};`,
    "    location / {",
    `        proxy_pass http://127.0.0.1:${port};`,
    "        proxy_set_header Host $host;",
    "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "        proxy_set_header X-Forwarded-Proto $scheme;",
    "        proxy_http_version 1.1;",
    "        proxy_set_header Upgrade $http_upgrade;",
    "        proxy_set_header Connection $http_connection;",
    "    }",
    "}",
    "EOF",
    `sudo ln -sf ${file} /etc/nginx/sites-enabled/`,
    "sudo nginx -t && sudo systemctl reload nginx",
    `sudo certbot --nginx ${names.map((name) => `-d ${name}`).join(" ")}`,
  ].join("\n");
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid min-w-0 gap-1 text-xs">
      {setUp && (
        <div className="grid gap-1.5 rounded-md border border-border-default p-2">
          <p>
            Your nginx on {machine} must send {names.join(" and ")} to Zelyq. Zelyq can do it for
            you: it adds a site of its own (your other sites are not touched), checks it, reloads
            nginx and gets the HTTPS certificate.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={run.isPending ? <Spinner /> : <Wand2 size={13} />}
              disabled={run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending ? "Setting up (up to a few minutes)…" : "Set it up for me"}
            </Button>
          </div>
          {run.data && (
            <div className="grid gap-1">
              <p className={run.data.deployment?.error ? "text-warning" : "text-success"}>
                {run.data.deployment?.error ?? `Done: ${names[0]} opens with HTTPS.`}
              </p>
              {run.data.log.length > 0 && (
                <pre className="overflow-x-auto rounded bg-surface-subtle p-2 font-mono text-2xs">
                  {run.data.log.join("\n")}
                </pre>
              )}
            </div>
          )}
          {run.error && (
            <p className="whitespace-pre-wrap text-danger">{vaultErrorMessage(run.error)}</p>
          )}
        </div>
      )}
      <p className="font-medium">
        {setUp ? "Or do it yourself: paste" : "Paste"} this in a terminal on {machine}:
      </p>
      <div className="relative min-w-0">
        <pre className="overflow-x-auto rounded-md bg-surface-subtle p-2 pr-16 font-mono text-2xs leading-[1.6]">
          {lines}
        </pre>
        <Button
          size="sm"
          className="absolute top-1.5 right-1.5"
          icon={<Copy size={12} />}
          onClick={() => {
            void navigator.clipboard?.writeText(lines).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-fg-muted">
        The last line gets the HTTPS certificate. Apache instead: ProxyPreserveHost On and ProxyPass
        / http://127.0.0.1:{port}/ in the site's VirtualHost.
      </p>
    </div>
  );
}

function mayPromoteSomewhere(
  team: TeamMembership,
  others: { protected: boolean; frozen: boolean }[],
): boolean {
  return others.some(
    (env) => !env.frozen && roleAtLeast(team.role, env.protected ? "admin" : "editor"),
  );
}

/** Ships the image that is live here, as it is, to another environment. */
function Promote({
  team,
  app,
  deploymentId,
  others,
}: {
  team: TeamMembership;
  app: string;
  deploymentId: string;
  others: EnvironmentSummary[];
}) {
  const choices = others.filter(
    (env) => !env.frozen && roleAtLeast(team.role, env.protected ? "admin" : "editor"),
  );
  const [target, setTarget] = useState(choices[0]?.id ?? "");
  const [following, setFollowing] = useState<{ id: string; number: number; env: string } | null>(
    null,
  );
  const queryClient = useQueryClient();
  const promote = useMutation({
    mutationFn: (environmentId: string) =>
      api.deploys.promote(team.id, deploymentId, environmentId),
    onSuccess: ({ deployment }) => {
      const env = others.find((other) => other.id === deployment.environmentId);
      setFollowing({ id: deployment.id, number: deployment.number, env: env?.name ?? "" });
    },
  });
  const chosen = choices.find((env) => env.id === target);
  return (
    <section className="grid min-w-0 gap-2 rounded-md border border-border-default p-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <ArrowUpRight size={15} /> Promote
      </h2>
      <p className="text-xs text-fg-secondary">
        Ships the image running here, as it is, to another environment: nothing is built again, so
        what runs there is what you tested here. Only that environment's own variables differ.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Environment to promote to"
          className="h-[30px] min-w-0 rounded-md border border-border-default bg-surface px-2 text-sm"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          {choices.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </select>
        <Button
          variant="primary"
          icon={promote.isPending ? <Spinner /> : <ArrowUpRight size={13} />}
          disabled={!chosen || promote.isPending}
          onClick={() => {
            if (chosen && window.confirm(`Ship this exact image of ${app} to ${chosen.name}?`)) {
              promote.mutate(chosen.id);
            }
          }}
        >
          Promote to {chosen?.name ?? "…"}
        </Button>
      </div>
      {promote.error && <p className="text-xs text-danger">{vaultErrorMessage(promote.error)}</p>}
      {following && (
        <div className="overflow-hidden rounded border border-border-default">
          <RollBackProgress
            teamId={team.id}
            deploymentId={following.id}
            app={app}
            to={following.number}
            onFinished={() =>
              void queryClient.invalidateQueries({ queryKey: ["environments", team.id] })
            }
            onClose={() => setFollowing(null)}
            words={{
              running: `Promoting ${app} to ${following.env}…`,
              ok: `${app} #${following.number} is live on ${following.env}.`,
              failed: `The promote to ${following.env} did not go through. What was running there is still running.`,
            }}
          />
          <p className="px-2 py-1.5 text-xs">
            <Link
              to={`/deployments/${others.find((env) => env.name === following.env)?.id ?? ""}/apps/${encodeURIComponent(app)}`}
              className="text-info hover:underline"
            >
              Open {app} on {following.env}
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}

/** The app's output, following the newest line unless you scroll up to read. */
function LiveLog({ lines }: { lines: LogLine[] }) {
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new lines
  useEffect(() => {
    if (box.current && atBottom.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);
  return (
    <div
      ref={box}
      onScroll={(event) => {
        const el = event.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="h-96 min-w-0 overflow-auto rounded-md bg-surface-subtle p-2 font-mono text-2xs leading-[1.6]"
    >
      {lines.length === 0 ? (
        <p className="text-fg-muted">
          No output yet. New lines appear here as the app writes them.
        </p>
      ) : (
        lines.map((line, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only
            key={index}
            className="flex gap-2"
          >
            <span className="shrink-0 text-fg-muted select-none">{clock(line.at)}</span>
            <span
              className={`min-w-0 break-all whitespace-pre-wrap ${
                line.stream === "system"
                  ? "font-semibold text-fg-secondary"
                  : line.stream === "err"
                    ? "text-warning"
                    : "text-fg"
              }`}
            >
              {line.text || " "}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function clock(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour12: false });
}

function size(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
