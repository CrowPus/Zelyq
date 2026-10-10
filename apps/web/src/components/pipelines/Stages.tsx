import type { RunStageSummary, StepStatus } from "@zelyq/core";
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Hand,
  Loader2,
  MinusCircle,
  TimerOff,
  XCircle,
} from "lucide-react";
import { duration, RUN_STATUS } from "../../lib/pipelines";

const ICONS: Record<StepStatus | "queued", typeof CheckCircle2> = {
  queued: CircleDashed,
  pending: CircleDashed,
  running: Loader2,
  waiting: Hand,
  passed: CheckCircle2,
  failed: XCircle,
  skipped: MinusCircle,
  cancelled: Ban,
  timed_out: TimerOff,
};

const COLOURS: Record<string, string> = {
  neutral: "text-fg-muted",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

const FILLS: Record<string, string> = {
  neutral: "bg-border-strong",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

/** The status as an icon, in its colour; spins while running. */
export function StatusIcon({
  status,
  size = 14,
}: {
  status: StepStatus | "queued";
  size?: number;
}) {
  const Icon = ICONS[status];
  const tone = RUN_STATUS[status].tone;
  return (
    <Icon
      size={size}
      aria-label={RUN_STATUS[status].label}
      className={`shrink-0 ${COLOURS[tone]} ${status === "running" ? "animate-spin" : ""}`}
    />
  );
}

/** One small block per stage, for a row in a list: where a run got to, at a glance. */
export function StageStrip({ stages }: { stages: RunStageSummary[] }) {
  if (stages.length === 0) return null;
  return (
    <span className="flex items-center gap-0.5" title="Stages">
      {stages.map((stage) => (
        <span
          key={stage.index}
          title={`${stage.name}: ${RUN_STATUS[stage.status].label}`}
          className={`h-2 w-5 rounded-sm ${FILLS[RUN_STATUS[stage.status].tone]} ${
            stage.status === "running" ? "animate-pulse" : ""
          } ${stage.status === "skipped" || stage.status === "pending" ? "opacity-40" : ""}`}
        />
      ))}
    </span>
  );
}

/**
 * The run as a picture: a box per stage, left to right, joined by arrows.
 * Clicking a box shows that stage's steps.
 */
export function StageGraph({
  stages,
  selected,
  onSelect,
}: {
  stages: RunStageSummary[];
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <ol className="flex min-w-max items-center">
        {stages.map((stage, position) => {
          const tone = RUN_STATUS[stage.status].tone;
          const isSelected = selected === stage.index;
          return (
            <li key={stage.index} className="flex items-center">
              {position > 0 && (
                <span aria-hidden className="flex w-8 items-center">
                  <span className="h-px flex-1 bg-border-strong" />
                  <span className="size-0 border-y-4 border-l-[6px] border-y-transparent border-l-border-strong" />
                </span>
              )}
              <button
                type="button"
                onClick={() => onSelect(stage.index)}
                aria-pressed={isSelected}
                className={`flex w-44 flex-col gap-1 rounded-md border bg-surface px-3 py-2 text-left transition-colors hover:border-border-strong ${
                  isSelected ? "border-primary ring-1 ring-primary" : "border-border-default"
                } ${stage.status === "skipped" ? "opacity-60" : ""}`}
              >
                <span className="flex items-center gap-1.5">
                  <StatusIcon status={stage.status} />
                  <span className="truncate text-sm font-medium">{stage.name}</span>
                </span>
                <span className={`text-2xs ${COLOURS[tone]}`}>
                  {RUN_STATUS[stage.status].label}
                  <span className="text-fg-muted">
                    {" "}
                    · {stage.done}/{stage.total} steps
                    {stage.startedAt && ` · ${duration(stage.startedAt, stage.finishedAt)}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
