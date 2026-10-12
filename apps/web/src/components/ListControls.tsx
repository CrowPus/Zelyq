import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/** Rows on one page of a long list. */
export const PAGE_SIZE = 10;

function remembered(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function remember(key: string, value: string): void {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Storage blocked: the address still carries the view.
  }
}

/**
 * A list's search, filters and page, kept in the address (a filtered view
 * can be shared, and Back returns to it) and remembered for the browser tab:
 * coming back to the list any other way (the menu, a breadcrumb, a link)
 * opens the same page with the same filters, not the first page. Changing a
 * filter goes back to the first page. Other parameters (such as a tab) are
 * left as they are.
 *
 * `list` names the list and what it belongs to (such as the team), so each
 * remembers its own place.
 */
export function useListParams(list: string, names: readonly string[]) {
  const [params, setParams] = useSearchParams();
  const key = `zelyq.list.${list}`;
  const fields = [...names, "page"];
  const view = new URLSearchParams();
  for (const name of fields) {
    const value = params.get(name);
    if (value) view.set(name, value);
  }
  const current = view.toString();
  // Set while a change made here (search, filter, page, clear) is on its way to the address.
  const ours = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the list's part of the address changes
  useEffect(() => {
    if (!ours.current && !current) {
      // Arrived without a view of its own: open the one this tab had.
      const saved = remembered(key);
      if (saved) {
        setParams(
          (before) => {
            const next = new URLSearchParams(before);
            for (const [name, value] of new URLSearchParams(saved)) {
              if (fields.includes(name)) next.set(name, value);
            }
            return next;
          },
          { replace: true },
        );
        return;
      }
    }
    ours.current = false;
    remember(key, current);
  }, [current, key]);

  const get = (name: string): string => params.get(name) ?? "";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const set = (patch: Record<string, string>) => {
    ours.current = true;
    setParams(
      (before) => {
        const next = new URLSearchParams(before);
        for (const [name, value] of Object.entries(patch)) {
          if (value) next.set(name, value);
          else next.delete(name);
        }
        if (!("page" in patch)) next.delete("page");
        return next;
      },
      { replace: true },
    );
  };
  const filtered = names.some((name) => get(name) !== "");
  const clear = () => set(Object.fromEntries(names.map((name) => [name, ""])));
  return { get, set, page, filtered, clear };
}

/** One page of a list, and the page actually shown (the last one, if the list got shorter). */
export function pageOf<T>(items: T[], page: number, size = PAGE_SIZE): { rows: T[]; page: number } {
  const last = Math.max(1, Math.ceil(items.length / size));
  const shown = Math.min(page, last);
  return { rows: items.slice((shown - 1) * size, shown * size), page: shown };
}

/** Lowercase words; a row matches when every word appears in one of its fields. */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fields.filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

/** The search box; "/" anywhere on the page puts the cursor in it. */
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="relative min-w-0 flex-1 basis-56">
      <Search
        size={14}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted"
      />
      <input
        ref={input}
        type="search"
        aria-label={placeholder}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onChange("");
            event.currentTarget.blur();
          }
        }}
        className="h-[30px] w-full rounded-md border border-border-default bg-surface pr-14 pl-8 text-sm text-fg placeholder:text-fg-muted focus:border-focus focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear the search"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 text-fg-muted hover:text-fg"
        >
          <X size={14} />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-border-default px-1 font-mono text-2xs text-fg-muted sm:block">
          /
        </kbd>
      )}
    </div>
  );
}

/** A compact filter: its label is the first choice, so it reads "All statuses" until one is picked. */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`h-[30px] max-w-full min-w-0 rounded-md border bg-surface px-2 text-sm ${
        value ? "border-focus text-fg" : "border-border-default text-fg-secondary"
      }`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** A filter that is on or off, such as "Starred". */
export function FilterToggle({
  on,
  onChange,
  children,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`inline-flex h-[30px] items-center gap-1.5 rounded-md border px-2.5 text-sm ${
        on
          ? "border-focus bg-surface-subtle text-fg"
          : "border-border-default bg-surface text-fg-secondary hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

/** The row of controls above a list. */
export function ListToolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">{children}</div>;
}

/** "Showing 26–50 of 132", and the way to the other pages. Hidden when everything fits. */
export function Pager({
  page,
  total,
  size = PAGE_SIZE,
  noun,
  all,
  onPage,
}: {
  page: number;
  total: number;
  size?: number;
  /** What is counted, plural: "apps". */
  noun: string;
  /** How many there are without the search and filters, when they hide some. */
  all?: number;
  onPage: (page: number) => void;
}) {
  const of = all !== undefined && all !== total ? ` (${all} in all)` : "";
  const nav = useRef<HTMLElement>(null);
  const last = Math.max(1, Math.ceil(total / size));
  if (total <= size) {
    return total > 0 ? (
      <p className="mt-2 text-xs text-fg-muted">
        {total} {total === 1 ? noun.replace(/s$/, "") : noun}
        {of}
      </p>
    ) : null;
  }
  // The first, the last, and the pages around the current one.
  const shown = [...new Set([1, page - 1, page, page + 1, last])]
    .filter((n) => n >= 1 && n <= last)
    .sort((a, b) => a - b);
  const go = (n: number) => {
    onPage(n);
    // Back to the top of the list's own scrolling area.
    nav.current?.closest(".overflow-y-auto")?.scrollTo({ top: 0 });
  };
  return (
    <nav
      ref={nav}
      aria-label="Pages"
      className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-secondary"
    >
      <span>
        {(page - 1) * size + 1}–{Math.min(page * size, total)} of {total} {noun}
        {of}
      </span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
          className="grid size-7 place-items-center rounded-md border border-border-default hover:bg-surface-hover disabled:opacity-40"
        >
          <ChevronLeft size={14} />
        </button>
        {shown.map((n, index) => (
          <span key={n} className="flex items-center gap-1">
            {index > 0 && n - (shown[index - 1] ?? n) > 1 && <span className="px-0.5">…</span>}
            <button
              type="button"
              aria-label={`Page ${n}`}
              aria-current={n === page ? "page" : undefined}
              onClick={() => go(n)}
              className={`h-7 min-w-7 rounded-md border px-1.5 tabular-nums ${
                n === page
                  ? "border-focus bg-surface-subtle font-medium text-fg"
                  : "border-border-default hover:bg-surface-hover"
              }`}
            >
              {n}
            </button>
          </span>
        ))}
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= last}
          onClick={() => go(page + 1)}
          className="grid size-7 place-items-center rounded-md border border-border-default hover:bg-surface-hover disabled:opacity-40"
        >
          <ChevronRight size={14} />
        </button>
      </span>
    </nav>
  );
}

/** Shown when filters leave nothing: says so, with a way back to everything. */
export function NothingMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-md border border-dashed border-border-default px-4 py-8 text-center text-sm text-fg-secondary">
      Nothing matches.{" "}
      <button type="button" className="text-info hover:underline" onClick={onClear}>
        Clear the search and filters
      </button>
    </div>
  );
}
