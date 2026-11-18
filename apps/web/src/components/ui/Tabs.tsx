import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  /** When set, the tab is a link (its URL is the state). */
  to?: string;
  hidden?: boolean;
}

/**
 * The one tab bar: underlined, with optional counts. As links when each tab
 * has its own address (so a tab can be shared), as buttons otherwise.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem<NoInfer<T>>[];
  value: T;
  onChange?(value: T): void;
  label: string;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <nav
        aria-label={label}
        className="flex min-w-max items-center gap-1 border-b border-border-default"
      >
        {items
          .filter((item) => !item.hidden)
          .map((item) => {
            const active = item.id === value;
            const className = `relative -mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              active
                ? "border-accent text-fg"
                : "border-transparent text-fg-secondary hover:border-border-strong hover:text-fg"
            }`;
            const content = (
              <>
                {item.icon && <span className="text-fg-muted">{item.icon}</span>}
                {item.label}
                {item.count !== undefined && (
                  <span className="rounded-full bg-surface-active px-1.5 text-2xs font-medium text-fg-secondary tabular-nums">
                    {item.count}
                  </span>
                )}
              </>
            );
            return item.to ? (
              <Link
                key={item.id}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={className}
                onClick={() => onChange?.(item.id)}
              >
                {content}
              </Link>
            ) : (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                className={className}
                onClick={() => onChange?.(item.id)}
              >
                {content}
              </button>
            );
          })}
      </nav>
    </div>
  );
}
