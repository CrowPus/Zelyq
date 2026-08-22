import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChatPanel } from "../components/ChatPanel";
import { CodeViewer } from "../components/CodeViewer";
import { FileExplorer } from "../components/FileExplorer";
import { PreviewPanel } from "../components/PreviewPanel";
import { Button, Spinner } from "../components/ui";
import { useChatSocket } from "../hooks/useChatSocket";
import { api } from "../lib/api";

type Tab = "preview" | "code";

export function ProjectEditorPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("preview");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [logs, setLogs] = useState("");

  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id) });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 60_000 });
  const files = useQuery({ queryKey: ["files", id], queryFn: () => api.listFiles(id) });
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

  // When the agent reports file changes, refresh the tree, the open file, and
  // the preview iframe — a dev server with HMR usually beats us to it, but a
  // config or dependency change needs the reload.
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
    document.title = project.data ? `${project.data.project.name} · Zelyq` : "Zelyq";
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
      <div className="grid h-screen place-items-center">
        <Spinner label="Opening project…" />
      </div>
    );
  }

  if (project.isError) {
    return (
      <div className="grid h-screen place-items-center gap-3 text-center">
        <p className="text-sm text-slate-400">{(project.error as Error).message}</p>
        <Link to="/" className="text-sm text-sky-400 hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    // h-dvh, not h-screen: on mobile browsers the toolbar makes 100vh taller
    // than what is actually visible. overflow-hidden is the backstop that keeps
    // a mis-sized child from scrolling the whole document.
    <div className="grid h-dvh grid-rows-[auto_1fr] overflow-hidden">
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-2.5">
        <Link to="/" className="text-sm text-slate-500 transition-colors hover:text-slate-200">
          ← Projects
        </Link>
        <h1 className="text-sm font-medium text-slate-200">{project.data?.project.name}</h1>
        <div className="ml-auto flex items-center gap-1 rounded-md bg-slate-900 p-0.5">
          {(["preview", "code"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`rounded px-3 py-1 text-xs font-medium capitalize transition-colors ${
                tab === value
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <Button variant="ghost" onClick={() => api.createSnapshot(id, "Manual save")}>
          Snapshot
        </Button>
      </header>

      <div className="grid min-h-0 grid-cols-[minmax(320px,26rem)_minmax(0,1fr)]">
        <ChatPanel chat={chat} model={health.data?.agent.model} />

        {tab === "preview" ? (
          <PreviewPanel
            preview={preview.data?.preview ?? null}
            logs={logs}
            starting={starting}
            onStart={startPreview}
            onStop={stopPreview}
            onRefreshLogs={refreshLogs}
            reloadToken={reloadToken}
          />
        ) : (
          <div className="grid min-h-0 grid-cols-[16rem_minmax(0,1fr)]">
            <div className="min-h-0 overflow-hidden border-r border-slate-800">
              <FileExplorer
                entries={files.data?.entries ?? []}
                selected={selectedPath}
                loading={files.isLoading}
                onSelect={setSelectedPath}
              />
            </div>
            <CodeViewer path={selectedPath} file={file.data ?? null} loading={file.isLoading} />
          </div>
        )}
      </div>
    </div>
  );
}
