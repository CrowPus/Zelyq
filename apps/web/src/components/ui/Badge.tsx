import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "border-border-default text-fg-secondary bg-surface-subtle",
  success: "border-success/25 text-success bg-success-subtle",
  warning: "border-warning/25 text-warning bg-warning-subtle",
  danger: "border-danger/25 text-danger bg-danger-subtle",
  info: "border-info/25 text-info bg-info-subtle",
};

/** Small, bordered, uppercase — a label, not a decoration. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-[18px] items-center rounded-sm border px-1.5 text-2xs font-medium tracking-[0.04em] uppercase ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const DOTS: Record<Tone, string> = {
  neutral: "bg-fg-muted",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function StatusDot({ tone = "neutral", pulse = false }: { tone?: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-1.5 shrink-0" aria-hidden>
      {pulse && (
        <span className={`absolute inset-0 animate-ping rounded-full opacity-60 ${DOTS[tone]}`} />
      )}
      <span className={`relative inline-flex size-1.5 rounded-full ${DOTS[tone]}`} />
    </span>
  );
}

/** Keyboard hint rendered the way a shortcut actually looks. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-sm border border-border-default bg-surface-subtle px-1 py-px font-sans text-2xs text-fg-muted">
      {children}
    </kbd>
  );
}
