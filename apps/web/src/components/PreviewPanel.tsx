import type { Preview } from "@zelyq/core";
import { Crosshair, ExternalLink, Play, RotateCw, ScrollText, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  INSPECTOR_ACTIVATE,
  INSPECTOR_DEACTIVATE,
  isSelectedElementMessage,
  type SelectedElement,
} from "../lib/inspector";
import { resolvePreviewUrl } from "../lib/preview-url";
import { Button, EmptyState, IconButton, Spinner, StatusDot } from "./ui";

interface Props {
  preview: Preview | null;
  logs: string;
  starting: boolean;
  onStart(): void;
  onStop(): void;
  onRefreshLogs(): void;
  reloadToken: number;
  /** Clicked in select mode — see `038`. */
  onElementSelected(element: SelectedElement): void;
}

export function PreviewPanel({
  preview,
  logs,
  starting,
  onStart,
  onStop,
  onRefreshLogs,
  reloadToken,
  onElementSelected,
}: Props) {
  const [showLogs, setShowLogs] = useState(false);
  const [frameToken, setFrameToken] = useState(0);
  const [inspecting, setInspecting] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewUrl = resolvePreviewUrl(preview, window.location.hostname);
  const running = preview?.status === "running" && Boolean(previewUrl);
  const busy = starting || preview?.status === "starting";

  // A fresh iframe (reload, or the frame swapping in after starting) has no
  // idea select mode was ever on — turning it off here rather than trying
  // to re-activate a new content window avoids a message aimed at a frame
  // that's mid-swap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken/frameToken changing IS the trigger — a fresh iframe means select mode has to be re-armed, not carried over silently.
  useEffect(() => {
    setInspecting(false);
  }, [reloadToken, frameToken]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isSelectedElementMessage(event.data)) return;
      onElementSelected(event.data.element);
      setInspecting(false);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onElementSelected]);

  function toggleInspecting() {
    const next = !inspecting;
    setInspecting(next);
    iframeRef.current?.contentWindow?.postMessage(
      { type: next ? INSPECTOR_ACTIVATE : INSPECTOR_DEACTIVATE },
      "*",
    );
  }

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
          {running ? previewUrl : (preview?.status ?? "stopped")}
        </span>

        <div className="ml-auto flex items-center gap-0.5">
          {running && (
            <>
              <IconButton
                size="sm"
                label={
                  inspecting ? "Stop pointing at something" : "Point at something in the preview"
                }
                onClick={toggleInspecting}
                className={inspecting ? "bg-surface-active text-fg" : ""}
              >
                <Crosshair size={13} strokeWidth={1.75} />
              </IconButton>
              <IconButton
                size="sm"
                label="Reload preview"
                onClick={() => setFrameToken((t) => t + 1)}
              >
                <RotateCw size={13} strokeWidth={1.75} />
              </IconButton>
              <a
                href={previewUrl ?? "#"}
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
            ref={iframeRef}
            key={`${reloadToken}-${frameToken}`}
            src={previewUrl ?? ""}
            title="Project preview"
            className={`size-full border-0 bg-white ${inspecting ? "cursor-crosshair" : ""}`}
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
