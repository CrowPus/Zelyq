import type { RunStageSummary, RunStep } from "@zelyq/core";
import { useLayoutEffect, useRef, useState } from "react";
import { duration, RUN_STATUS } from "../../lib/pipelines";
import { Pressable } from "../ui";
import { StatusIcon } from "./Stages";

/**
 * A run as a diagram: each stage a card listing its steps, in columns by
 * what waits for what, joined by lines. Without `needs:` every stage waits
 * for the column before it; with it, each line is a real dependency. Lines
 * out of a passed stage turn green, a line into a running stage moves, and
 * the picked stage's lines stand out. Clicking a step opens its log.
 */
export function RunDiagram({
  stages,
  steps,
  groups,
  needs,
  selected,
  onSelectStage,
  onSelectStep,
}: {
  stages: RunStageSummary[];
  steps: RunStep[];
  /** Stage indexes per column, left to right. */
  groups: number[][];
  /** Per stage, the stages it waits for; null when the file runs top to bottom. */
  needs: number[][] | null;
  selected: number | null;
  onSelectStage(index: number): void;
  onSelectStep(step: RunStep): void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Array<{ key: string; d: string; from: number; to: number }>>(
    [],
  );
  const [size, setSize] = useState({ width: 0, height: 0 });
  const byIndex = new Map(stages.map((stage) => [stage.index, stage]));

  // Columns: as the server laid them out, else one stage per column in order.
  const columns =
    groups.length > 0
      ? groups.map((column) => column.filter((index) => byIndex.has(index)))
      : stages.map((stage) => [stage.index]);
  // Edges: the file's own needs, else each column waits for the one before.
  const edges: Array<[number, number]> = needs
    ? needs.flatMap((waitsFor, to) => waitsFor.map((from) => [from, to] as [number, number]))
    : columns
        .slice(1)
        .flatMap((column, i) =>
          column.flatMap((to) => (columns[i] ?? []).map((from) => [from, to] as [number, number])),
        );
  const edgeKey = edges.map(([a, b]) => `${a}-${b}`).join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: redrawn when the edges (by their key) or the steps change.
  useLayoutEffect(() => {
    const container = frame.current;
    if (!container) return;
    const draw = () => {
      const box = (index: number) =>
        container.querySelector<HTMLElement>(`[data-stage-card="${index}"]`);
      const next: Array<{ key: string; d: string; from: number; to: number }> = [];
      for (const [from, to] of edges) {
        const source = box(from);
        const target = box(to);
        if (!source || !target) continue;
        // Out of the source's header, into the target's header: the line
        // meets each card at the same height, whatever their length.
        const x1 = source.offsetLeft + source.offsetWidth;
        const y1 = source.offsetTop + 22;
        const x2 = target.offsetLeft;
        const y2 = target.offsetTop + 22;
        const bend = Math.max(20, (x2 - x1) / 2);
        next.push({
          key: `${from}-${to}`,
          d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2 - 6} ${y2}`,
          from,
          to,
        });
      }
      setLines(next);
      setSize({ width: container.scrollWidth, height: container.scrollHeight });
    };
    draw();
    const watcher = new ResizeObserver(draw);
    watcher.observe(container);
    return () => watcher.disconnect();
  }, [edgeKey, steps.length]);

  return (
    <div className="overflow-x-auto rounded-lg border border-border-default bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px] bg-surface-subtle">
      <div ref={frame} className="relative flex min-w-max items-start gap-14 p-6">
        <svg
          aria-hidden
          className="pointer-events-none absolute top-0 left-0"
          width={size.width}
          height={size.height}
        >
          <defs>
            <marker
              id="run-arrow"
              viewBox="0 0 10 10"
              refX="1"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0 0L10 5L0 10z" className="fill-border-control" />
            </marker>
          </defs>
          {lines.map((line) => {
            const lit = selected !== null && (line.from === selected || line.to === selected);
            const fromStatus = byIndex.get(line.from)?.status;
            const toStatus = byIndex.get(line.to)?.status;
            return (
              <path
                key={line.key}
                d={line.d}
                fill="none"
                markerEnd="url(#run-arrow)"
                strokeWidth={lit ? 2 : 1.5}
                className={`${
                  lit
                    ? "stroke-accent"
                    : fromStatus === "passed"
                      ? "stroke-success"
                      : "stroke-border-control"
                } ${toStatus === "running" ? "td-flow" : ""}`}
              />
            );
          })}
        </svg>
        {columns.map((column, position) => (
          <div key={column[0] ?? position} className="flex flex-col gap-4">
            {column.map((index) => {
              const stage = byIndex.get(index);
              if (!stage) return null;
              return (
                <StageCard
                  key={index}
                  stage={stage}
                  steps={steps.filter((step) => step.stageIndex === index)}
                  selected={selected === index}
                  onSelect={() => onSelectStage(index)}
                  onSelectStep={onSelectStep}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const EDGE: Record<string, string> = {
  success: "border-l-success",
  danger: "border-l-danger",
  info: "border-l-info",
  warning: "border-l-warning",
  neutral: "border-l-border-strong",
};

function StageCard({
  stage,
  steps,
  selected,
  onSelect,
  onSelectStep,
}: {
  stage: RunStageSummary;
  steps: RunStep[];
  selected: boolean;
  onSelect(): void;
  onSelectStep(step: RunStep): void;
}) {
  const tone = RUN_STATUS[stage.status].tone;
  const progress = stage.total > 0 ? stage.done / stage.total : 0;
  return (
    <div
      data-stage-card={stage.index}
      className={`relative w-64 overflow-hidden rounded-lg border border-l-[3px] bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-[border-color,box-shadow] ${EDGE[tone]} ${
        selected
          ? "border-y-accent border-r-accent shadow-[0_0_0_1px_var(--accent)]"
          : "border-y-border-default border-r-border-default"
      } ${stage.status === "skipped" ? "opacity-60" : ""}`}
    >
      <Pressable
        onClick={onSelect}
        aria-pressed={selected}
        className="flex w-full items-center gap-2 border-b border-border-default px-3 py-2.5 text-left hover:bg-surface-hover"
      >
        <StatusIcon status={stage.status} size={16} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{stage.name}</span>
        <span className="shrink-0 text-xs text-fg-muted tabular-nums">
          {stage.startedAt
            ? duration(stage.startedAt, stage.finishedAt)
            : RUN_STATUS[stage.status].label}
        </span>
      </Pressable>
      {stage.status === "running" && (
        <div className="h-0.5 bg-surface-active">
          <div
            className="h-full bg-info transition-[width]"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
      <ol className="py-1">
        {steps.length === 0 && (
          <li className="px-3 py-1.5 text-xs text-fg-muted">
            {stage.done}/{stage.total} steps
          </li>
        )}
        {steps.map((step) => (
          <li key={step.id}>
            <Pressable
              onClick={() => onSelectStep(step)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface-hover"
            >
              <StatusIcon status={step.status} size={13} />
              <span
                className={`min-w-0 flex-1 truncate ${
                  step.status === "failed" || step.status === "timed_out"
                    ? "font-medium text-danger"
                    : "text-fg-secondary"
                }`}
              >
                {step.name}
                {step.attempt > 1 && <span className="text-fg-muted"> · try {step.attempt}</span>}
              </span>
              <span className="shrink-0 text-fg-muted tabular-nums">
                {step.startedAt ? duration(step.startedAt, step.finishedAt) : ""}
              </span>
            </Pressable>
          </li>
        ))}
      </ol>
    </div>
  );
}
