import type { ReactNode } from "react";

/** A bordered surface. The default container for anything grouped. */
export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-lg border border-border-default bg-surface ${className}`}>
      {children}
    </div>
  );
}

/** A bordered card with an optional header row (title, description, actions). */
export function Card({
  title,
  description,
  actions,
  children,
  footer,
  className = "",
  padded = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={`overflow-hidden rounded-lg border border-border-default bg-surface ${className}`}
    >
      {(title || actions) && (
        <header className="flex items-start gap-3 border-b border-border-default px-4 py-3">
          <div className="min-w-0 flex-1">
            {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-fg-secondary">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      {children !== undefined && <div className={padded ? "p-4" : ""}>{children}</div>}
      {footer && (
        <footer className="flex items-center justify-end gap-2 border-t border-border-default bg-surface-subtle px-4 py-2.5">
          {footer}
        </footer>
      )}
    </section>
  );
}

/**
 * A number with its label: the instrumentation pattern. Optional icon, hint,
 * and a meter for "used out of allowed".
 */
export function StatTile({
  icon,
  label,
  value,
  hint,
  meter,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** 0..1, drawn under the value. */
  meter?: number;
}) {
  const pct = meter === undefined ? null : Math.max(0, Math.min(1, meter));
  return (
    <div className="flex items-start gap-3">
      {icon && (
        <div className="grid size-9 shrink-0 place-items-center rounded-md border border-border-default bg-surface text-fg-muted">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-xs text-fg-muted">{label}</div>
        <div className="mt-1 truncate text-lg font-semibold text-fg tabular-nums">{value}</div>
        {pct !== null && (
          // biome-ignore lint/a11y/useSemanticElements: <meter> cannot be styled consistently across browsers.
          <div
            role="meter"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct * 100)}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-active"
          >
            <div
              className={`h-full rounded-full ${pct >= 0.9 ? "bg-danger" : pct >= 0.75 ? "bg-warning" : "bg-accent"}`}
              style={{ width: `${pct * 100}%` }}
            />
          </div>
        )}
        {hint && <div className="mt-1 truncate text-xs text-fg-muted">{hint}</div>}
      </div>
    </div>
  );
}

export function Spinner({ className = "", label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className={`inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-border-strong border-t-accent ${className}`}
      />
      {label && <span className="text-sm text-fg-secondary">{label}</span>}
    </span>
  );
}

/**
 * What a page shows when there is nothing yet. Says what the thing is, what
 * to do first, and offers the action — an empty page is the first lesson.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  secondary?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex h-full flex-col items-center justify-center gap-2 px-6 text-center ${compact ? "py-8" : "py-14"}`}
    >
      {icon && (
        <div className="mb-2 grid size-11 place-items-center rounded-lg border border-border-default bg-surface text-fg-muted shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
          {icon}
        </div>
      )}
      <p className="text-base font-semibold text-fg">{title}</p>
      <div className="max-w-md text-sm leading-relaxed text-fg-secondary">{description}</div>
      {(action || secondary) && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </div>
  );
}
