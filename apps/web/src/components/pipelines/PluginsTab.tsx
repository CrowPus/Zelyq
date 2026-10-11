import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type PipelinePluginSummary, roleAtLeast, type TeamMembership } from "@zelyq/core";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Lock,
  Package,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { formatRelative, vaultErrorMessage } from "../../lib/vault";
import { Button, EmptyState, Input, Spinner } from "../ui";

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
    // minmax(0, 1fr): a long name in a row may never make the page wider than the screen.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
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
        <PluginList
          plugins={plugins.data?.plugins ?? []}
          canRemove={isAdmin}
          removing={remove.isPending}
          onRemove={(id) => remove.mutate(id)}
        />
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

/**
 * The installed plugins as a list that stays usable with hundreds: search and
 * a category filter on top, one compact row each, and one row open at a time
 * with its inputs, how to use it, and Remove.
 */
function PluginList({
  plugins,
  canRemove,
  removing,
  onRemove,
}: {
  plugins: PipelinePluginSummary[];
  canRemove: boolean;
  removing: boolean;
  onRemove: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const categories = [...new Set(plugins.map((plugin) => plugin.category))].sort();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = plugins.filter(
    (plugin) =>
      (!category || plugin.category === category) &&
      words.every((word) =>
        `${plugin.name} ${plugin.pluginId} ${plugin.description}`.toLowerCase().includes(word),
      ),
  );
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search size={13} className="pointer-events-none absolute top-2 left-2 text-fg-muted" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search plugins by name or what they do"
            aria-label="Search plugins"
            className="pl-7"
          />
        </div>
        <select
          aria-label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="h-[30px] rounded-md border border-border-default bg-surface px-2 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name[0]?.toUpperCase()}
              {name.slice(1)}
            </option>
          ))}
        </select>
        <span className="text-xs text-fg-muted">
          {shown.length === plugins.length
            ? `${plugins.length} installed`
            : `${shown.length} of ${plugins.length}`}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-md border border-border-default px-3 py-4 text-center text-xs text-fg-muted">
          No plugin matches.
        </p>
      ) : (
        <ul className="divide-y divide-border-default rounded-md border border-border-default bg-surface">
          {shown.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              open={open === plugin.id}
              onToggle={() => setOpen(open === plugin.id ? null : plugin.id)}
              canRemove={canRemove}
              removing={removing}
              onRemove={() => onRemove(plugin.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-surface-hover px-1.5 py-0.5 text-2xs text-fg-secondary">
      {children}
    </span>
  );
}

function PluginRow({
  plugin,
  open,
  onToggle,
  canRemove,
  removing,
  onRemove,
}: {
  plugin: PipelinePluginSummary;
  open: boolean;
  onToggle: () => void;
  canRemove: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-surface-hover"
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-fg-muted" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-fg-muted" />
        )}
        <Package size={14} className="shrink-0 text-fg-secondary" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-medium">{plugin.name}</span>
            <span className="truncate font-mono text-2xs text-fg-muted">
              {plugin.pluginId}@{plugin.version}
            </span>
          </span>
          <span className="block truncate text-xs text-fg-secondary">{plugin.description}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          <Tag>{plugin.category}</Tag>
          {(plugin.os ?? []).map((os) => (
            <Tag key={os}>{OS_LABEL[os] ?? os}</Tag>
          ))}
        </span>
        <span className="w-20 shrink-0 text-right text-2xs text-fg-muted">
          {plugin.usedBy.length > 0 ? `used by ${plugin.usedBy.length}` : "not used"}
        </span>
      </button>
      {open && (
        <PluginDetails
          plugin={plugin}
          canRemove={canRemove}
          removing={removing}
          onRemove={onRemove}
        />
      )}
    </li>
  );
}

function PluginDetails({
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
    <div className="grid gap-3 border-t border-border-default bg-surface-subtle px-3 py-3 pl-10 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 text-xs text-fg-secondary">
          <p>{plugin.description}</p>
          <p className="mt-1">
            Runs on{" "}
            {(plugin.os ?? ["linux", "macos", "windows"])
              .map((os) => OS_LABEL[os] ?? os)
              .join(", ")}
            {plugin.needs.length > 0 && <> · needs {plugin.needs.join(", ")}</>}
          </p>
        </div>
        {canRemove && (
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 size={12} />}
            disabled={removing || plugin.usedBy.length > 0}
            title={
              plugin.usedBy.length > 0
                ? "A pipeline uses it: change that pipeline first"
                : undefined
            }
            onClick={onRemove}
          >
            Remove
          </Button>
        )}
      </div>

      {plugin.inputs.length > 0 && (
        <table className="w-full text-xs">
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

      <div className="rounded border border-border-default bg-surface p-2">
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

      <p className="text-2xs text-fg-muted">
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
                <Link className="underline hover:text-fg" to={`/pipelines/${pipeline.id}`}>
                  {pipeline.name}
                </Link>
              </span>
            ))}
          </>
        )}
      </p>
    </div>
  );
}
