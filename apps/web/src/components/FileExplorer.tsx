import type { FileEntry } from "@zelyq/core";
import { useMemo } from "react";
import { Spinner } from "./ui";

interface Props {
  entries: FileEntry[];
  selected: string | null;
  loading: boolean;
  onSelect(path: string): void;
}

export function FileExplorer({ entries, selected, loading, onSelect }: Props) {
  // The API returns a flat list; indentation is derived from the path so the
  // server never has to build a tree.
  const rows = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        depth: entry.path.split("/").length - 1,
      })),
    [entries],
  );

  if (loading) {
    return (
      <div className="p-4">
        <Spinner label="Reading files…" />
      </div>
    );
  }

  return (
    // Without h-full the nav takes its content height and the parent clips it,
    // so the bottom of a long tree becomes unreachable rather than scrollable.
    <nav
      aria-label="Project files"
      className="h-full overflow-y-auto overscroll-contain py-2 text-sm"
    >
      {rows.map((entry) => {
        const isSelected = entry.path === selected;
        return (
          <button
            key={entry.path}
            type="button"
            disabled={entry.type === "directory"}
            onClick={() => onSelect(entry.path)}
            style={{ paddingLeft: `${entry.depth * 12 + 12}px` }}
            className={`flex w-full items-center gap-1.5 py-1 pr-3 text-left transition-colors ${
              entry.type === "directory"
                ? "cursor-default font-medium text-slate-500"
                : isSelected
                  ? "bg-sky-500/15 text-sky-200"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            }`}
          >
            <span aria-hidden className="text-slate-600">
              {entry.type === "directory" ? "▸" : "·"}
            </span>
            <span className="truncate">{entry.name}</span>
          </button>
        );
      })}
    </nav>
  );
}
