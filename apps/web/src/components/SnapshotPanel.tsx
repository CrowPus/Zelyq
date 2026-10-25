import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Snapshot } from "@zelyq/core";
import { Camera } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { formatRelative } from "../lib/vault";
import { Button, Spinner } from "./ui";

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
}: {
  projectId: string;
  canEdit: boolean;
  onRestored(): void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
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
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        icon={<Camera size={13} strokeWidth={1.75} />}
        onClick={() => setOpen((current) => !current)}
        className="max-md:px-1.5"
      >
        <span className="max-md:hidden">Snapshot</span>
      </Button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Snapshots"
            className="absolute top-full right-0 z-20 mt-1.5 w-[22rem] rounded-lg border border-border-default bg-overlay p-3 shadow-overlay"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-2xs leading-relaxed text-fg-secondary">
                Copies of the app's files. One is taken before every turn; save your own any time.
              </p>
              {canEdit && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={save.isPending}
                  onClick={() => save.mutate()}
                  className="shrink-0"
                >
                  {save.isPending ? "Saving…" : "Save now"}
                </Button>
              )}
            </div>
            {save.isError && (
              <p role="alert" className="mt-2 text-2xs text-danger">
                {(save.error as Error).message}
              </p>
            )}

            <div className="mt-3 max-h-80 overflow-y-auto border-t border-border-default">
              {snapshots.isPending && (
                <p className="flex items-center gap-1.5 py-3 text-2xs text-fg-secondary">
                  <Spinner className="size-3" /> Reading snapshots…
                </p>
              )}
              {snapshots.isError && (
                <p role="alert" className="py-3 text-2xs text-danger">
                  {(snapshots.error as Error).message}
                </p>
              )}
              {snapshots.data?.length === 0 && (
                <p className="py-3 text-2xs text-fg-secondary">No snapshots yet.</p>
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
        </>
      )}
    </div>
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
            {formatRelative(snapshot.createdAt)} · {snapshot.fileCount} file
            {snapshot.fileCount === 1 ? "" : "s"}
          </p>
        </div>
        {canEdit && !confirming && (
          <button
            type="button"
            onClick={onAsk}
            className="shrink-0 text-2xs text-fg-secondary underline underline-offset-2 hover:text-fg"
          >
            Restore
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs">
          <span className="text-warning">
            Put the whole app back as it was then? Every change since is lost — save a snapshot
            first if you may want it back.
          </span>
          <button
            type="button"
            disabled={restoring}
            onClick={onRestore}
            className="text-danger underline underline-offset-2 disabled:opacity-50"
          >
            {restoring ? "Restoring…" : "Restore"}
          </button>
          <button type="button" onClick={onCancel} className="underline underline-offset-2">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
