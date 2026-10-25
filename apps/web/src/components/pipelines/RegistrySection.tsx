import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PipelinePluginSummary, RegistryPluginSummary, TeamMembership } from "@zelyq/core";
import { AlertTriangle, BadgeCheck, ChevronDown, ChevronRight, Download } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { vaultErrorMessage } from "../../lib/vault";
import { Markdown } from "../Markdown";
import { Badge, Button, Input, Spinner } from "../ui";

/** Compares 1.10.0 with 1.9.2, numerically. */
function newer(a: string, b: string): boolean {
  const parse = (v: string) =>
    v
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/**
 * Zelyq's own plugins, from its registry: browse, read, install. Every
 * package is checked against Zelyq's signature on the server before it is
 * installed; this is only the window onto it.
 */
export function RegistrySection({
  team,
  installed,
  isAdmin,
}: {
  team: TeamMembership;
  installed: PipelinePluginSummary[];
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const status = useQuery({ queryKey: ["plugin-registry"], queryFn: api.pipelines.registryStatus });
  const enabled = status.data?.enabled === true;
  const list = useQuery({
    queryKey: ["plugin-registry-list", team.id, search],
    queryFn: () => api.pipelines.registryPlugins(team.id, search.trim() || undefined),
    enabled,
  });
  const install = useMutation({
    mutationFn: (input: { id: string; version: string }) =>
      api.pipelines.registryInstall(team.id, input.id, input.version),
    onSuccess: ({ plugin }) => {
      setMessage({ ok: true, text: `Installed ${plugin.pluginId}@${plugin.version}.` });
      void queryClient.invalidateQueries({ queryKey: ["pipeline-plugins", team.id] });
    },
    onError: (caught) => setMessage({ ok: false, text: vaultErrorMessage(caught) }),
  });

  if (!enabled) return null;

  const newestInstalled = new Map<string, string>();
  for (const plugin of installed) {
    const current = newestInstalled.get(plugin.pluginId);
    if (!current || newer(plugin.version, current))
      newestInstalled.set(plugin.pluginId, plugin.version);
  }
  const withdrawn = (list.data?.yanked ?? []).filter((entry) =>
    installed.some((plugin) => plugin.pluginId === entry.id && plugin.version === entry.version),
  );

  return (
    <section className="rounded-lg border border-border-default bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <BadgeCheck size={15} className="text-success" /> From the Zelyq registry
        </h2>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search plugins"
          aria-label="Search the registry"
          className="max-w-xs"
        />
      </div>
      <p className="mt-1 text-2xs text-fg-muted">
        Zelyq's own plugins, signed by Zelyq. Every package is checked against that signature before
        it is installed.
      </p>

      {withdrawn.map((entry) => (
        <p
          key={`${entry.id}@${entry.version}`}
          className="mt-3 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning-subtle px-2.5 py-1.5 text-xs text-warning"
        >
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {entry.id}@{entry.version}, installed here, was withdrawn: {entry.reason}
        </p>
      ))}
      {message && (
        <p className={`mt-3 text-xs ${message.ok ? "text-success" : "text-danger"}`}>
          {message.text}
        </p>
      )}

      {list.isLoading ? (
        <div className="mt-3">
          <Spinner />
        </div>
      ) : list.isError ? (
        <p className="mt-3 text-xs text-fg-muted">{vaultErrorMessage(list.error)}</p>
      ) : (list.data?.plugins.length ?? 0) === 0 ? (
        <p className="mt-3 text-xs text-fg-muted">
          {search ? "Nothing matches." : "The registry has no plugins yet."}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border-default rounded-md border border-border-default">
          {list.data?.plugins.map((plugin) => (
            <RegistryRow
              key={plugin.id}
              team={team}
              plugin={plugin}
              open={open === plugin.id}
              onToggle={() => setOpen(open === plugin.id ? null : plugin.id)}
              installedVersion={newestInstalled.get(plugin.id) ?? null}
              canInstall={isAdmin}
              installing={install.isPending && install.variables?.id === plugin.id}
              onInstall={() => install.mutate({ id: plugin.id, version: plugin.latestVersion })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RegistryRow({
  team,
  plugin,
  open,
  onToggle,
  installedVersion,
  canInstall,
  installing,
  onInstall,
}: {
  team: TeamMembership;
  plugin: RegistryPluginSummary;
  open: boolean;
  onToggle: () => void;
  installedVersion: string | null;
  canInstall: boolean;
  installing: boolean;
  onInstall: () => void;
}) {
  const detail = useQuery({
    queryKey: ["plugin-registry-detail", team.id, plugin.id],
    queryFn: () => api.pipelines.registryPlugin(team.id, plugin.id),
    enabled: open,
  });
  const upToDate = installedVersion !== null && !newer(plugin.latestVersion, installedVersion);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 items-start gap-1.5 text-left"
        >
          <Chevron size={14} className="mt-0.5 shrink-0 text-fg-muted" />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-1.5 text-sm text-fg">
              {plugin.name}
              <code className="font-mono text-2xs text-fg-muted">{plugin.id}</code>
              <Badge>{plugin.category}</Badge>
            </span>
            <span className="block text-xs text-fg-secondary">{plugin.description}</span>
            <span className="block text-2xs text-fg-muted">
              v{plugin.latestVersion} · {plugin.os.join(", ")}
            </span>
          </span>
        </button>
        <span className="shrink-0">
          {upToDate ? (
            <Badge tone="success">Installed v{installedVersion}</Badge>
          ) : canInstall ? (
            <Button
              size="sm"
              variant={installedVersion ? "secondary" : "primary"}
              icon={<Download size={13} />}
              disabled={installing}
              onClick={onInstall}
            >
              {installing
                ? "Installing…"
                : installedVersion
                  ? `Update to v${plugin.latestVersion}`
                  : "Install"}
            </Button>
          ) : installedVersion ? (
            <Badge tone="warning">v{plugin.latestVersion} available</Badge>
          ) : (
            <span className="text-2xs text-fg-muted">A team admin installs plugins</span>
          )}
        </span>
      </div>

      {open && (
        <div className="mt-3 ml-5 grid gap-3">
          {detail.isLoading || !detail.data ? (
            <Spinner />
          ) : (
            <>
              <div className="rounded-md border border-border-default p-3 text-sm">
                <Markdown>{detail.data.plugin.readme}</Markdown>
              </div>
              {Object.keys(detail.data.plugin.inputs).length > 0 && (
                <div className="text-xs">
                  <p className="mb-1 font-medium text-fg">Inputs</p>
                  <ul className="grid gap-0.5 text-fg-secondary">
                    {Object.entries(detail.data.plugin.inputs).map(([name, input]) => (
                      <li key={name}>
                        <code className="font-mono text-fg">{name}</code>
                        {input.required ? " (required)" : ""}
                        {input.secret ? " · a vault:// secret" : ""} — {input.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="text-xs">
                <p className="mb-1 font-medium text-fg">Use it</p>
                <code className="block rounded bg-surface-subtle p-2 font-mono text-2xs">
                  plugin: {plugin.id}@{plugin.latestVersion}
                </code>
              </div>
              <div className="text-xs">
                <p className="mb-1 font-medium text-fg">Versions</p>
                <ul className="grid gap-1 text-fg-secondary">
                  {detail.data.plugin.versions.map((version) => (
                    <li key={version.version}>
                      <span className="text-fg">v{version.version}</span> ·{" "}
                      {new Date(version.publishedAt).toLocaleDateString()}
                      {version.yanked && (
                        <span className="text-danger"> · withdrawn: {version.yanked.reason}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}
