import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type PipelinePluginSummary, roleAtLeast, type TeamMembership } from "@zelyq/core";
import { Check, Copy, Lock, Package, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { formatRelative, vaultErrorMessage } from "../../lib/vault";
import { Badge, Button, EmptyState, IconButton, Spinner } from "../ui";

const OS_LABEL: Record<string, string> = { linux: "Linux", macos: "macOS", windows: "Windows" };

/**
 * Plugins the team installed: ready-made steps a pipeline uses with
 * `plugin: publisher/name@version`. An admin installs a package file; each
 * version is kept exactly as installed.
 */
export function PluginsTab({ team }: { team: TeamMembership }) {
  const isAdmin = roleAtLeast(team.role, "admin");
  const queryClient = useQueryClient();
  const plugins = useQuery({
    queryKey: ["pipeline-plugins", team.id],
    queryFn: () => api.pipelines.plugins(team.id),
  });
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["pipeline-plugins", team.id] });

  const install = useMutation({
    mutationFn: (file: File) => api.pipelines.installPlugin(team.id, file),
    onSuccess: ({ plugin }) => {
      setError(null);
      setInstalled(`${plugin.pluginId}@${plugin.version}`);
      void refresh();
    },
    onError: (caught) => {
      setInstalled(null);
      setError(vaultErrorMessage(caught));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.pipelines.removePlugin(team.id, id),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-xs text-fg-secondary">
          A plugin is a ready-made step: a pipeline uses it with{" "}
          <code className="font-mono">plugin: publisher/name@version</code>. It runs on the runner,
          like any step, with only the inputs you give it.
        </p>
        {isAdmin && (
          <>
            <input
              ref={input}
              type="file"
              accept=".tar.gz,.tgz,application/gzip"
              className="hidden"
              aria-label="Plugin package"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) install.mutate(file);
              }}
            />
            <Button
              size="sm"
              variant="primary"
              icon={<Upload size={13} />}
              disabled={install.isPending}
              onClick={() => input.current?.click()}
            >
              {install.isPending ? "Installing…" : "Install from a file"}
            </Button>
          </>
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
      {installed && (
        <p className="flex items-center gap-1 text-xs text-success">
          <Check size={13} /> Installed {installed}.
        </p>
      )}

      {plugins.isLoading ? (
        <Spinner />
      ) : (plugins.data?.plugins.length ?? 0) === 0 ? (
        <EmptyState
          title="No plugins yet"
          description={
            isAdmin
              ? "Install a plugin package (.tar.gz) to use it in this team's pipelines."
              : "A team admin installs plugins."
          }
        />
      ) : (
        <ul className="grid gap-3">
          {plugins.data?.plugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              canRemove={isAdmin}
              removing={remove.isPending}
              onRemove={() => remove.mutate(plugin.id)}
            />
          ))}
        </ul>
      )}

      <details className="rounded-md border border-border-default p-3 text-xs text-fg-secondary">
        <summary className="cursor-pointer font-medium text-fg">Making a plugin</summary>
        <p className="mt-2">
          A folder with a <code className="font-mono">zelyq-plugin.yml</code> at its top, and any
          scripts its steps run. Pack it from inside the folder:{" "}
          <code className="font-mono">tar -czf my-plugin.tar.gz -C my-plugin .</code>
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-surface-subtle p-2 font-mono text-2xs leading-5">{`id: acme/hello                # publisher/name
version: 1.0.0
name: Hello
description: Says hello.
runs-on: {os: [linux, macos]}
inputs:
  who: {description: Whom to greet, default: world}
  token: {description: An API token, required: true, secret: true}
outputs:
  greeting: What it said
steps:
  - name: Greet
    run: |
      echo "Hello, $ZELYQ_INPUT_WHO"
      echo "greeting=Hello, $ZELYQ_INPUT_WHO" >> "$ZELYQ_OUTPUT"
  - name: A script of its own
    run: sh "$ZELYQ_PLUGIN_DIR/scripts/check.sh"`}</pre>
        <p className="mt-2">
          Steps are <code className="font-mono">run</code>, <code className="font-mono">setup</code>{" "}
          or <code className="font-mono">cache</code>. Inputs reach them only as{" "}
          <code className="font-mono">$ZELYQ_INPUT_NAME</code>; a secret input must be given as{" "}
          <code className="font-mono">vault://NAME</code> and is masked in the log. A version never
          changes once installed: change the package, raise the version.
        </p>
      </details>
    </div>
  );
}

function PluginCard({
  plugin,
  canRemove,
  removing,
  onRemove,
}: {
  plugin: PipelinePluginSummary;
  canRemove: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const usage = `- plugin: ${plugin.pluginId}@${plugin.version}${
    plugin.inputs.length
      ? `\n  with:\n${plugin.inputs
          .map(
            (input) =>
              `    ${input.name}: ${input.secret ? "vault://NAME" : (input.default ?? "")}`,
          )
          .join("\n")}`
      : ""
  }`;
  return (
    <li className="rounded-md border border-border-default p-3 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <Package size={16} className="mt-0.5 shrink-0 text-fg-secondary" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {plugin.name}{" "}
            <span className="font-mono text-xs font-normal text-fg-secondary">
              {plugin.pluginId}@{plugin.version}
            </span>
          </p>
          <p className="text-xs text-fg-secondary">{plugin.description}</p>
          <p className="mt-1 flex flex-wrap gap-1 text-2xs text-fg-muted">
            <Badge>{plugin.category}</Badge>
            {(plugin.os ?? ["linux", "macos", "windows"]).map((os) => (
              <Badge key={os}>{OS_LABEL[os] ?? os}</Badge>
            ))}
            {plugin.needs.length > 0 && <span>needs {plugin.needs.join(", ")}</span>}
          </p>
        </div>
        {canRemove && (
          <IconButton
            size="sm"
            variant="danger"
            label={`Remove ${plugin.pluginId}@${plugin.version}`}
            disabled={removing || plugin.usedBy.length > 0}
            title={
              plugin.usedBy.length > 0
                ? "Used by a pipeline: change it first"
                : `Remove ${plugin.pluginId}@${plugin.version}`
            }
            onClick={onRemove}
          >
            <Trash2 size={13} />
          </IconButton>
        )}
      </div>

      {plugin.inputs.length > 0 && (
        <table className="mt-3 w-full text-xs">
          <thead className="text-left text-fg-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">Input</th>
              <th className="py-1 pr-3 font-medium">Default</th>
              <th className="py-1 font-medium">What it is</th>
            </tr>
          </thead>
          <tbody>
            {plugin.inputs.map((input) => (
              <tr key={input.name} className="border-t border-border-default align-top">
                <td className="py-1 pr-3 font-mono">
                  {input.name}
                  {input.secret && <Lock size={11} className="ml-1 inline text-warning" />}
                  {input.required && <span className="ml-1 text-danger">*</span>}
                </td>
                <td className="py-1 pr-3 font-mono text-fg-secondary">
                  {input.secret ? "vault://…" : (input.default ?? "—")}
                </td>
                <td className="py-1 text-fg-secondary">{input.description ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-3 rounded bg-surface-subtle p-2">
        <div className="mb-1 flex items-center justify-between text-2xs text-fg-muted">
          <span>In a pipeline</span>
          <button
            type="button"
            className="flex items-center gap-1 hover:text-fg"
            onClick={() => {
              void navigator.clipboard?.writeText(usage);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="overflow-x-auto font-mono text-2xs leading-5">{usage}</pre>
      </div>

      <p className="mt-2 text-2xs text-fg-muted">
        {plugin.steps.length} step{plugin.steps.length === 1 ? "" : "s"}: {plugin.steps.join(" · ")}
        {" · "}
        installed {formatRelative(plugin.installedAt)}
        {plugin.installedBy ? ` by ${plugin.installedBy.name}` : ""} · sha256{" "}
        <span className="font-mono">{plugin.sha256.slice(0, 12)}</span>
        {plugin.usedBy.length > 0 && (
          <>
            {" · used by "}
            {plugin.usedBy.map((pipeline, index) => (
              <span key={pipeline.id}>
                {index > 0 && ", "}
                <Link className="text-primary hover:underline" to={`/pipelines/${pipeline.id}`}>
                  {pipeline.name}
                </Link>
              </span>
            ))}
          </>
        )}
      </p>
    </li>
  );
}
