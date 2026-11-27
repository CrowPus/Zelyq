import { useQuery, useQueryClient } from "@tanstack/react-query";
import { roleAtLeast } from "@zelyq/core";
import {
  Camera,
  Code2,
  Columns2,
  Compass,
  Database,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Settings,
  Variable,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { BackendPanel } from "../components/BackendPanel";
import { ChatPanel } from "../components/ChatPanel";
import { CodeViewer } from "../components/CodeViewer";
import { FileExplorer } from "../components/FileExplorer";
import { StarMoment } from "../components/GitHubStar";
import { GitPanel } from "../components/GitPanel";
import { LiveBrowser } from "../components/LiveBrowser";
import { PlanPanel } from "../components/PlanPanel";
import { PreviewPanel } from "../components/PreviewPanel";
import { ProjectVariablesPanel } from "../components/ProjectVariablesPanel";
import { SnapshotPanel } from "../components/SnapshotPanel";
import { StudioMediaPicker } from "../components/StudioMediaPicker";
import {
  Button,
  buttonClass,
  ErrorState,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  SegmentedControl,
  Spinner,
  StatusBadge,
  statusOf,
} from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { useChatSocket } from "../hooks/useChatSocket";
import { ApiError, api } from "../lib/api";
import { MAX_UPLOAD_BYTES, uploadTargetPath } from "../lib/files";
import { t } from "../lib/i18n";
import type { SelectedElement } from "../lib/inspector";
import { type AppPanel, useTeamPaths } from "../lib/routes";

/** One value drives both layouts: the right-hand pane on desktop, the only
 * pane on a phone. */
type Pane = "chat" | "preview" | "code" | "plan";

export function ProjectEditorPage() {
  // Studio and the model list use the team's own AI keys first.
  const { team: activeTeam } = useActiveTeam();
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const p = useTeamPaths();
  const navigate = useNavigate();
  // Git, Variables, Snapshots and Backend open beside the work, from the
  // address — so the app's sidebar can link to them and a reload keeps them.
  const [params, setParams] = useSearchParams();
  const panel = params.get("panel") as AppPanel | null;
  const setPanel = (next: AppPanel | null) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (next) copy.set("panel", next);
        else copy.delete("panel");
        return copy;
      },
      { replace: !next },
    );
  const [pane, setPane] = useState<Pane>("preview");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  /** Set when a file was opened from a turn, to show what that turn changed. */
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** The folder the Studio picker is open for, or null when it is closed. */
  const [studioDir, setStudioDir] = useState<string | null>(null);
  const [compareSnapshotId, setCompareSnapshotId] = useState<string | null>(null);
  const [compareAfterSnapshotId, setCompareAfterSnapshotId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [logs, setLogs] = useState("");
  // Desktop layout: collapse the chat column, or the file tree inside the Code
  // pane, so the preview / code / plan takes the full width. Phones use the
  // bottom PaneBar instead, so these are md-only.
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  /** Clicked in the preview with the inspector on. */
  const [pointedElement, setPointedElement] = useState<SelectedElement | null>(null);

  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id) });
  // The app's own team: its AI keys are the ones this app's agent uses.
  const appTeam = project.data?.project.teamId ?? activeTeam?.id;
  const imageCapabilities = useQuery({
    queryKey: ["image-capabilities", appTeam],
    queryFn: () => api.imageCapabilities(appTeam),
  });
  const videoCapabilities = useQuery({
    queryKey: ["video-capabilities", appTeam],
    queryFn: () => api.videoCapabilities(appTeam),
  });
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

  /** After an undo or a restore: the files on disk moved under everything that reads them. */
  const afterFilesMoved = () => {
    queryClient.invalidateQueries({ queryKey: ["files", id] });
    queryClient.invalidateQueries({ queryKey: ["file", id] });
    setReloadToken((token) => token + 1);
  };
  // A Python backend is the one place a project's variables are read today.
  const hasBackend =
    project.data?.project.template === "react-fastapi" ||
    Boolean(files.data?.entries.some((entry) => entry.path === "zelyq.runtime.json"));

  // When the agent reports file changes, refresh the tree, the open file, and
  // the preview frame. HMR usually beats us to it, but config and dependency
  // changes need the reload.
  const onFilesChanged = useCallback(
    (paths: string[]) => {
      queryClient.invalidateQueries({ queryKey: ["files", id] });
      if (selectedPath && paths.includes(selectedPath)) {
        queryClient.invalidateQueries({ queryKey: ["file", id, selectedPath] });
      }
      // Architect Mode writes architecture/report.html and topology.json
      // during a run. Both Plan-panel queries must refresh — the topology one
      // especially, since it 404s (and, with retry:false, stays failed) if the
      // panel first queried it before the Architect had written the file.
      if (paths.some((p) => p.startsWith("architecture/"))) {
        queryClient.invalidateQueries({ queryKey: ["plan", id] });
        queryClient.invalidateQueries({ queryKey: ["topology", id] });
      }
      // Update_plan writes PLAN.md; refresh the checklist view.
      if (paths.includes("PLAN.md")) {
        queryClient.invalidateQueries({ queryKey: ["plan-md", id] });
      }
      setReloadToken((token) => token + 1);
    },
    [id, queryClient, selectedPath],
  );

  const chat = useChatSocket(id, onFilesChanged);

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
      <AppShell crumbs={[{ label: t("Build") }]} app={{ id, name: "…" }}>
        <div className="grid h-full place-items-center">
          <Spinner label={t("Opening the app")} />
        </div>
      </AppShell>
    );
  }

  if (project.isError) {
    return (
      <AppShell crumbs={[{ label: t("Not found") }]}>
        <ErrorState
          title={t("This app could not be opened")}
          error={
            project.error instanceof ApiError && project.error.status === 404
              ? t("It may have been deleted, or it belongs to a team you are not in.")
              : project.error
          }
          onRetry={() => project.refetch()}
          action={
            <Link to={p.apps} className={buttonClass("secondary")}>
              {t("All apps")}
            </Link>
          }
        />
      </AppShell>
    );
  }

  const current = project.data!.project;
  // Desktop always shows the chat on the left, so "chat" falls back to preview.
  const rightPane: "preview" | "code" | "plan" =
    pane === "code" ? "code" : pane === "plan" ? "plan" : "preview";

  const shellApp = {
    id,
    name: current.name,
    status: statusOf(current.status),
    statusLabel: current.status === "ready" ? t("Ready") : undefined,
  };

  return (
    <AppShell crumbs={[{ label: t("Build") }]} app={shellApp}>
      {/* The one thank-you, the first time their app is up and the agent is done. */}
      <StarMoment appRunning={preview.data?.preview?.status === "running" && !chat.busy} />
      {canEdit && (
        <GitPanel
          projectId={id}
          teamId={current.teamId}
          open={panel === "git"}
          onOpenChange={(open) => setPanel(open ? "git" : null)}
        />
      )}
      {canEdit && hasBackend && (
        <BackendPanel
          projectId={id}
          open={panel === "backend"}
          onOpenChange={(open) => setPanel(open ? "backend" : null)}
        />
      )}
      <SnapshotPanel
        projectId={id}
        canEdit={canEdit}
        onRestored={afterFilesMoved}
        open={panel === "snapshots"}
        onOpenChange={(open) => setPanel(open ? "snapshots" : null)}
      />
      {/* Every member sees the variables — viewers read names and history;
          the panel itself hides what only an editor may do. */}
      {role !== undefined && (
        <ProjectVariablesPanel
          projectId={id}
          teamId={current.teamId}
          canEdit={canEdit}
          hasBackend={hasBackend}
          open={panel === "variables"}
          onOpenChange={(open) => setPanel(open ? "variables" : null)}
        />
      )}
      <div className="flex h-full min-h-0 flex-col">
        {/* The builder's own toolbar: layout, what the right pane shows, and
            the app's actions. Desktop only; phones use the bottom bar. */}
        <div className="hidden h-11 items-center gap-2 border-b border-border-default bg-surface px-2 md:flex">
          <IconButton
            size="sm"
            label={chatCollapsed ? t("Show chat") : t("Hide chat")}
            aria-pressed={chatCollapsed}
            onClick={() => setChatCollapsed((v) => !v)}
          >
            {chatCollapsed ? (
              <PanelLeftOpen size={15} strokeWidth={1.75} />
            ) : (
              <PanelLeftClose size={15} strokeWidth={1.75} />
            )}
          </IconButton>
          {rightPane === "code" && (
            <IconButton
              size="sm"
              label={treeCollapsed ? t("Show file tree") : t("Hide file tree")}
              aria-pressed={treeCollapsed}
              onClick={() => setTreeCollapsed((v) => !v)}
            >
              <Columns2 size={15} strokeWidth={1.75} />
            </IconButton>
          )}
          <div className="flex flex-1 justify-center">
            <SegmentedControl
              label={t("Show")}
              size="sm"
              value={rightPane}
              onValueChange={(next) => setPane(next)}
              options={[
                {
                  value: "preview",
                  label: t("Preview"),
                  icon: <Monitor size={13} strokeWidth={1.75} />,
                },
                { value: "code", label: t("Code"), icon: <Code2 size={13} strokeWidth={1.75} /> },
                { value: "plan", label: t("Plan"), icon: <Compass size={13} strokeWidth={1.75} /> },
              ]}
            />
          </div>
          <AppMenu
            canEdit={canEdit}
            hasBackend={hasBackend}
            onPanel={setPanel}
            onOverview={() => navigate(p.app(id, "overview"))}
            onSettings={() => navigate(p.app(id, "settings"))}
          />
          <DeployPopover appName={current.name} appSlug={current.slug} teamId={current.teamId} />
        </div>
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] md:grid-rows-[minmax(0,1fr)]">
          <div
            className={`grid min-h-0 grid-cols-[minmax(0,1fr)] ${
              chatCollapsed
                ? "md:grid-cols-[minmax(0,1fr)]"
                : "md:grid-cols-[minmax(300px,24rem)_minmax(0,1fr)]"
            }`}
          >
            {/*
            Panes are hidden, not unmounted. The chat holds a live WebSocket and
            a scroll position; tearing it down whenever the user glances at the
            preview would drop both.

            Every visibility class is written out in full rather than composed
            from a template string — Tailwind extracts class names statically,
            so an interpolated `md:${x}` produces no CSS at all.
          */}
            <div
              className={`${pane === "chat" ? "grid" : "hidden"} min-h-0 min-w-0 ${
                chatCollapsed ? "md:hidden" : "md:grid"
              }`}
            >
              <ChatPanel
                chat={chat}
                model={health.data?.agent.model}
                skills={health.data?.agent.skills ?? []}
                plugins={health.data?.agent.plugins ?? []}
                projectId={id}
                canEdit={canEdit}
                videoGeneration={{
                  enabled: current.videoGenerationEnabled,
                  available: videoCapabilities.data?.providers.some((p) => p.configured) ?? false,
                  async onToggle(next) {
                    await api.updateProject(id, { videoGenerationEnabled: next });
                    await queryClient.invalidateQueries({ queryKey: ["project", id] });
                  },
                }}
                imageGeneration={{
                  enabled: current.imageGenerationEnabled,
                  // No provider key on the instance means the permission can be
                  // set but nothing could come of it; say so instead of offering
                  // a switch that does nothing.
                  available: imageCapabilities.data?.configured ?? false,
                  async onToggle(next) {
                    await api.updateProject(id, { imageGenerationEnabled: next });
                    await queryClient.invalidateQueries({ queryKey: ["project", id] });
                  },
                }}
                pointedElement={pointedElement}
                onClearPointedElement={() => setPointedElement(null)}
                onOpenDiff={(diffPath, before, after) => {
                  setSelectedPath(diffPath);
                  setCompareSnapshotId(before);
                  setCompareAfterSnapshotId(after);
                  setPane("code");
                }}
                onReverted={afterFilesMoved}
              />
            </div>

            <div
              // Rows, not one cell: the live browser takes the space it needs
              // under the preview and collapses to nothing when no tool is
              // driving one, which is most of the time.
              className={`${pane === "preview" ? "grid" : "hidden"} min-h-0 grid-rows-[minmax(0,1fr)_auto] ${
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
                agentWorking={chat.busy}
                onElementSelected={(element) => {
                  setPointedElement(element);
                  // Only matters on a phone, where panes are exclusive tabs —
                  // pointing at something is what you do right before typing
                  // about it.
                  setPane("chat");
                }}
              />
              <LiveBrowser browser={chat.browser} />
            </div>

            <div
              className={`${pane === "code" ? "grid" : "hidden"} min-h-0 ${
                treeCollapsed
                  ? "grid-cols-[minmax(0,1fr)]"
                  : "grid-cols-[9rem_minmax(0,1fr)] sm:grid-cols-[15rem_minmax(0,1fr)]"
              } ${rightPane === "code" ? "md:grid" : "md:hidden"}`}
            >
              <div
                className={`${
                  treeCollapsed ? "hidden" : ""
                } min-h-0 overflow-hidden border-r border-border-default bg-surface`}
              >
                <FileExplorer
                  entries={files.data?.entries ?? []}
                  selected={selectedPath}
                  loading={files.isLoading}
                  canEdit={canEdit}
                  onSelect={(next) => {
                    // Picking a file from the tree means "show me the file", not
                    // "show me what some turn did to it".
                    setCompareSnapshotId(null);
                    setCompareAfterSnapshotId(null);
                    setSelectedPath(next);
                  }}
                  onCreate={async (path, isDir) => {
                    // A folder is an empty file at `<path>/.gitkeep` — the runtime
                    // makes intermediate directories on write either way.
                    const target = isDir ? `${path}/.gitkeep` : path;
                    await api.writeFile(id, target, "");
                    await queryClient.invalidateQueries({ queryKey: ["files", id] });
                    if (!isDir) {
                      setCompareSnapshotId(null);
                      setCompareAfterSnapshotId(null);
                      setSelectedPath(path);
                    }
                  }}
                  onDelete={async (path) => {
                    await api.deleteFile(id, path);
                    await queryClient.invalidateQueries({ queryKey: ["files", id] });
                    if (selectedPath === path || selectedPath?.startsWith(`${path}/`)) {
                      setSelectedPath(null);
                    }
                  }}
                  uploading={uploading}
                  onAddFromStudio={(destDir) => setStudioDir(destDir)}
                  onUpload={async (dropped, destDir) => {
                    const tooBig = dropped.filter((d) => d.file.size > MAX_UPLOAD_BYTES);
                    if (tooBig.length > 0) {
                      setUploadError(
                        `${tooBig.length === 1 ? tooBig[0]!.relativePath : t("{tooBigCount} files", { tooBigCount: tooBig.length })} ` +
                          t("exceeded the {MAX_UPLOAD_BYTES} MB limit and ", {
                            MAX_UPLOAD_BYTES: Math.round(MAX_UPLOAD_BYTES / 1024 / 1024),
                          }) +
                          "was not uploaded.",
                      );
                    }
                    const queue = dropped
                      .filter((d) => d.file.size <= MAX_UPLOAD_BYTES)
                      .map((d) => ({
                        target: uploadTargetPath(destDir, d.relativePath),
                        file: d.file,
                      }))
                      .filter((d) => d.target);
                    if (queue.length === 0) return;

                    setUploading(true);
                    try {
                      // Sequential on purpose: the runtime writes into one
                      // project directory, and a browser drag can be hundreds of
                      // files. Firing them all at once buys nothing and risks
                      // burying the server under a folder drop.
                      for (const item of queue) {
                        await api.uploadFile(id, item.target, item.file);
                      }
                      await queryClient.invalidateQueries({ queryKey: ["files", id] });
                      // Land on the thing just added, so it is obvious it worked.
                      const last = queue[queue.length - 1]?.target;
                      if (last && queue.length === 1) {
                        setCompareSnapshotId(null);
                        setCompareAfterSnapshotId(null);
                        setSelectedPath(last);
                      }
                    } catch (error) {
                      setUploadError((error as Error).message || t("Upload failed."));
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
                {studioDir !== null && (
                  <StudioMediaPicker
                    teamId={appTeam}
                    projectId={id}
                    destDir={studioDir}
                    onClose={() => setStudioDir(null)}
                    onPlaced={async (path) => {
                      setStudioDir(null);
                      await queryClient.invalidateQueries({ queryKey: ["files", id] });
                      setCompareSnapshotId(null);
                      setCompareAfterSnapshotId(null);
                      setSelectedPath(path);
                    }}
                  />
                )}
                {uploadError && (
                  <p className="border-t border-border-default px-3 py-2 text-2xs text-danger">
                    {uploadError}{" "}
                    <button
                      type="button"
                      className="underline hover:no-underline"
                      onClick={() => setUploadError(null)}
                    >
                      {t("dismiss")}
                    </button>
                  </p>
                )}
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

            <div
              className={`${pane === "plan" ? "grid" : "hidden"} min-h-0 ${
                rightPane === "plan" ? "md:grid" : "md:hidden"
              }`}
            >
              <PlanPanel projectId={id} />
            </div>
          </div>

          <PaneBar pane={pane} onChange={setPane} onMore={setPanel} canEdit={canEdit} />
        </div>
      </div>
    </AppShell>
  );
}

/** The app's other tools, in one labelled menu instead of a row of buttons. */
function AppMenu({
  canEdit,
  hasBackend,
  onPanel,
  onOverview,
  onSettings,
}: {
  canEdit: boolean;
  hasBackend: boolean;
  onPanel(panel: AppPanel): void;
  onOverview(): void;
  onSettings(): void;
}) {
  return (
    <Menu
      trigger={
        <Button
          size="sm"
          variant="ghost"
          icon={<MoreHorizontal size={14} />}
          aria-label={t("More app tools")}
        >
          {t("More")}
        </Button>
      }
    >
      <MenuItem icon={<Variable size={14} />} onSelect={() => onPanel("variables")}>
        {t("Variables")}
      </MenuItem>
      {canEdit && (
        <MenuItem icon={<GitBranch size={14} />} onSelect={() => onPanel("git")}>
          {t("Git")}
        </MenuItem>
      )}
      <MenuItem icon={<Camera size={14} />} onSelect={() => onPanel("snapshots")}>
        {t("Snapshots")}
      </MenuItem>
      {canEdit && hasBackend && (
        <MenuItem icon={<Database size={14} />} onSelect={() => onPanel("backend")}>
          {t("Backend")}
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon={<LayoutDashboard size={14} />} onSelect={onOverview}>
        {t("Overview")}
      </MenuItem>
      <MenuItem icon={<Settings size={14} />} onSelect={onSettings}>
        {t("App settings")}
      </MenuItem>
    </Menu>
  );
}

/** Phone-only pane switcher, at the bottom where a thumb reaches. Four even tabs: nothing wraps. */
function PaneBar({
  pane,
  onChange,
  onMore,
  canEdit,
}: {
  pane: Pane;
  onChange(next: Pane): void;
  onMore(panel: AppPanel): void;
  canEdit: boolean;
}) {
  const items: Array<{ id: Pane; label: string; icon: React.ReactNode }> = [
    { id: "chat", label: t("Chat"), icon: <MessageSquare size={18} strokeWidth={1.75} /> },
    { id: "preview", label: t("Preview"), icon: <Monitor size={18} strokeWidth={1.75} /> },
    { id: "code", label: t("Code"), icon: <Code2 size={18} strokeWidth={1.75} /> },
  ];
  const tab =
    "flex flex-col items-center justify-center gap-0.5 py-2 text-2xs font-medium transition-colors";

  return (
    <nav
      aria-label={t("Panes")}
      className="grid grid-cols-4 border-t border-border-default bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          aria-current={pane === item.id ? "page" : undefined}
          className={`${tab} ${pane === item.id ? "text-accent" : "text-fg-muted hover:text-fg-secondary"}`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
      <Menu
        side="top"
        trigger={
          <button
            type="button"
            className={`${tab} ${pane === "plan" ? "text-accent" : "text-fg-muted hover:text-fg-secondary"}`}
          >
            <MoreHorizontal size={18} strokeWidth={1.75} />
            {t("More")}
          </button>
        }
      >
        <MenuItem icon={<Compass size={14} />} onSelect={() => onChange("plan")}>
          {t("Plan")}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Variable size={14} />} onSelect={() => onMore("variables")}>
          {t("Variables")}
        </MenuItem>
        {canEdit && (
          <MenuItem icon={<GitBranch size={14} />} onSelect={() => onMore("git")}>
            {t("Git")}
          </MenuItem>
        )}
        <MenuItem icon={<Camera size={14} />} onSelect={() => onMore("snapshots")}>
          {t("Snapshots")}
        </MenuItem>
      </Menu>
    </nav>
  );
}

/**
 * Where this app is live, per environment, one click from the builder. Deploys
 * themselves run through a pipeline, so this shows the state and the way there
 * rather than pretending to deploy on its own.
 */
function DeployPopover({
  appName,
  appSlug,
  teamId,
}: {
  appName: string;
  appSlug: string;
  teamId: string;
}) {
  const p = useTeamPaths();
  const [open, setOpen] = useState(false);
  const environments = useQuery({
    queryKey: ["environments", teamId],
    queryFn: () => api.deploys.environments(teamId),
    enabled: open,
    retry: false,
  });
  const list = environments.data?.environments ?? [];
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-80"
      trigger={
        <Button size="sm" variant="primary" icon={<Rocket size={13} />}>
          {t("Deploy")}
        </Button>
      }
    >
      <div className="border-b border-border-default px-4 py-3">
        <p className="text-sm font-semibold text-fg">{t("Deploy {appName}", { appName })}</p>
        <p className="mt-0.5 text-xs text-fg-secondary">
          {t("A pipeline puts the app on an environment once its tests pass.")}
        </p>
      </div>
      {environments.isLoading ? (
        <div className="p-4">
          <Spinner label={t("Reading environments")} />
        </div>
      ) : list.length === 0 ? (
        <div className="px-4 py-4 text-sm text-fg-secondary">
          {t("No environments yet. Add one, then a pipeline that deploys this app.")}
        </div>
      ) : (
        <ul className="max-h-64 divide-y divide-border-default overflow-y-auto">
          {list.map((env) => {
            const live = env.live.find((d) => d.app === appName || d.app === appSlug);
            return (
              <li key={env.id}>
                <Link
                  to={live ? p.deployedApp(env.id, live.app) : p.deployments}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                    {env.name}
                  </span>
                  {live ? (
                    <StatusBadge
                      status={statusOf(live.status)}
                      label={
                        live.status === "live"
                          ? t("Live #{number}", { number: live.number })
                          : undefined
                      }
                      variant="inline"
                    />
                  ) : (
                    <span className="text-xs text-fg-muted">{t("Not deployed")}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-end gap-2 border-t border-border-default bg-surface-subtle px-3 py-2">
        <Link
          to={p.pipelines}
          onClick={() => setOpen(false)}
          className={buttonClass("ghost", "sm")}
        >
          {t("Pipelines")}
        </Link>
        <Link
          to={p.deployments}
          onClick={() => setOpen(false)}
          className={buttonClass("secondary", "sm")}
        >
          {list.length === 0 ? t("Set up deployments") : t("All deployments")}
        </Link>
      </div>
    </Popover>
  );
}
