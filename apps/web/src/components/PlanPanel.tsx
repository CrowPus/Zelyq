import { useQuery } from "@tanstack/react-query";
import { Compass, RotateCw } from "lucide-react";
import { useMemo } from "react";
import { api } from "../lib/api";
import { buildSafeReportDoc } from "./planReportSanitizer";
import { IconButton } from "./ui";

const REPORT_PATH = "architecture/report.html";

/**
 * Architect Mode's output. `architecture/report.html` is written by the
 * model from the design package. It is untrusted input: rendered in a
 * fully locked-down `sandbox=""` iframe, behind a `default-src 'none'` CSP that
 * trusted code puts first in `<head>`, and run through an allow-policy
 * sanitiser (`buildSafeReportDoc`) that strips every active or network-capable
 * construct before it ever reaches the frame. Three independent layers; the
 * model's file is never trusted because it "looked fine".
 */
export function PlanPanel({ projectId }: { projectId: string }) {
  const report = useQuery({
    queryKey: ["plan", projectId],
    queryFn: () => api.readFile(projectId, REPORT_PATH),
    retry: false,
  });

  const rawHtml = report.data?.encoding === "utf8" ? report.data.content : null;

  // Sanitised, self-contained document: CSP <meta> as the first child of
  // <head>, then the report's own (scrubbed) styles, then its sanitised body.
  const srcDoc = useMemo(() => (rawHtml ? buildSafeReportDoc(rawHtml) : null), [rawHtml]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border-default bg-surface px-2.5">
        <Compass size={13} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
        <span className="truncate font-mono text-2xs text-fg-muted">
          {report.isError ? "no plan yet" : REPORT_PATH}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton size="sm" label="Refresh plan" onClick={() => report.refetch()}>
            <RotateCw size={13} strokeWidth={1.75} />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {srcDoc ? (
          <iframe
            // No `allow-scripts`. `sandbox=""` is the maximally
            // restrictive value: no scripts, no forms, no popups, no
            // same-origin, no top navigation. Paired with the CSP inside
            // `srcDoc` and the sanitiser that produced it.
            sandbox=""
            srcDoc={srcDoc}
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
