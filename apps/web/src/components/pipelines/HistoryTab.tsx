import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PipelineVersionSummary } from "@zelyq/core";
import { History, RotateCcw } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import { TextDiff } from "../DiffView";
import { Badge, Button, EmptyState, RelativeTime, Spinner } from "../ui";

/**
 * A pipeline's history: every saved version — by a person, an agent, a
 * restore or the repository — what each one changed, and putting one back.
 * Restoring saves that file as a new version, so a restore is undone the same
 * way.
 */
export function HistoryTab({
  teamId,
  pipelineId,
  canWrite,
  inRepository,
}: {
  teamId: string;
  pipelineId: string;
  canWrite: boolean;
  inRepository: boolean;
}) {
  const queryClient = useQueryClient();
  const versions = useQuery({
    queryKey: ["pipeline-versions", teamId, pipelineId],
    queryFn: () => api.pipelines.versions(teamId, pipelineId),
  });
  const list = versions.data?.versions ?? [];
  const [selected, setSelected] = useState<number | null>(null);
  const [against, setAgainst] = useState<"previous" | "now">("previous");
  const [confirming, setConfirming] = useState(false);

  const chosen = list.find((v) => v.version === selected) ?? list[0];
  const current = list.find((v) => v.current);
  const base =
    against === "now"
      ? current?.version
      : chosen && list.find((v) => v.version < chosen.version)?.version;

  const chosenSource = useVersion(teamId, pipelineId, chosen?.version);
  const baseSource = useVersion(teamId, pipelineId, base);

  const restore = useMutation({
    mutationFn: (version: number) => api.pipelines.restore(teamId, pipelineId, version),
    onSuccess: async () => {
      setConfirming(false);
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ["pipeline-versions", teamId, pipelineId] });
      await queryClient.invalidateQueries({ queryKey: ["pipeline", teamId, pipelineId] });
    },
  });

  if (versions.isLoading) return <Spinner />;
  if (list.length === 0 || !chosen) {
    return (
      <EmptyState
        title={t("No history yet")}
        description={t(
          "From now on every save of this pipeline is kept here, so you can see what changed and put an earlier version back.",
        )}
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
      <ol className="grid content-start gap-1">
        {list.map((version) => (
          <li key={version.version}>
            <button
              type="button"
              aria-current={version.version === chosen.version}
              onClick={() => {
                setSelected(version.version);
                setConfirming(false);
              }}
              className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                version.version === chosen.version
                  ? "border-focus bg-surface-subtle"
                  : "border-border-default bg-surface hover:bg-surface-hover"
              }`}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
                {t("Version {version}", { version: version.version })}
                {version.current && <Badge tone="success">{t("now")}</Badge>}
              </span>
              <VersionMeta version={version} />
            </button>
          </li>
        ))}
      </ol>

      <div className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs text-fg">
            <History size={13} strokeWidth={1.75} className="text-fg-muted" />
            {t("Version {version}", { version: chosen.version })}
            <span className="text-fg-muted">
              {against === "now"
                ? t("compared with now")
                : base
                  ? t("compared with version {base}", { base })
                  : t("— the first version")}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span className="flex rounded-md border border-border-default p-0.5">
              {(["previous", "now"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={against === value}
                  onClick={() => setAgainst(value)}
                  className={`rounded px-2 py-0.5 text-2xs ${
                    against === value ? "bg-surface-active text-fg" : "text-fg-secondary"
                  }`}
                >
                  {value === "previous" ? t("What it changed") : t("Compared with now")}
                </button>
              ))}
            </span>
            {canWrite && !chosen.current && !inRepository && (
              <Button
                size="sm"
                icon={<RotateCcw size={12} strokeWidth={1.75} />}
                onClick={() => setConfirming(true)}
              >
                {t("Restore")}
              </Button>
            )}
          </span>
        </div>

        {confirming && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default bg-warning-subtle px-3 py-2 text-xs">
            <span>
              {t(
                "Put version {version} back? It is saved as a new version, so this can be undone the same way.",
                { version: chosen.version },
              )}
            </span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                {t("Cancel")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={restore.isPending}
                onClick={() => restore.mutate(chosen.version)}
              >
                {restore.isPending ? t("Restoring…") : t("Restore")}
              </Button>
            </span>
          </div>
        )}
        {restore.isError && (
          <p className="border-b border-border-default px-3 py-2 text-xs text-danger">
            {(restore.error as Error).message}
          </p>
        )}
        {inRepository && (
          <p className="border-b border-border-default px-3 py-2 text-2xs text-fg-muted">
            {t("This file is kept in the repository: put an earlier version back there.")}
          </p>
        )}

        {chosenSource.isLoading || (base !== undefined && baseSource.isLoading) ? (
          <div className="p-3">
            <Spinner />
          </div>
        ) : (
          <div className="flex max-h-[60vh] min-h-0 flex-col">
            <TextDiff
              before={against === "now" ? (chosenSource.data ?? "") : (baseSource.data ?? "")}
              after={against === "now" ? (baseSource.data ?? "") : (chosenSource.data ?? "")}
              empty={
                against === "now"
                  ? t("This version is the same as the pipeline now.")
                  : t("This save did not change the file.")
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

function VersionMeta({ version }: { version: PipelineVersionSummary }) {
  return (
    <span className="mt-0.5 block text-2xs leading-snug text-fg-muted">
      <RelativeTime value={version.createdAt} />
      {version.by ? ` · ${version.by.name}` : ""}
      {version.note ? <span className="block text-fg-secondary">{version.note}</span> : null}
    </span>
  );
}

function useVersion(teamId: string, pipelineId: string, version: number | undefined) {
  return useQuery({
    queryKey: ["pipeline-version", teamId, pipelineId, version],
    queryFn: async () =>
      (await api.pipelines.version(teamId, pipelineId, version as number)).version.source,
    enabled: version !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
