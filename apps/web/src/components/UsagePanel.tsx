import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UsageLine } from "@zelyq/core";
import { RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { Badge, Button, Spinner } from "./ui";

/** Megabytes in words a person reads: "740 MB", "2.4 GB". */
export function sizeWords(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10_240 ? 0 : 1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(mb >= 1 ? 1 : 2)} MB`;
}

function amount(line: UsageLine, value: number): string {
  if (line.key === "storageMb") return sizeWords(value);
  return `${value.toLocaleString()}${line.unit ? ` ${line.unit}` : ""}`;
}

/**
 * What the team uses, against what its plan allows. Over 80% is said; at the
 * limit, only something new is stopped: nothing that exists is touched.
 */
export function UsagePanel({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const usage = useQuery({
    queryKey: ["team-usage", teamId],
    queryFn: () => api.teamUsage(teamId),
  });
  const measure = useMutation({
    mutationFn: () => api.teamUsage(teamId, true),
    onSuccess: (next) => queryClient.setQueryData(["team-usage", teamId], next),
  });
  if (usage.isLoading) return <Spinner />;
  const data = usage.data;
  if (!data) return null;
  const near = data.lines.filter((line) => line.limit !== null && line.used >= line.limit * 0.8);

  return (
    <section className="mt-8" aria-label="Usage and plan">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-medium tracking-[0.06em] text-fg-muted uppercase">
          Usage and plan
        </h2>
        <Badge tone="neutral">{data.plan.name}</Badge>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          icon={<RefreshCw size={12} />}
          disabled={measure.isPending}
          onClick={() => measure.mutate()}
        >
          {measure.isPending ? "Measuring…" : "Measure now"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-fg-secondary">
        What this team uses. Storage counts what it made: its apps' own files and history, undo
        points, Studio, attachments and pipeline files. Installed packages and builds are not
        counted.
        {data.measuredAt ? ` Files measured ${new Date(data.measuredAt).toLocaleString()}.` : ""}
      </p>
      {near.length > 0 && (
        <p className="mt-2 rounded-md border border-warning/25 bg-warning-subtle px-2.5 py-2 text-xs text-fg">
          Close to the plan's limit: {near.map((line) => line.label.toLowerCase()).join(", ")}. At
          the limit, nothing new of that kind can be added; nothing that exists is touched.
        </p>
      )}
      <ul className="mt-2 grid gap-px overflow-hidden rounded-lg border border-border-default bg-border-default">
        {data.lines.map((line) => {
          const share = line.limit ? Math.min(1, line.used / line.limit) : 0;
          return (
            <li key={line.key} className="bg-surface px-4 py-2.5" title={line.description}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-fg">{line.label}</span>
                <span className="text-xs text-fg-secondary">
                  {amount(line, line.used)}
                  {line.limit !== null ? ` of ${amount(line, line.limit)}` : " · no limit"}
                </span>
              </div>
              {line.limit !== null && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-hover">
                  <div
                    className={`h-full rounded-full ${share >= 1 ? "bg-danger" : share >= 0.8 ? "bg-warning" : "bg-primary"}`}
                    style={{ width: `${Math.max(share * 100, line.used > 0 ? 2 : 0)}%` }}
                  />
                </div>
              )}
              {line.key === "storageMb" && (
                <p className="mt-1 text-2xs text-fg-muted">
                  Apps {sizeWords(data.storage.apps)} · undo points{" "}
                  {sizeWords(data.storage.undoPoints)} · Studio {sizeWords(data.storage.studio)} ·
                  attachments {sizeWords(data.storage.attachments)} · pipelines{" "}
                  {sizeWords(data.storage.pipelines)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
