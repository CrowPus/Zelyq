import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type AppUsage, accountServiceLinks, type UsageLine } from "@zelyq/core";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { formatDateTime, formatNumber } from "../lib/format";
import { t } from "../lib/i18n";
import { Badge, Button, confirmAction, Spinner } from "./ui";

/** Megabytes in words a person reads: "740 MB", "2.4 GB". */
export function sizeWords(mb: number): string {
  if (mb >= 1024) {
    return `${formatNumber(mb / 1024, { maximumFractionDigits: mb >= 10_240 ? 0 : 1, minimumFractionDigits: mb >= 10_240 ? 0 : 1 })} ${t("GB")}`;
  }
  if (mb >= 10) return `${formatNumber(Math.round(mb))} ${t("MB")}`;
  const digits = mb >= 1 ? 1 : 2;
  return `${formatNumber(mb, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${t("MB")}`;
}

function amount(line: UsageLine, value: number): string {
  if (line.key === "storageMb") return sizeWords(value);
  return `${formatNumber(value)}${line.unit ? ` ${line.unit}` : ""}`;
}

/**
 * What the team uses, against what its plan allows. Over 80% is said; at the
 * limit, only something new is stopped: nothing that exists is touched.
 */
export function UsagePanel({ teamId, canEdit = false }: { teamId: string; canEdit?: boolean }) {
  const queryClient = useQueryClient();
  const { session, teams } = useSession();
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
  // Runs at once is not "nearly full": past it, runs wait in line rather than being refused.
  const near = data.lines.filter(
    (line) => line.key !== "runsAtOnce" && line.limit !== null && line.used >= line.limit * 0.8,
  );
  const accounts = session?.accounts ?? null;
  // Changing the plan is paying for it: the team's owner does that, at the account service.
  const isOwner = teams.find((team) => team.id === teamId)?.role === "owner";
  const title = data.plansVisible ? t("Usage and plan") : t("Usage");

  return (
    <section className="mt-8" aria-label={title}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-medium tracking-[0.06em] text-fg-muted uppercase">{title}</h2>
        {data.plansVisible && <Badge tone="neutral">{data.plan.name}</Badge>}
        {data.plansVisible && accounts && isOwner && (
          <a
            href={accountServiceLinks(accounts).billing(teamId)}
            className="inline-flex items-center gap-1 text-xs text-info underline-offset-2 hover:underline"
          >
            {t("Change plan")}
            <ExternalLink size={11} aria-hidden />
          </a>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          icon={<RefreshCw size={12} />}
          disabled={measure.isPending}
          onClick={() => measure.mutate()}
        >
          {measure.isPending ? t("Measuring…") : t("Measure now")}
        </Button>
      </div>
      <p className="mt-1 text-xs text-fg-secondary">
        {data.measuredAt
          ? t(
              "What this team uses. Storage counts what it made: its apps’ own files and history, undo points, Studio, attachments and pipeline files. Installed packages and builds are not counted. Files measured {measuredAt}.",
              {
                measuredAt: (
                  <time dateTime={data.measuredAt}>{formatDateTime(data.measuredAt)}</time>
                ),
              },
            )
          : t(
              "What this team uses. Storage counts what it made: its apps’ own files and history, undo points, Studio, attachments and pipeline files. Installed packages and builds are not counted.",
            )}
      </p>
      {near.length > 0 && (
        <p className="mt-2 rounded-md border border-warning/25 bg-warning-subtle px-2.5 py-2 text-xs text-fg">
          {t("Close to the plan’s limit:")}{" "}
          {near.map((line) => line.label.toLowerCase()).join(", ")}
          {t(
            ". At the limit, nothing new of that kind can be added; nothing that exists is touched.",
          )}
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
                  {line.limit !== null
                    ? ` of ${amount(line, line.limit)}`
                    : data.plansVisible
                      ? t(" · no limit")
                      : ""}
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
                  {t(
                    "Apps {apps} · undo points {undoPoints} · Studio {studio} · attachments {attachments} · pipelines {pipelines}",
                    {
                      apps: sizeWords(data.storage.apps),
                      undoPoints: sizeWords(data.storage.undoPoints),
                      studio: sizeWords(data.storage.studio),
                      attachments: sizeWords(data.storage.attachments),
                      pipelines: sizeWords(data.storage.pipelines),
                    },
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {data.apps.length > 0 && <FreeUpSpace teamId={teamId} apps={data.apps} canEdit={canEdit} />}
    </section>
  );
}

/** Keep this many newest undo points when freeing space. */
const KEEP_UNDO = 5;

/**
 * Each app, biggest first, with what can be freed: older undo points (the
 * newest five stay) and past chat attachments. It says how much first, and
 * asks before removing anything.
 */
function FreeUpSpace({
  teamId,
  apps,
  canEdit,
}: {
  teamId: string;
  apps: AppUsage[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const free = useMutation({
    mutationFn: async (input: { app: AppUsage; what: "undo" | "attachments" }) => {
      const ask = input.what === "undo" ? { keepUndo: KEEP_UNDO } : { attachments: true as const };
      const look = await api.freeSpace(input.app.id, { ...ask, look: true });
      const words =
        input.what === "undo"
          ? `Remove ${look.undoPointsRemoved} older undo point${look.undoPointsRemoved === 1 ? "" : "s"} of ${input.app.name} (the newest ${KEEP_UNDO} stay)? This frees about ${sizeWords(look.freedMb)}. Those points can no longer be gone back to.`
          : `Remove the chat attachments of ${input.app.name}? This frees about ${sizeWords(look.freedMb)}. The chat text stays; the attached files are gone.`;
      if (
        !(await confirmAction({
          title: t("Free up this space?"),
          description: words,
          confirmLabel: t("Free up space"),
          danger: true,
        }))
      )
        return null;
      return await api.freeSpace(input.app.id, ask);
    },
    onSuccess: (result) => {
      if (!result) return;
      setNote(t("Freed {freedMb}.", { freedMb: sizeWords(result.freedMb) }));
      void queryClient.invalidateQueries({ queryKey: ["team-usage", teamId] });
    },
    onError: (caught) => setNote((caught as Error).message),
  });
  return (
    <div className="mt-6">
      <h3 className="text-sm font-medium text-fg">{t("Free up space")}</h3>
      <p className="mt-0.5 text-xs text-fg-secondary">
        {t(
          "What each app uses, biggest first. Undo points are saved before every AI turn; an app keeps only its newest ones, and you can keep fewer here.",
        )}
      </p>
      {note && <p className="mt-2 text-xs text-fg">{note}</p>}
      <ul className="mt-2 overflow-hidden rounded-lg border border-border-default bg-surface">
        {apps.slice(0, 15).map((app) => (
          <li
            key={app.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border-default px-4 py-2.5 last:border-b-0"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-fg">{app.name}</span>
              <span className="block text-2xs text-fg-muted">
                {t(
                  "files {files} · {undoCount} undo {undoCount, plural, one {point} other {points}} {undoPoints} · attachments {attachments}",
                  {
                    files: sizeWords(app.files),
                    undoCount: app.undoCount,
                    undoPoints: sizeWords(app.undoPoints),
                    attachments: sizeWords(app.attachments),
                  },
                )}
              </span>
            </span>
            {canEdit && app.undoCount > KEEP_UNDO && (
              <Button
                size="sm"
                disabled={free.isPending}
                onClick={() => free.mutate({ app, what: "undo" })}
              >
                {t("Keep newest {KEEP_UNDO} undo points", { KEEP_UNDO })}
              </Button>
            )}
            {canEdit && app.attachments > 0 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={free.isPending}
                onClick={() => free.mutate({ app, what: "attachments" })}
              >
                {t("Remove attachments")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
