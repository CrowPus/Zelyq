import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AGENT_PERMISSIONS, type Agent, type AgentPermission, roleAtLeast } from "@zelyq/core";
import { Bot, Pencil, Plus, RefreshCw, ShieldOff, Trash2 } from "lucide-react";
import { useState } from "react";
import { AppShell } from "../components/AppShell";
import { AgentForm, type AgentFormValue } from "../components/agents/AgentForm";
import { AgentRequests, forAgentsPage, WaitingElsewhere } from "../components/agents/AgentRequests";
import { ConnectAgent, CopyBlock, gatewayUrl } from "../components/agents/ConnectAgent";
import { Pager, pageOf, useListParams } from "../components/ListControls";
import { Badge, Button, EmptyState, IconButton, Spinner } from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { api } from "../lib/api";

/**
 * Agents: outside AI agents (Claude Code, Cursor, Gemini CLI, any MCP client)
 * working on the team's apps through Zelyq's agent gateway. The agent thinks
 * on its own subscription; Zelyq lends it hands — only on the apps, and only
 * with the permissions, given here.
 */
export function AgentsPage() {
  const queryClient = useQueryClient();
  const { team } = useActiveTeam();
  const teamId = team?.id ?? "";
  const canAdmin = team ? roleAtLeast(team.role, "admin") : false;

  const [mode, setMode] = useState<{ kind: "create" } | { kind: "edit"; agent: Agent } | null>(
    null,
  );
  const [shown, setShown] = useState<{ name: string; key: string } | null>(null);

  const agents = useQuery({
    queryKey: ["agents", teamId],
    queryFn: () => api.agents.list(teamId),
    enabled: Boolean(teamId) && canAdmin,
  });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const apps = (projects.data?.projects ?? []).filter((project) => project.teamId === teamId);
  const appNames = new Map(apps.map((app) => [app.id, app.name]));
  const pipelineList = useQuery({
    queryKey: ["pipelines", teamId],
    queryFn: () => api.pipelines.list(teamId),
    enabled: Boolean(teamId) && canAdmin,
  });
  const environmentList = useQuery({
    queryKey: ["environments", teamId],
    queryFn: () => api.deploys.environments(teamId),
    enabled: Boolean(teamId) && canAdmin,
  });
  const vaultChoices = useQuery({
    queryKey: ["vault-choices", teamId],
    queryFn: () => api.vault.choices({ kind: "team", teamId }),
    enabled: Boolean(teamId) && canAdmin,
  });
  const secrets = (vaultChoices.data?.choices ?? []).map((choice) => choice.name);
  const pipelines = (pipelineList.data?.pipelines ?? []).map((p) => ({ id: p.id, name: p.name }));
  const environments = (environmentList.data?.environments ?? []).map((e) => ({
    id: e.id,
    name: e.name,
  }));
  const names = new Map([
    ...appNames,
    ...pipelines.map((p) => [p.id, p.name] as const),
    ...environments.map((e) => [e.id, e.name] as const),
  ]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["agents", teamId] });
  const create = useMutation({
    mutationFn: (value: AgentFormValue) => api.agents.create(teamId, value),
    onSuccess: async (created) => {
      setMode(null);
      setShown({ name: created.agent.name, key: created.key });
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: (input: { id: string; value: AgentFormValue }) =>
      api.agents.update(teamId, input.id, input.value),
    onSuccess: async () => {
      setMode(null);
      await refresh();
    },
  });

  const list = useListParams(`agents.${teamId || "none"}`, []);
  const all = agents.data?.agents ?? [];
  const { rows, page } = pageOf(all, list.page);

  return (
    <AppShell
      crumbs={[{ label: "Agents" }]}
      actions={
        canAdmin && !mode ? (
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={13} strokeWidth={2} />}
            onClick={() => {
              setShown(null);
              setMode({ kind: "create" });
            }}
          >
            New agent
          </Button>
        ) : undefined
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          <h1 className="text-xl font-semibold text-fg">Agents</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-fg-secondary">
            Let Claude Code, Cursor, Gemini CLI or any MCP client work on your apps. The agent uses
            its own model and subscription — Zelyq lends it hands, only on the apps and with the
            permissions you give it. What needs your approval waits where it is used: runs in
            Pipelines, deployment changes in Deployments, videos in Video Studio.
          </p>

          <div className="mt-4 max-w-xl">
            <p className="mb-1 text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
              Gateway address
            </p>
            <CopyBlock value={gatewayUrl()} label="Copy address" />
          </div>

          <div className="mt-6">
            {teamId && <WaitingElsewhere teamId={teamId} />}
            {teamId && (
              <AgentRequests
                teamId={teamId}
                canDecide={canAdmin}
                appNames={appNames}
                only={forAgentsPage}
              />
            )}

            {shown && (
              <ConnectAgent name={shown.name} agentKey={shown.key} onClose={() => setShown(null)} />
            )}

            {mode && (
              <AgentForm
                key={mode.kind === "edit" ? mode.agent.id : "new"}
                {...(mode.kind === "edit" ? { initial: mode.agent } : {})}
                apps={apps}
                pipelines={pipelines}
                environments={environments}
                secrets={secrets}
                submitLabel={mode.kind === "edit" ? "Save" : "Create agent"}
                busy={create.isPending || update.isPending}
                error={((create.error ?? update.error) as Error | null)?.message ?? null}
                onCancel={() => setMode(null)}
                onSubmit={(value) =>
                  mode.kind === "edit"
                    ? update.mutate({ id: mode.agent.id, value })
                    : create.mutate(value)
                }
              />
            )}

            {!canAdmin && (
              <p className="rounded-lg border border-border-default bg-surface px-4 py-6 text-xs text-fg-secondary">
                Only the team's admins and owners manage agents, because an agent's key can change
                every app it is given. You can still see what agents asked to be approved above.
              </p>
            )}

            {canAdmin && agents.isLoading && (
              <div className="flex items-center gap-2 py-6 text-xs text-fg-muted">
                <Spinner /> Loading agents…
              </div>
            )}

            {canAdmin && !agents.isLoading && all.length === 0 && !mode && (
              <div className="rounded-lg border border-border-default bg-surface">
                <EmptyState
                  title="No agents yet"
                  description="Create one, paste its key into Claude Code (or any MCP client), and it can work on the apps you choose — on its own tokens, not Zelyq's."
                  action={
                    <Button
                      variant="primary"
                      icon={<Plus size={13} strokeWidth={2} />}
                      onClick={() => setMode({ kind: "create" })}
                    >
                      New agent
                    </Button>
                  }
                />
              </div>
            )}

            {canAdmin && rows.length > 0 && (
              <ul className="divide-y divide-border-default overflow-hidden rounded-lg border border-border-default bg-surface">
                {rows.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    teamId={teamId}
                    agent={agent}
                    appNames={names}
                    onEdit={() => {
                      setShown(null);
                      setMode({ kind: "edit", agent });
                    }}
                    onNewKey={(key) => setShown({ name: agent.name, key })}
                    onChanged={refresh}
                  />
                ))}
              </ul>
            )}
            {canAdmin && (
              <Pager
                page={page}
                total={all.length}
                noun="agents"
                all={all.length}
                onPage={(n) => list.set({ page: String(n) })}
              />
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function AgentRow({
  teamId,
  agent,
  appNames,
  onEdit,
  onNewKey,
  onChanged,
}: {
  teamId: string;
  agent: Agent;
  appNames: Map<string, string>;
  onEdit: () => void;
  onNewKey: (key: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const [confirm, setConfirm] = useState<"rotate" | "revoke" | "delete" | null>(null);
  const rotate = useMutation({
    mutationFn: () => api.agents.rotate(teamId, agent.id),
    onSuccess: async (created) => {
      onNewKey(created.key);
      await onChanged();
    },
  });
  const revoke = useMutation({
    mutationFn: () => api.agents.revoke(teamId, agent.id),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => api.agents.remove(teamId, agent.id),
    onSuccess: onChanged,
  });
  const active = !agent.revokedAt;
  const scope = (ids: string[] | null, every: string, noun: string) =>
    ids === null
      ? every
      : ids.length === 0
        ? `no ${noun}`
        : ids
            .map((id) => appNames.get(id))
            .filter(Boolean)
            .join(", ") || `no ${noun} left`;
  const apps = scope(agent.projectIds, "Every app", "apps");
  const reach = [
    agent.permissions["pipelines.write"] !== "off" || agent.permissions["pipelines.run"] !== "off"
      ? `pipelines: ${scope(agent.pipelineIds, "every", "pipelines yet")}`
      : null,
    agent.permissions["deploy.manage"] !== "off"
      ? `environments: ${scope(agent.environmentIds, "every", "environments")}`
      : null,
  ].filter(Boolean);
  const asks = Object.entries(agent.permissions)
    .filter(([, level]) => level === "approve")
    .map(([name]) => AGENT_PERMISSIONS[name as AgentPermission]?.label.toLowerCase() ?? name);
  // Connectors (Claude.ai, ChatGPT) signed in as this agent.
  const connections = useQuery({
    queryKey: ["agent-connections", teamId, agent.id],
    queryFn: () => api.agents.connections(teamId, agent.id),
    enabled: active,
  });
  const disconnect = useMutation({
    mutationFn: () => api.agents.disconnect(teamId, agent.id),
    onSuccess: () => connections.refetch(),
  });
  const signedIn = connections.data?.connections ?? [];
  const error = rotate.error ?? revoke.error ?? remove.error ?? disconnect.error;

  return (
    <li className={`px-4 py-3 ${active ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <Bot size={15} strokeWidth={1.75} className="text-fg-muted" />
            <span className="text-sm font-medium text-fg">{agent.name}</span>
            <code className="text-2xs text-fg-muted">{agent.keyPrefix}…</code>
            <Badge tone={active ? "success" : "danger"}>{active ? "active" : "revoked"}</Badge>
          </p>
          {agent.job && (
            <p className="mt-0.5 line-clamp-2 text-xs text-fg-secondary">{agent.job}</p>
          )}
          <p className="mt-0.5 text-2xs text-fg-muted">
            {apps}
            {reach.length > 0 ? ` · ${reach.join(" · ")}` : ""}
            {asks.length > 0 ? ` · asks before: ${asks.join(", ")}` : ""}
            {" · "}
            {agent.lastUsedAt
              ? `last used ${new Date(agent.lastUsedAt).toLocaleString()} from ${agent.lastUsedIp}`
              : "never used"}
          </p>
          {signedIn.length > 0 && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-fg-muted">
              Signed in through {signedIn.map((connection) => connection.name).join(", ")}
              <button
                type="button"
                className="text-fg-secondary underline underline-offset-2 hover:text-fg"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Sign out connectors
              </button>
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-0.5">
          {active && (
            <>
              <IconButton size="sm" label={`Edit ${agent.name}`} onClick={onEdit}>
                <Pencil size={13} strokeWidth={1.75} />
              </IconButton>
              <IconButton
                size="sm"
                label={`New key for ${agent.name}`}
                onClick={() => setConfirm("rotate")}
              >
                <RefreshCw size={13} strokeWidth={1.75} />
              </IconButton>
              <IconButton
                size="sm"
                variant="danger"
                label={`Revoke ${agent.name}`}
                onClick={() => setConfirm("revoke")}
              >
                <ShieldOff size={13} strokeWidth={1.75} />
              </IconButton>
            </>
          )}
          <IconButton
            size="sm"
            variant="danger"
            label={`Delete ${agent.name}`}
            onClick={() => setConfirm("delete")}
          >
            <Trash2 size={13} strokeWidth={1.75} />
          </IconButton>
        </div>
      </div>
      {confirm && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-1.5 text-xs">
          <span>
            {confirm === "rotate"
              ? `Make a new key for “${agent.name}”? The current one stops working at once.`
              : confirm === "revoke"
                ? `Revoke “${agent.name}”? It loses access at once; its history stays.`
                : `Delete “${agent.name}” and its requests? Its changes stay in the audit log.`}
          </span>
          <span className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={rotate.isPending || revoke.isPending || remove.isPending}
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                (action === "rotate" ? rotate : action === "revoke" ? revoke : remove).mutate();
              }}
            >
              {confirm === "rotate" ? "New key" : confirm === "revoke" ? "Revoke" : "Delete"}
            </Button>
          </span>
        </div>
      )}
      {error && <p className="mt-1 text-2xs text-danger">{(error as Error).message}</p>}
    </li>
  );
}
