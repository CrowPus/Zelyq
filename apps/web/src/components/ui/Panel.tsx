import type { ReactNode } from "react";

/** A bordered surface. The default container for anything grouped. */
export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-lg border border-border-default bg-surface ${className}`}>
      {children}
    </div>
  );
}

/**
 * The metric tile pattern: a bordered icon, a small caps label, and a value
 * that carries the weight. Reads as instrumentation rather than marketing.
 */
export function StatTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-md border border-border-default bg-surface text-fg-muted">
        {icon}
      </div>
      <div className="min-w-0 pt-0.5">
        <div className="text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
          {label}
        </div>
        <div className="mt-1 truncate text-sm text-fg">{value}</div>
        {hint && <div className="mt-0.5 truncate text-xs text-fg-muted">{hint}</div>}
      </div>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-border-strong border-t-fg-secondary ${className}`}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      <p className="max-w-sm text-xs leading-relaxed text-fg-secondary">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
