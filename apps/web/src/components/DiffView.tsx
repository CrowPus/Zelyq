import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { collapseUnchanged, countChanges, diffLines } from "../lib/diff";
import { Spinner } from "./ui";

interface Props {
  projectId: string;
  /** The project as it stood before the turn being examined. */
  snapshotId: string;
  path: string;
  /** The file as it is now. */
  current: string;
}

/**
 * What a turn did to one file, in the form people actually read a change:
 * removed lines struck through in red, added lines in green, and the untouched
 * stretches folded away.
 *
 * A list of filenames tells you a file was touched. It does not tell you
 * whether a heading changed or the whole component was replaced, which is the
 * only question worth asking before deciding to undo.
 */
export function DiffView({ projectId, snapshotId, path, current }: Props) {
  const before = useQuery({
    queryKey: ["snapshot-file", projectId, snapshotId, path],
    // A 404 means the snapshot had no such file, so the turn created it. That
    // is a real answer, not a failure — an empty "before".
    queryFn: () =>
      api
        .readSnapshotFile(projectId, snapshotId, path)
        .then((file) => (file.encoding === "utf8" ? file.content : null))
        .catch(() => ""),
  });

  if (before.isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-fg-muted">
        <Spinner /> Working out what changed…
      </div>
    );
  }

  if (before.data === null) {
    return <p className="px-3 py-3 text-xs text-fg-muted">{path} is not a text file.</p>;
  }

  const lines = diffLines(before.data ?? "", current);
  const { added, removed } = countChanges(lines);

  if (added === 0 && removed === 0) {
    return (
      <p className="px-3 py-3 text-xs text-fg-muted">This turn did not change {path} in the end.</p>
    );
  }

  const rows = collapseUnchanged(lines);

  return (
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border-default bg-surface px-3 py-1.5 text-2xs">
        <span className="text-success">+{added} added</span>
        <span className="text-danger">−{removed} removed</span>
        <span className="text-fg-muted">unchanged lines hidden</span>
      </div>

      <table className="w-full border-collapse font-mono text-xs leading-[1.6]">
        <tbody>
          {rows.map((row, index) =>
            row === "gap" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
              <tr key={`gap-${index}`} className="bg-surface-subtle">
                <td colSpan={3} className="px-3 py-0.5 text-center text-2xs text-fg-muted">
                  ⋯
                </td>
              </tr>
            ) : (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
                key={index}
                className={
                  row.kind === "added"
                    ? "bg-success-subtle"
                    : row.kind === "removed"
                      ? "bg-danger-subtle"
                      : ""
                }
              >
                <td className="w-10 border-r border-border-default px-1.5 text-right align-top text-fg-muted select-none tabular-nums">
                  {row.before ?? ""}
                </td>
                <td className="w-10 border-r border-border-default px-1.5 text-right align-top text-fg-muted select-none tabular-nums">
                  {row.after ?? ""}
                </td>
                <td
                  className={`px-3 whitespace-pre ${
                    row.kind === "added"
                      ? "text-success"
                      : row.kind === "removed"
                        ? "text-danger"
                        : "text-fg-secondary"
                  }`}
                >
                  <span className="mr-2 inline-block w-2 select-none">
                    {row.kind === "added" ? "+" : row.kind === "removed" ? "−" : " "}
                  </span>
                  {row.text || " "}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
