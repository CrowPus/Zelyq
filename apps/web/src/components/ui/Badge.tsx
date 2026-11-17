import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  Loader2,
  Square,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "border-border-default text-fg-secondary bg-surface-subtle",
  success: "border-success/25 text-success bg-success-subtle",
  warning: "border-warning/25 text-warning bg-warning-subtle",
  danger: "border-danger/25 text-danger bg-danger-subtle",
  info: "border-info/25 text-info bg-info-subtle",
  accent: "border-accent/25 text-accent bg-accent-subtle",
};

function sentence(children: ReactNode): ReactNode {
  return typeof children === "string" && children.length > 0
    ? children[0]!.toUpperCase() + children.slice(1)
    : children;
}

/** A small label. Sentence case: a badge is read, not shouted. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}
    >
      {sentence(children)}
    </span>
  );
}

const DOTS: Record<Tone, string> = {
  neutral: "bg-fg-muted",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  accent: "bg-accent",
};

export function StatusDot({ tone = "neutral", pulse = false }: { tone?: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2 shrink-0" aria-hidden>
      {pulse && (
        <span
          className={`absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none ${DOTS[tone]}`}
        />
      )}
      <span className={`relative inline-flex size-2 rounded-full ${DOTS[tone]}`} />
    </span>
  );
}

/**
 * The one status vocabulary. Every object with a lifecycle — a preview, a run,
 * a stage, a deployment, an agent — maps onto these eight states. Each has an
 * icon as well as a colour, so status never rests on colour alone.
 */
export type Status =
  | "running"
  | "succeeded"
  | "failed"
  | "warning"
  | "queued"
  | "stopped"
  | "skipped"
  | "unknown";

const STATUS: Record<Status, { tone: Tone; icon: ReactNode; label: string }> = {
  running: {
    tone: "info",
    icon: (
      <Loader2 size={12} strokeWidth={2.25} className="animate-spin motion-reduce:animate-none" />
    ),
    label: "Running",
  },
  succeeded: {
    tone: "success",
    icon: <CheckCircle2 size={12} strokeWidth={2.25} />,
    label: "Passed",
  },
  failed: { tone: "danger", icon: <XCircle size={12} strokeWidth={2.25} />, label: "Failed" },
  warning: {
    tone: "warning",
    icon: <AlertTriangle size={12} strokeWidth={2.25} />,
    label: "Needs attention",
  },
  queued: { tone: "neutral", icon: <Clock size={12} strokeWidth={2.25} />, label: "Queued" },
  stopped: { tone: "neutral", icon: <Square size={11} strokeWidth={2.25} />, label: "Stopped" },
  skipped: { tone: "neutral", icon: <Ban size={12} strokeWidth={2.25} />, label: "Skipped" },
  unknown: {
    tone: "neutral",
    icon: <CircleDashed size={12} strokeWidth={2.25} />,
    label: "Unknown",
  },
};

export function StatusBadge({
  status,
  label,
  variant = "badge",
}: {
  status: Status;
  /** The object's own word for the state: "Live", "Building", "Ready". */
  label?: string;
  /** `badge` is bordered; `inline` is icon and text, for dense rows. */
  variant?: "badge" | "inline";
}) {
  const s = STATUS[status];
  const text = label ?? s.label;
  if (variant === "inline") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${TONES[s.tone].split(" ").find((c) => c.startsWith("text-"))}`}
      >
        {s.icon}
        <span
          className={
            status === "skipped" ||
            status === "stopped" ||
            status === "queued" ||
            status === "unknown"
              ? "text-fg-secondary"
              : ""
          }
        >
          {text}
        </span>
      </span>
    );
  }
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap ${TONES[s.tone]}`}
    >
      {s.icon}
      {text}
    </span>
  );
}

/** Map any of the product's raw state words onto the shared vocabulary. */
export function statusOf(raw: string | null | undefined): Status {
  switch ((raw ?? "").toLowerCase()) {
    case "running":
    case "building":
    case "deploying":
    case "starting":
    case "creating":
    case "in_progress":
    case "pending":
    case "working":
      return "running";
    case "ready":
    case "passed":
    case "success":
    case "succeeded":
    case "live":
    case "healthy":
    case "online":
    case "done":
    case "completed":
      return "succeeded";
    case "failed":
    case "error":
    case "crashed":
    case "down":
    case "offline":
      return "failed";
    case "degraded":
    case "warning":
    case "unhealthy":
      return "warning";
    case "queued":
    case "waiting":
    case "waiting_approval":
    case "approval":
      return "queued";
    case "stopped":
    case "paused":
    case "idle":
    case "archived":
      return "stopped";
    case "skipped":
    case "cancelled":
    case "canceled":
      return "skipped";
    default:
      return "unknown";
  }
}

/** Keyboard hint rendered the way a shortcut actually looks. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border-default bg-surface-subtle px-1 font-sans text-2xs font-medium text-fg-muted">
      {children}
    </kbd>
  );
}
