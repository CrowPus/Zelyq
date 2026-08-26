import { useQuery } from "@tanstack/react-query";
import { Compass, ExternalLink, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { api } from "../lib/api";
import { IconButton } from "./ui";

const REPORT_PATH = "architecture/report.html";

/**
 * 048 — Architect Mode's output. `architecture/report.html` is a self-contained
 * page (no external assets) the Architect renders from the design package. It
 * is not a running app, so it does not belong behind the Preview button, which
 * starts the project's dev server. This shows it directly from the file, in a
 * sandboxed frame.
 */
export function PlanPanel({ projectId }: { projectId: string }) {
  const report = useQuery({
    queryKey: ["plan", projectId],
    queryFn: () => api.readFile(projectId, REPORT_PATH),
    // The Architect rewrites the report at the end of a run; the editor page
    // invalidates this key when files change, so no polling is needed.
    retry: false,
  });

  const html = report.data?.encoding === "utf8" ? report.data.content : null;
  const missing = report.isError;

  // A blob URL so "open in a new tab" works for a document that only exists
  // in the project workspace, not at any server route.
  const blobUrl = useMemo(() => {
    if (!html) return null;
    return URL.createObjectURL(new Blob([html], { type: "text/html" }));
  }, [html]);
  const prevBlob = useRef<string | null>(null);
  useEffect(() => {
    if (prevBlob.current) URL.revokeObjectURL(prevBlob.current);
    prevBlob.current = blobUrl;
    return () => {
      if (prevBlob.current) URL.revokeObjectURL(prevBlob.current);
    };
  }, [blobUrl]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border-default bg-surface px-2.5">
        <Compass size={13} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
        <span className="truncate font-mono text-2xs text-fg-muted">
          {missing ? "no plan yet" : REPORT_PATH}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton size="sm" label="Refresh plan" onClick={() => report.refetch()}>
            <RotateCw size={13} strokeWidth={1.75} />
          </IconButton>
          {blobUrl && (
            <a
              href={blobUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open the plan in a new tab"
              title="Open in a new tab"
              className="grid size-6 place-items-center rounded-md text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <ExternalLink size={13} strokeWidth={1.75} />
            </a>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {html ? (
          <iframe
            // A model-authored document — sandboxed to a null origin, scripts
            // allowed (the report may toggle its own theme) but with no access
            // to this page, its storage, or navigation.
            sandbox="allow-scripts"
            srcDoc={html}
            title="Architecture plan"
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="max-w-sm space-y-2">
              <Compass size={22} strokeWidth={1.5} className="mx-auto text-fg-muted" />
              <p className="text-sm font-medium text-fg">No plan yet</p>
              <p className="text-xs text-fg-muted">
                {report.isLoading
                  ? "Loading…"
                  : "Turn on Architect Mode — the compass in the chat composer — and describe what you want to build. It will interview you, then write the design package and this report."}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
