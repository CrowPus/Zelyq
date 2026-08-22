import type { Preview } from "@zelyq/core";
import { useState } from "react";
import { Button, EmptyState, Spinner, StatusDot } from "./ui";

interface Props {
  preview: Preview | null;
  logs: string;
  starting: boolean;
  onStart(): void;
  onStop(): void;
  onRefreshLogs(): void;
  /** Bumped by the parent to force the iframe to reload after a change. */
  reloadToken: number;
}

export function PreviewPanel({
  preview,
  logs,
  starting,
  onStart,
  onStop,
  onRefreshLogs,
  reloadToken,
}: Props) {
  const [showLogs, setShowLogs] = useState(false);
  const running = preview?.status === "running" && preview.url;

  return (
    <section className="flex h-full min-h-0 flex-col bg-slate-950">
      <header className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <StatusDot
          status={
            preview?.status === "running"
              ? "ok"
              : preview?.status === "crashed"
                ? "error"
                : starting || preview?.status === "starting"
                  ? "busy"
                  : "idle"
          }
        />
        <span className="text-xs text-slate-500">
          {running ? preview.url : (preview?.status ?? "stopped")}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => {
              setShowLogs((value) => !value);
              onRefreshLogs();
            }}
          >
            Logs
          </Button>
          {running ? (
            <Button variant="ghost" onClick={onStop}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" onClick={onStart} disabled={starting}>
              {starting ? "Starting…" : "Start preview"}
            </Button>
          )}
        </div>
      </header>

      <div className="relative flex-1">
        {running ? (
          <iframe
            key={reloadToken}
            src={preview.url ?? ""}
            title="Project preview"
            className="size-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        ) : starting || preview?.status === "starting" ? (
          <div className="flex h-full items-center justify-center">
            <Spinner label="Installing dependencies and starting the dev server…" />
          </div>
        ) : preview?.status === "crashed" ? (
          <EmptyState
            title="The dev server stopped"
            description={preview.lastError ?? "Check the logs to see what went wrong."}
          />
        ) : (
          <EmptyState
            title="Preview is not running"
            description="Start it to see the app. The first start installs dependencies, which takes a moment."
          />
        )}

        {showLogs && (
          <pre className="absolute inset-x-0 bottom-0 max-h-64 overflow-auto border-t border-slate-800 bg-slate-950/95 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-400">
            {logs.trim() || "No output yet."}
          </pre>
        )}
      </div>
    </section>
  );
}
