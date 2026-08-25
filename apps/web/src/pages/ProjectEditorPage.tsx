import { useQuery, useQueryClient } from "@tanstack/react-query";
import { roleAtLeast } from "@zelyq/core";
import { Camera, Code2, MessageSquare, Monitor } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ChatPanel } from "../components/ChatPanel";
import { CodeViewer } from "../components/CodeViewer";
import { FileExplorer } from "../components/FileExplorer";
import { PreviewPanel } from "../components/PreviewPanel";
import { PushControl } from "../components/PushControl";
import { Badge, Button, Spinner } from "../components/ui";
import { useChatSocket } from "../hooks/useChatSocket";
import { api } from "../lib/api";
import type { SelectedElement } from "../lib/inspector";

/** One value drives both layouts: the right-hand pane on desktop, the only
 * pane on a phone. */
type Pane = "chat" | "preview" | "code";

const STATUS_TONE = {
  ready: "success",
  building: "warning",
  creating: "warning",
  error: "danger",
  archived: "neutral",
} as const;

export function ProjectEditorPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [pane, setPane] = useState<Pane>("preview");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  /** Set when a file was opened from a turn, to show what that turn changed. */
  const [compareSnapshotId, setCompareSnapshotId] = useState<string | null>(null);
  const [compareAfterSnapshotId, setCompareAfterSnapshotId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [logs, setLogs] = useState("");
  /** Clicked in the preview with the inspector on — see `038`. */
  const [pointedElement, setPointedElement] = useState<SelectedElement | null>(null);

  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id) });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 60_000 });
  const files = useQuery({ queryKey: ["files", id], queryFn: () => api.listFiles(id) });
  // Saving a file takes editor. The server enforces it; this decides whether to
  // offer the control at all.
  const teams = useQuery({ queryKey: ["teams"], queryFn: api.listTeams, staleTime: 60_000 });
  const preview = useQuery({
    queryKey: ["preview", id],
    queryFn: () => api.getPreview(id),
    refetchInterval: (query) => (query.state.data?.preview.status === "starting" ? 2000 : 15_000),
  });
  const file = useQuery({
    queryKey: ["file", id, selectedPath],
    queryFn: () => api.readFile(id, selectedPath!),
    enabled: Boolean(selectedPath),
  });

  const role = teams.data?.teams.find((team) => team.id === project.data?.project.teamId)?.role;
  const canEdit = role !== undefined && roleAtLeast(role, "editor");

  // When the agent reports file changes, refresh the tree, the open file, and
  // the preview frame. HMR usually beats us to it, but config and dependency
  // changes need the reload.
  const onFilesChanged = useCallback(
    (paths: string[]) => {
      queryClient.invalidateQueries({ queryKey: ["files", id] });
      if (selectedPath && paths.includes(selectedPath)) {
        queryClient.invalidateQueries({ queryKey: ["file", id, selectedPath] });
      }
      setReloadToken((token) => token + 1);
    },
    [id, queryClient, selectedPath],
  );

  const chat = useChatSocket(id, onFilesChanged);

  useEffect(() => {
    document.title = project.data ? `${project.data.project.name} — Zelyq` : "Zelyq";
  }, [project.data]);

  async function startPreview() {
    setStarting(true);
    try {
      await api.startPreview(id);
    } finally {
      setStarting(false);
      preview.refetch();
    }
  }

  async function stopPreview() {
    await api.stopPreview(id);
    preview.refetch();
  }

  async function refreshLogs() {
    const { logs: output } = await api.previewLogs(id);
    setLogs(output);
  }

  if (project.isLoading) {
    return (
      <AppShell crumbs={[{ label: "Projects", to: "/" }, { label: "…" }]}>
        <div className="grid h-full place-items-center">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  if (project.isError) {
    return (
      <AppShell crumbs={[{ label: "Projects", to: "/" }, { label: "Not found" }]}>
        <div className="grid h-full place-items-center gap-2 text-center">
          <p className="text-sm text-fg-secondary">{(project.error as Error).message}</p>
          <Link to="/" className="text-xs text-info hover:underline">
            Back to projects
          </Link>
        </div>
      </AppShell>
    );
  }

  const current = project.data!.project;
  // Desktop always shows the chat on the left, so "chat" falls back to preview.
  const rightPane: "preview" | "code" = pane === "code" ? "code" : "preview";

  return (
    <AppShell
      crumbs={[
        { label: "Projects", to: "/" },
        {
          label: current.name,
          badge: <Badge tone={STATUS_TONE[current.status] ?? "neutral"}>{current.status}</Badge>,
        },
      ]}
      actions={
        <>
          {/* The bottom bar handles pane switching on phones. */}
          <div className="mr-1 hidden items-center gap-0.5 rounded-md border border-border-default bg-surface-subtle p-0.5 md:flex">
            <TabButton
              active={rightPane === "preview"}
              onClick={() => setPane("preview")}
              icon={<Monitor size={13} strokeWidth={1.75} />}
            >
              Preview
            </TabButton>
            <TabButton
              active={rightPane === "code"}
              onClick={() => setPane("code")}
              icon={<Code2 size={13} strokeWidth={1.75} />}
            >
              Code
            </TabButton>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<Camera size={13} strokeWidth={1.75} />}
            onClick={() => api.createSnapshot(id, "Manual save")}
            className="max-md:px-1.5"
          >
            <span className="max-md:hidden">Snapshot</span>
          </Button>
          {/* Same role the route itself already requires — editing and
              pushing are the same trust level. */}
          {canEdit && <PushControl projectId={id} />}
        </>
      }
    >
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] md:grid-rows-[minmax(0,1fr)]">
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(300px,24rem)_minmax(0,1fr)]">
          {/*
            Panes are hidden, not unmounted. The chat holds a live WebSocket and
            a scroll position; tearing it down whenever the user glances at the
            preview would drop both.

            Every visibility class is written out in full rather than composed
            from a template string — Tailwind extracts class names statically,
            so an interpolated `md:${x}` produces no CSS at all.
          */}
          <div className={`${pane === "chat" ? "grid" : "hidden"} min-h-0 min-w-0 md:grid`}>
            <ChatPanel
              chat={chat}
              model={health.data?.agent.model}
              skills={health.data?.agent.skills ?? []}
              plugins={health.data?.agent.plugins ?? []}
              projectId={id}
              canEdit={canEdit}
              pointedElement={pointedElement}
              onClearPointedElement={() => setPointedElement(null)}
              onOpenDiff={(diffPath, before, after) => {
                setSelectedPath(diffPath);
                setCompareSnapshotId(before);
                setCompareAfterSnapshotId(after);
                setPane("code");
              }}
              onReverted={() => {
                // The files on disk moved under everything that reads them.
                queryClient.invalidateQueries({ queryKey: ["files", id] });
                queryClient.invalidateQueries({ queryKey: ["file", id] });
                setReloadToken((token) => token + 1);
              }}
            />
          </div>

          <div
            className={`${pane === "preview" ? "grid" : "hidden"} min-h-0 ${
              rightPane === "preview" ? "md:grid" : "md:hidden"
            }`}
          >
            <PreviewPanel
              preview={preview.data?.preview ?? null}
              logs={logs}
              starting={starting}
              onStart={startPreview}
              onStop={stopPreview}
              onRefreshLogs={refreshLogs}
              reloadToken={reloadToken}
              onElementSelected={(element) => {
                setPointedElement(element);
                // Only matters on a phone, where panes are exclusive tabs —
                // pointing at something is what you do right before typing
                // about it.
                setPane("chat");
              }}
            />
          </div>

          <div
            className={`${pane === "code" ? "grid" : "hidden"} min-h-0 grid-cols-[9rem_minmax(0,1fr)] sm:grid-cols-[15rem_minmax(0,1fr)] ${
              rightPane === "code" ? "md:grid" : "md:hidden"
            }`}
          >
            <div className="min-h-0 overflow-hidden border-r border-border-default bg-surface">
              <FileExplorer
                entries={files.data?.entries ?? []}
                selected={selectedPath}
                loading={files.isLoading}
                onSelect={(next) => {
                  // Picking a file from the tree means "show me the file", not
                  // "show me what some turn did to it".
                  setCompareSnapshotId(null);
                  setCompareAfterSnapshotId(null);
                  setSelectedPath(next);
                }}
              />
            </div>
            <CodeViewer
              projectId={id}
              path={selectedPath}
              file={file.data ?? null}
              loading={file.isLoading}
              canEdit={canEdit}
              compareSnapshotId={compareSnapshotId}
              compareAfterSnapshotId={compareAfterSnapshotId}
              onCloseCompare={() => {
                setCompareSnapshotId(null);
                setCompareAfterSnapshotId(null);
              }}
              onSaved={(saved) => {
                queryClient.invalidateQueries({ queryKey: ["file", id, saved] });
                queryClient.invalidateQueries({ queryKey: ["files", id] });
                setReloadToken((token) => token + 1);
              }}
            />
          </div>
        </div>

        <PaneBar pane={pane} onChange={setPane} />
      </div>
    </AppShell>
  );
}

/** Phone-only pane switcher, at the bottom where a thumb reaches. */
function PaneBar({ pane, onChange }: { pane: Pane; onChange(next: Pane): void }) {
  const items: Array<{ id: Pane; label: string; icon: React.ReactNode }> = [
    { id: "chat", label: "Agent", icon: <MessageSquare size={15} strokeWidth={1.75} /> },
    { id: "preview", label: "Preview", icon: <Monitor size={15} strokeWidth={1.75} /> },
    { id: "code", label: "Code", icon: <Code2 size={15} strokeWidth={1.75} /> },
  ];

  return (
    <nav
      aria-label="Panes"
      className="grid grid-cols-3 border-t border-border-default bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          aria-current={pane === item.id ? "page" : undefined}
          className={`flex flex-col items-center gap-0.5 py-1.5 text-2xs font-medium transition-colors ${
            pane === item.id ? "text-fg" : "text-fg-muted hover:text-fg-secondary"
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick(): void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-[22px] items-center gap-1.5 rounded-sm px-2 text-xs font-medium transition-colors ${
        active
          ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
          : "text-fg-muted hover:text-fg"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
