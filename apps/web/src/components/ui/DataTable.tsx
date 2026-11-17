import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Skeleton } from "./Display.js";
import { Checkbox } from "./Field.js";

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell(row: T): ReactNode;
  /** When set, the column sorts by this value. */
  sortValue?(row: T): string | number | null | undefined;
  align?: "start" | "end";
  /** A Tailwind width, e.g. "w-40". */
  width?: string;
  /** Hidden below this breakpoint so a phone keeps the essentials. */
  hideBelow?: "sm" | "md" | "lg";
}

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

/**
 * The one table: sortable headers, optional row selection with a bulk bar,
 * a loading state that keeps its shape, and an empty state inside the frame.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  empty,
  onRowClick,
  selectable,
  bulkActions,
  initialSort,
  caption,
  density = "default",
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey(row: T): string;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?(row: T): void;
  selectable?: boolean;
  bulkActions?(selected: T[], clear: () => void): ReactNode;
  initialSort?: { id: string; dir: "asc" | "desc" };
  /** Read by screen readers; describe what the table lists. */
  caption: string;
  density?: "compact" | "default";
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * factor;
    });
  }, [rows, columns, sort]);

  const selectedRows = sorted.filter((row) => selected.has(rowKey(row)));
  const allChecked =
    sorted.length > 0 && selectedRows.length === sorted.length
      ? true
      : selectedRows.length > 0
        ? "indeterminate"
        : false;
  const pad = density === "compact" ? "py-1.5" : "py-2.5";

  return (
    <div className="overflow-hidden rounded-lg border border-border-default bg-surface">
      {selectable && selectedRows.length > 0 && bulkActions && (
        <div className="flex items-center gap-3 border-b border-border-default bg-accent-subtle px-4 py-2">
          <span className="text-sm font-medium text-fg">{selectedRows.length} selected</span>
          <div className="flex flex-1 items-center gap-2">
            {bulkActions(selectedRows, () => setSelected(new Set()))}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border-default bg-surface-subtle">
              {selectable && (
                <th scope="col" className="w-10 px-4 py-2 text-left">
                  <Checkbox
                    label="Select all"
                    checked={allChecked}
                    onCheckedChange={(next) =>
                      setSelected(next ? new Set(sorted.map(rowKey)) : new Set())
                    }
                  />
                </th>
              )}
              {columns.map((col) => {
                const active = sort?.id === col.id;
                const ariaSort = active
                  ? sort!.dir === "asc"
                    ? "ascending"
                    : "descending"
                  : undefined;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={`px-4 py-2 text-xs font-medium whitespace-nowrap text-fg-muted ${
                      col.align === "end" ? "text-right" : "text-left"
                    } ${col.width ?? ""} ${col.hideBelow ? HIDE[col.hideBelow] : ""}`}
                  >
                    {col.sortValue ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSort(
                            active && sort!.dir === "asc"
                              ? { id: col.id, dir: "desc" }
                              : { id: col.id, dir: "asc" },
                          )
                        }
                        className={`-mx-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-fg ${active ? "text-fg" : ""}`}
                      >
                        {col.header}
                        {active ? (
                          sort!.dir === "asc" ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowDown size={12} />
                          )
                        ) : (
                          <ChevronsUpDown size={12} className="opacity-50" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 4 }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity.
                  <tr key={i} className="border-b border-border-default last:border-0">
                    {selectable && <td className="px-4 py-3" />}
                    {columns.map((col) => (
                      <td
                        key={col.id}
                        className={`px-4 py-3 ${col.hideBelow ? HIDE[col.hideBelow] : ""}`}
                      >
                        <Skeleton className={`h-3 ${i % 2 ? "w-2/3" : "w-1/2"}`} />
                      </td>
                    ))}
                  </tr>
                ))
              : sorted.map((row) => {
                  const key = rowKey(row);
                  const isSelected = selected.has(key);
                  return (
                    <tr
                      key={key}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={`border-b border-border-default transition-colors last:border-0 ${
                        onRowClick ? "cursor-pointer hover:bg-surface-hover" : ""
                      } ${isSelected ? "bg-accent-subtle" : ""}`}
                    >
                      {selectable && (
                        // biome-ignore lint/a11y/useKeyWithClickEvents: the checkbox inside is the keyboard target.
                        <td className={`px-4 ${pad}`} onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            label="Select row"
                            checked={isSelected}
                            onCheckedChange={(next) =>
                              setSelected((current) => {
                                const copy = new Set(current);
                                if (next) copy.add(key);
                                else copy.delete(key);
                                return copy;
                              })
                            }
                          />
                        </td>
                      )}
                      {columns.map((col) => (
                        <td
                          key={col.id}
                          className={`px-4 ${pad} align-middle text-fg ${col.align === "end" ? "text-right" : ""} ${
                            col.hideBelow ? HIDE[col.hideBelow] : ""
                          }`}
                        >
                          {col.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {!loading && sorted.length === 0 && empty}
    </div>
  );
}
