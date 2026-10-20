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
import { useEffect, useRef } from "react";
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
 * Stages that ran at the same time stand in one column. Clicking a box
 * shows that stage's steps.
 */
export function StageGraph({
  stages,
  groups = [],
  selected,
  onSelect,
}: {
  stages: RunStageSummary[];
  groups?: number[][];
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  // The stage that matters — the one picked, else the one running, else the
  // last that ran — stays in the strip's frame as the run moves along, so a
  // long pipeline never needs scrolling by hand to see where it is. Only the
  // strip scrolls, never the page, and only when that stage changes.
  const strip = useRef<HTMLDivElement>(null);
  const focus =
    selected ??
    stages.find((stage) => stage.status === "running" || stage.status === "waiting")?.index ??
    [...stages].reverse().find((stage) => stage.startedAt)?.index ??
    null;
  useEffect(() => {
    const container = strip.current;
    if (focus === null || !container) return;
    const box = container.querySelector<HTMLElement>(`[data-stage="${focus}"]`);
    if (!box) return;
    const left = box.offsetLeft; // the strip is the positioned parent
    const right = left + box.offsetWidth;
    const view = { from: container.scrollLeft, to: container.scrollLeft + container.clientWidth };
    if (left >= view.from && right <= view.to) return;
    container.scrollTo({
      left: Math.max(0, left - (container.clientWidth - box.offsetWidth) / 2),
      behavior: "smooth",
    });
  }, [focus]);

  const columns: RunStageSummary[][] = [];
  for (const stage of stages) {
    const group = groups.find((members) => members.includes(stage.index));
    const last = columns[columns.length - 1];
    if (group && last?.[0] && group.includes(last[0].index)) {
      last.push(stage);
    } else {
      columns.push([stage]);
    }
  }
  return (
    <div ref={strip} className="relative overflow-x-auto pb-2">
      <ol className="flex min-w-max items-center">
        {columns.map((column, position) => (
          <li key={column[0]?.index} className="flex items-center">
            {position > 0 && (
              <span aria-hidden className="flex w-8 items-center">
                <span className="h-px flex-1 bg-border-strong" />
                <span className="size-0 border-y-4 border-l-[6px] border-y-transparent border-l-border-strong" />
              </span>
            )}
            <div
              className={`flex flex-col gap-1.5 ${
                column.length > 1
                  ? "rounded-lg border border-dashed border-border-default p-1.5"
                  : ""
              }`}
            >
              {column.map((stage) => (
                <StageBox
                  key={stage.index}
                  stage={stage}
                  selected={selected === stage.index}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StageBox({
  stage,
  selected,
  onSelect,
}: {
  stage: RunStageSummary;
  selected: boolean;
  onSelect: (index: number) => void;
}) {
  const tone = RUN_STATUS[stage.status].tone;
  return (
    <button
      type="button"
      onClick={() => onSelect(stage.index)}
      aria-pressed={selected}
      data-stage={stage.index}
      className={`flex w-44 flex-col gap-1 rounded-md border bg-surface px-3 py-2 text-left transition-colors hover:border-border-strong ${
        selected ? "border-primary ring-1 ring-primary" : "border-border-default"
      } ${stage.status === "skipped" ? "opacity-60" : ""}`}
    >
      <span className="flex items-center gap-1.5">
        <StatusIcon status={stage.status} />
        <span className="truncate text-sm font-medium" title={stage.name}>
          {stage.name}
        </span>
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
  );
}
