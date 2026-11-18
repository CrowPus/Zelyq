import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type CleanupReportView } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { t } from "../lib/i18n";
import { sizeWords } from "./UsagePanel";
import { Button } from "./ui";

/**
 * The idle-app clean-up: installed packages and build caches of apps nobody
 * used for a while, removed to free disk and given back when the app is
 * previewed again. Look first; then clear.
 */
export function IdleCleanup() {
  const queryClient = useQueryClient();
  const last = useQuery({ queryKey: ["cleanup"], queryFn: api.cleanupLast });
  const [look, setLook] = useState<CleanupReportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (onlyLook: boolean) => api.cleanup(onlyLook),
    onSuccess: ({ last: report }) => {
      setError(null);
      if (report.dryRun) {
        setLook(report);
        return;
      }
      setLook(null);
      queryClient.setQueryData(["cleanup"], { last: report });
      void queryClient.invalidateQueries({ queryKey: ["plan-teams"] });
      void queryClient.invalidateQueries({ queryKey: ["team-usage"] });
    },
    onError: (caught) => setError((caught as Error).message),
  });
  const done = last.data?.last;
  const mb = (bytes: number) => sizeWords(bytes / 1024 / 1024);

  return (
    <section className="mt-8" aria-label={t("Idle apps")}>
      <h3 className="text-sm font-medium text-fg">{t("Idle apps")}</h3>
      <p className="mt-0.5 text-xs leading-relaxed text-fg-secondary">
        {t(
          "Apps nobody has opened, talked to or previewed for a while (Server settings → Runtime) have their installed packages and build caches removed: node_modules, Python environments, framework caches. Nothing a person wrote, and nothing kept in an app’s git history, is touched. The packages come back by themselves the next time the app’s preview starts. This runs every few hours.",
        )}
      </p>
      <p className="mt-2 text-xs text-fg">
        {done
          ? t(
              "Last cleared {at}: {apps, plural, one {# app} other {# apps}}, {freedBytes} freed.",
              { at: formatDateTime(done.at), apps: done.apps, freedBytes: mb(done.freedBytes) },
            )
          : t("Not run yet.")}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" disabled={run.isPending} onClick={() => run.mutate(true)}>
          {run.isPending && run.variables === true ? t("Looking…") : t("See what would be cleared")}
        </Button>
        {look && look.apps > 0 && (
          <Button
            size="sm"
            variant="primary"
            disabled={run.isPending}
            onClick={() => run.mutate(false)}
          >
            {run.isPending && run.variables === false
              ? t("Clearing…")
              : t("Clear now ({freedBytes})", { freedBytes: mb(look.freedBytes) })}
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {look && (
        <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface">
          {look.cleared.length === 0 ? (
            <p className="px-4 py-3 text-xs text-fg-muted">
              {t("No idle app has anything to clear.")}
            </p>
          ) : (
            look.cleared.map((app) => (
              <div
                key={app.projectId}
                className="flex flex-wrap items-baseline gap-x-3 border-b border-border-default px-4 py-2 text-xs last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-fg">{app.name}</span>
                <span className="font-mono text-2xs text-fg-muted">{app.folders.join(", ")}</span>
                <span className="text-fg-secondary">{mb(app.bytes)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
