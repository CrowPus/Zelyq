import { AlertTriangle, Check, CheckCircle2, Copy, Info, X, XCircle } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { formatDateTime, formatRelative } from "../../lib/format.js";
import { t } from "../../lib/i18n";
import { Tooltip } from "./Tooltip.js";

/** A placeholder the size and shape of the content it stands in for. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`block animate-pulse rounded-md bg-surface-active motion-reduce:animate-none ${className}`}
    />
  );
}

/** Rows of skeleton lines, for a list or a table that is loading. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3 p-4">
      <span className="sr-only">{t("Loading")}</span>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity.
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={`h-3 ${i % 2 ? "w-1/3" : "w-1/2"}`} />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

type AlertTone = "info" | "success" | "warning" | "danger";

const ALERT: Record<AlertTone, { box: string; icon: ReactNode }> = {
  info: { box: "border-info/25 bg-info-subtle", icon: <Info size={16} className="text-info" /> },
  success: {
    box: "border-success/25 bg-success-subtle",
    icon: <CheckCircle2 size={16} className="text-success" />,
  },
  warning: {
    box: "border-warning/30 bg-warning-subtle",
    icon: <AlertTriangle size={16} className="text-warning" />,
  },
  danger: {
    box: "border-danger/25 bg-danger-subtle",
    icon: <XCircle size={16} className="text-danger" />,
  },
};

/** A message inside the page, next to what it is about. */
export function InlineAlert({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const a = ALERT[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-lg border px-3.5 py-3 ${a.box}`}
    >
      <span className="mt-0.5 shrink-0">{a.icon}</span>
      <div className="min-w-0 flex-1 text-sm text-fg">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? "mt-0.5 text-fg-secondary" : ""}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const AVATAR_HUES = [210, 160, 280, 20, 340, 120, 45, 190];

function hueOf(seed: string): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * A person, a team or an app: an image when there is one, otherwise initials
 * on a colour derived from the name — so two people never look the same.
 */
export function Avatar({
  name,
  src,
  size = 24,
  shape = "circle",
}: {
  name: string;
  src?: string | null;
  size?: number;
  shape?: "circle" | "square";
}) {
  const hue = hueOf(name);
  const radius = shape === "circle" ? "rounded-full" : size >= 32 ? "rounded-lg" : "rounded-md";
  const font =
    size <= 20 ? "text-2xs" : size <= 24 ? "text-2xs" : size <= 32 ? "text-xs" : "text-sm";
  if (src)
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 object-cover ${radius}`}
        style={{ width: size, height: size }}
      />
    );
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center font-semibold ${radius} ${font}`}
      style={{
        width: size,
        height: size,
        background: `light-dark(oklch(0.92 0.05 ${hue}), oklch(0.32 0.06 ${hue}))`,
        color: `light-dark(oklch(0.38 0.11 ${hue}), oklch(0.9 0.07 ${hue}))`,
      }}
    >
      {initials(name).slice(0, shape === "square" ? 1 : 2)}
    </span>
  );
}

/** Copies a value, and says so. */
export function CopyButton({
  value,
  label = "Copy",
  size = "sm",
}: {
  value: string;
  label?: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Tooltip content={copied ? t("Copied") : label}>
      <button
        type="button"
        aria-label={copied ? t("Copied") : label}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => setCopied(true));
        }}
        className={`inline-grid shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg ${
          size === "sm" ? "size-6" : "size-8"
        }`}
      >
        {copied ? (
          <Check size={13} className="text-success" />
        ) : (
          <Copy size={13} strokeWidth={1.75} />
        )}
      </button>
    </Tooltip>
  );
}

/**
 * A time, relative when recent ("3 hours ago"), with the exact local time and
 * time zone on hover — never the browser's raw "11/17/2026, 10:11:49 PM".
 */
export function RelativeTime({
  value,
  className = "",
}: {
  value: string | number | Date;
  className?: string;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <Tooltip content={formatDateTime(date)}>
      <time dateTime={date.toISOString()} className={`whitespace-nowrap ${className}`}>
        {formatRelative(date)}
      </time>
    </Tooltip>
  );
}

/** Label and value pairs, for "details" panels. */
export function DescriptionList({
  items,
  columns = 1,
}: {
  items: Array<{ label: ReactNode; value: ReactNode }>;
  columns?: 1 | 2 | 3;
}) {
  const grid = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[columns];
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-4 ${grid}`}>
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: label/value pairs are positional.
        <div key={i} className="min-w-0">
          <dt className="text-xs text-fg-muted">{item.label}</dt>
          <dd className="mt-1 truncate text-sm text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A small removable token: an active filter, a mode that is on. */
export function Chip({
  children,
  onRemove,
  removeLabel,
}: {
  children: ReactNode;
  onRemove?(): void;
  removeLabel?: string;
}) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-accent/30 bg-accent-subtle pr-1 pl-2 text-xs font-medium text-accent">
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? t("Remove")}
          className="grid size-4 place-items-center rounded-full hover:bg-accent/15"
        >
          <X size={10} strokeWidth={2.5} />
        </button>
      )}
    </span>
  );
}
