import type { Preview } from "@zelyq/core";
import { ExternalLink, Play, RotateCw, ScrollText, Square } from "lucide-react";
import { useState } from "react";
import { Button, EmptyState, IconButton, Spinner, StatusDot } from "./ui";

interface Props {
  preview: Preview | null;
  logs: string;
  starting: boolean;
  onStart(): void;
  onStop(): void;
  onRefreshLogs(): void;
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
  const [frameToken, setFrameToken] = useState(0);
  const running = preview?.status === "running" && Boolean(preview.url);
  const busy = starting || preview?.status === "starting";

  return (
    <section className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border-default bg-surface px-2.5">
        <StatusDot
          tone={
            preview?.status === "running"
              ? "success"
              : preview?.status === "crashed"
                ? "danger"
                : busy
                  ? "warning"
                  : "neutral"
          }
          pulse={busy}
        />
        <span className="truncate font-mono text-2xs text-fg-muted">
          {running ? preview.url : (preview?.status ?? "stopped")}
        </span>

        <div className="ml-auto flex items-center gap-0.5">
          {running && (
            <>
              <IconButton
                size="sm"
                label="Reload preview"
                onClick={() => setFrameToken((t) => t + 1)}
              >
                <RotateCw size={13} strokeWidth={1.75} />
              </IconButton>
              <a
                href={preview.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                aria-label="Open preview in a new tab"
                title="Open in a new tab"
                className="grid size-6 place-items-center rounded-md text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <ExternalLink size={13} strokeWidth={1.75} />
              </a>
            </>
          )}
          <IconButton
            size="sm"
            label={showLogs ? "Hide logs" : "Show logs"}
            onClick={() => {
              setShowLogs((value) => !value);
              onRefreshLogs();
            }}
            className={showLogs ? "bg-surface-active text-fg" : ""}
          >
            <ScrollText size={13} strokeWidth={1.75} />
          </IconButton>
          {running ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Square size={11} strokeWidth={2.5} />}
              onClick={onStop}
            >
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              icon={
                busy ? undefined : <Play size={11} strokeWidth={2.5} className="fill-current" />
              }
              onClick={onStart}
              disabled={busy}
            >
              {busy ? "Starting…" : "Start preview"}
            </Button>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {running ? (
          <iframe
            key={`${reloadToken}-${frameToken}`}
            src={preview.url ?? ""}
            title="Project preview"
            className="size-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        ) : busy ? (
          <div className="flex h-full flex-col items-center justify-center gap-2.5">
            <Spinner />
            <p className="text-xs text-fg-secondary">
              Installing dependencies and starting the dev server…
            </p>
            <p className="text-2xs text-fg-muted">The first start takes a minute.</p>
          </div>
        ) : preview?.status === "crashed" ? (
          <EmptyState
            title="The dev server stopped"
            description={preview.lastError ?? "Check the logs to see what went wrong."}
            action={
              <Button size="sm" onClick={() => setShowLogs(true)}>
                Show logs
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="Preview is not running"
            description="Start it to see the app. The first start installs dependencies, which takes a moment."
            action={
              <Button size="sm" variant="primary" onClick={onStart}>
                Start preview
              </Button>
            }
          />
        )}

        {showLogs && (
          <div className="absolute inset-x-0 bottom-0 border-t border-border-default bg-surface">
            <div className="flex h-7 items-center justify-between border-b border-border-default px-2.5">
              <span className="text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
                Dev server output
              </span>
              <IconButton size="sm" label="Refresh logs" onClick={onRefreshLogs}>
                <RotateCw size={12} strokeWidth={1.75} />
              </IconButton>
            </div>
            <pre className="max-h-56 overflow-auto px-3 py-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-fg-secondary">
              {logs.trim() || "No output yet."}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}
