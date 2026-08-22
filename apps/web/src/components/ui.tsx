import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Small shared primitives. Not a design system — just the handful of pieces
 * that would otherwise be copy-pasted with slightly different padding.
 */

export function Button({
  variant = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium " +
    "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
    "focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50";

  const variants = {
    default: "bg-slate-800 text-slate-100 hover:bg-slate-700",
    primary: "bg-sky-500 text-slate-950 hover:bg-sky-400",
    ghost: "text-slate-400 hover:bg-slate-800 hover:text-slate-100",
    danger: "bg-red-500/10 text-red-300 hover:bg-red-500/20",
  } as const;

  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function StatusDot({ status }: { status: "ok" | "busy" | "error" | "idle" }) {
  const colors = {
    ok: "bg-emerald-400",
    busy: "bg-amber-400 animate-pulse",
    error: "bg-red-400",
    idle: "bg-slate-600",
  } as const;
  return <span className={`inline-block size-2 rounded-full ${colors[status]}`} aria-hidden />;
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
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h2 className="text-lg font-medium text-slate-200">{title}</h2>
      <p className="max-w-md text-sm leading-relaxed text-slate-500">{description}</p>
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <span
        className="size-3 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400"
        aria-hidden
      />
      {label ?? "Loading…"}
    </div>
  );
}
