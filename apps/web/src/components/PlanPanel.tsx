import { useQuery } from "@tanstack/react-query";
import { parseTopology, TOPOLOGY_PATH } from "@zelyq/core";
import { Compass, RotateCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { buildSafeReportDoc } from "./planReportSanitizer";
import { TopologyDiagram } from "./TopologyDiagram";
import { IconButton } from "./ui";

const REPORT_PATH = "architecture/report.html";

/**
 * Architect Mode's output. Two views:
 *  - **Diagram** — `architecture/topology.json` rendered as an interactive
 *    system-design canvas by first-party code ({@link TopologyDiagram}). The
 *    JSON is data; every string is escaped as SVG text.
 *  - **Report** — `architecture/report.html`, untrusted: a fully locked-down
 *    `sandbox=""` iframe behind a `default-src 'none'` CSP, run through the
 *    allow-policy sanitiser (`buildSafeReportDoc`) first.
 */
export function PlanPanel({ projectId }: { projectId: string }) {
  // Both files may not exist yet when the panel first mounts (the Architect
  // writes them mid-run). `refetchOnMount: "always"` means switching to the
  // Plan tab re-queries even a query that previously 404'd, so the panel
  // recovers on its own instead of staying stuck on a stale miss.
  const report = useQuery({
    queryKey: ["plan", projectId],
    queryFn: () => api.readFile(projectId, REPORT_PATH),
    retry: false,
    refetchOnMount: "always",
  });
  const topologyFile = useQuery({
    queryKey: ["topology", projectId],
    queryFn: () => api.readFile(projectId, TOPOLOGY_PATH),
    retry: false,
    refetchOnMount: "always",
  });

  const topology = useMemo(() => {
    const raw = topologyFile.data?.encoding === "utf8" ? topologyFile.data.content : null;
    return raw ? parseTopology(raw) : null;
  }, [topologyFile.data]);

  const rawHtml = report.data?.encoding === "utf8" ? report.data.content : null;
  const srcDoc = useMemo(() => (rawHtml ? buildSafeReportDoc(rawHtml) : null), [rawHtml]);

  const [tab, setTab] = useState<"diagram" | "report">("diagram");
  // Land on whichever view actually has content.
  useEffect(() => {
    if (!topology && srcDoc) setTab("report");
    else if (topology) setTab("diagram");
  }, [topology, srcDoc]);

  const hasAnything = topology || srcDoc;

  function refresh() {
    report.refetch();
    topologyFile.refetch();
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border-default bg-surface px-2.5">
        <Compass size={13} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
        {hasAnything ? (
          <div className="flex items-center gap-0.5">
            <TabButton
              active={tab === "diagram"}
              disabled={!topology}
              onClick={() => setTab("diagram")}
            >
              System design
            </TabButton>
            <TabButton
              active={tab === "report"}
              disabled={!srcDoc}
              onClick={() => setTab("report")}
            >
              Report
            </TabButton>
          </div>
        ) : (
          <span className="truncate font-mono text-2xs text-fg-muted">no plan yet</span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton size="sm" label="Refresh plan" onClick={refresh}>
            <RotateCw size={13} strokeWidth={1.75} />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {hasAnything ? (
          tab === "diagram" && topology ? (
            <TopologyDiagram topology={topology} />
          ) : srcDoc ? (
            <iframe
              // No `allow-scripts`. `sandbox=""` is the maximally restrictive
              // value. Paired with the CSP inside `srcDoc` and the sanitiser
              // that produced it.
              sandbox=""
              srcDoc={srcDoc}
              title="Architecture plan"
              className="h-full w-full border-0 bg-white"
            />
          ) : (
            <TopologyDiagram topology={topology!} />
          )
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="max-w-sm space-y-2">
              <Compass size={22} strokeWidth={1.5} className="mx-auto text-fg-muted" />
              <p className="text-sm font-medium text-fg">No plan yet</p>
              <p className="text-xs text-fg-muted">
                {report.isLoading || topologyFile.isLoading
                  ? "Loading…"
                  : "Turn on Architect Mode — the compass in the chat composer — and describe what you want to build. It will interview you, then write the design package, the system-design diagram, and this report."}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function TabButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded px-2 py-1 text-2xs font-medium transition-colors ${
        active
          ? "bg-surface-active text-fg"
          : "text-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-fg-muted"
      }`}
    >
      {children}
    </button>
  );
}
