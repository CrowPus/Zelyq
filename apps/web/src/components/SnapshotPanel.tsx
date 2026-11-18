import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Snapshot } from "@zelyq/core";
import { Camera } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { formatRelative } from "../lib/vault";
import { Button, Drawer, Spinner } from "./ui";

/**
 * Saved copies of the app, and a way back to any of them.
 *
 * The Snapshot button used to save a copy and show nothing — no list, no way
 * to restore it — so a "Manual save" was only reachable by asking the API.
 * Snapshots taken before every agent turn are listed here too: they are the
 * same thing, and "how it was before I asked for the dark header" is often
 * exactly the copy someone wants.
 */
export function SnapshotPanel({
  projectId,
  canEdit,
  onRestored,
  open,
  onOpenChange,
}: {
  projectId: string;
  canEdit: boolean;
  onRestored(): void;
  /** Opened from the app's sidebar (the address says `?panel=snapshots`). */
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);

  const snapshots = useQuery({
    queryKey: ["snapshots", projectId],
    queryFn: () => api.listSnapshots(projectId).then((response) => response.snapshots),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () => api.createSnapshot(projectId, "Manual save"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["snapshots", projectId] }),
  });

  const restore = useMutation({
    mutationFn: (snapshotId: string) => api.restoreSnapshot(projectId, snapshotId),
    onSuccess: () => {
      setConfirming(null);
      onRestored();
    },
  });

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t("Snapshots")}
      description={t(
        "Copies of the app’s files. One is taken before every turn; save your own any time.",
      )}
      actions={
        canEdit && (
          <Button
            size="sm"
            variant="primary"
            loading={save.isPending}
            icon={<Camera size={13} strokeWidth={1.75} />}
            onClick={() => save.mutate()}
          >
            {t("Save now")}
          </Button>
        )
      }
    >
      <div className="px-5 py-3">
        {save.isError && (
          <p role="alert" className="mt-2 text-2xs text-danger">
            {(save.error as Error).message}
          </p>
        )}

        <div>
          {snapshots.isPending && (
            <p className="flex items-center gap-1.5 py-3 text-2xs text-fg-secondary">
              <Spinner className="size-3" /> {t("Reading snapshots…")}
            </p>
          )}
          {snapshots.isError && (
            <p role="alert" className="py-3 text-2xs text-danger">
              {(snapshots.error as Error).message}
            </p>
          )}
          {snapshots.data?.length === 0 && (
            <p className="py-3 text-2xs text-fg-secondary">{t("No snapshots yet.")}</p>
          )}
          {snapshots.data?.map((snapshot) => (
            <SnapshotRow
              key={snapshot.id}
              snapshot={snapshot}
              canEdit={canEdit}
              confirming={confirming === snapshot.id}
              restoring={restore.isPending && restore.variables === snapshot.id}
              onAsk={() => setConfirming(snapshot.id)}
              onCancel={() => setConfirming(null)}
              onRestore={() => restore.mutate(snapshot.id)}
            />
          ))}
        </div>
        {restore.isError && (
          <p role="alert" className="mt-2 text-2xs text-danger">
            {(restore.error as Error).message}
          </p>
        )}
      </div>
    </Drawer>
  );
}

function SnapshotRow({
  snapshot,
  canEdit,
  confirming,
  restoring,
  onAsk,
  onCancel,
  onRestore,
}: {
  snapshot: Snapshot;
  canEdit: boolean;
  confirming: boolean;
  restoring: boolean;
  onAsk(): void;
  onCancel(): void;
  onRestore(): void;
}) {
  return (
    <div className="border-b border-border-default py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-fg" title={snapshot.label}>
            {snapshot.label}
          </p>
          <p className="text-2xs text-fg-muted">
            {t("{createdAt} · {fileCount, plural, one {# file} other {# files}}", {
              createdAt: formatRelative(snapshot.createdAt),
              fileCount: snapshot.fileCount,
            })}
          </p>
        </div>
        {canEdit && !confirming && (
          <button
            type="button"
            onClick={onAsk}
            className="shrink-0 text-2xs text-fg-secondary underline underline-offset-2 hover:text-fg"
          >
            {t("Restore")}
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs">
          <span className="text-warning">
            {t(
              "Put the whole app back as it was then? Every change since is lost — save a snapshot first if you may want it back.",
            )}
          </span>
          <button
            type="button"
            disabled={restoring}
            onClick={onRestore}
            className="text-danger underline underline-offset-2 disabled:opacity-50"
          >
            {restoring ? t("Restoring…") : t("Restore")}
          </button>
          <button type="button" onClick={onCancel} className="underline underline-offset-2">
            {t("Cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
