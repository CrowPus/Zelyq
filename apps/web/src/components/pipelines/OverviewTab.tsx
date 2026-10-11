import { useQuery } from "@tanstack/react-query";
import type { PipelineStats } from "@zelyq/core";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { formatRelative } from "../../lib/vault";
import { EmptyState, Spinner } from "../ui";
import { StatusIcon } from "./Stages";

/**
 * How the team's pipelines are doing: a few numbers, runs per day, each
 * pipeline's success rate and time, and the slowest stages.
 *
 * Passed is a quiet grey and failed the danger red, with stripes: they differ
 * in lightness and texture, not only in hue, so the chart reads the same for
 * colour-blind people (checked with the palette validator), and the legend,
 * the hover details and the table say it in words too.
 */
const RANGES = [7, 14, 30] as const;

export function OverviewTab({ teamId }: { teamId: string }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(14);
  const stats = useQuery({
    queryKey: ["pipeline-stats", teamId, days],
    queryFn: () => api.pipelines.stats(teamId, days),
    refetchInterval: 30_000,
  });
  const data = stats.data?.stats;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-secondary">Every run of this team's pipelines.</p>
        <div
          role="tablist"
          aria-label="Period"
          className="inline-flex rounded-md border border-border-default bg-surface p-0.5 text-xs"
        >
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              role="tab"
              aria-selected={days === range}
              onClick={() => setDays(range)}
              className={`rounded px-3 py-1 ${
                days === range
                  ? "bg-surface-hover font-medium text-fg"
                  : "text-fg-secondary hover:text-fg"
              }`}
            >
              {range} days
            </button>
          ))}
        </div>
      </div>

      {stats.isLoading || !data ? (
        <Spinner />
      ) : data.totals.runs === 0 ? (
        <EmptyState
          title={`No runs in the last ${days} days`}
          description="When pipelines run, how they go shows here: success rate, time, and the slowest stages."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Runs" value={compact(data.totals.runs)} hint={`last ${days} days`} />
            <Tile
              label="Success rate"
              value={percent(data.totals.successRate)}
              hint={`${data.totals.passed} passed · ${data.totals.failed} failed`}
            />
            <Tile label="Typical run" value={time(data.totals.medianMs)} hint="the middle run" />
            <Tile
              label="Failing now"
              value={String(data.totals.failingNow)}
              hint={
                data.totals.failingNow === 1
                  ? "pipeline's newest run failed"
                  : "pipelines' newest run failed"
              }
              warn={data.totals.failingNow > 0}
            />
          </div>

          <section className="rounded-md border border-border-default bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Runs per day</h2>
              <Legend />
            </div>
            <RunsChart daily={data.daily} />
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-fg-secondary">Show as a table</summary>
              <table className="mt-2 w-full max-w-md">
                <thead className="text-left text-fg-muted">
                  <tr>
                    <th className="py-1 font-medium">Day</th>
                    <th className="py-1 text-right font-medium">Passed</th>
                    <th className="py-1 text-right font-medium">Failed</th>
                    <th className="py-1 text-right font-medium">Cancelled</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((day) => (
                    <tr key={day.day} className="border-t border-border-default">
                      <td className="py-1">{dayLabel(day.day, true)}</td>
                      <td className="py-1 text-right tabular-nums">{day.passed}</td>
                      <td className="py-1 text-right tabular-nums">{day.failed}</td>
                      <td className="py-1 text-right tabular-nums">{day.other}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          <section className="rounded-md border border-border-default bg-surface">
            <h2 className="border-b border-border-default px-4 py-2.5 text-sm font-semibold">
              Pipelines
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-fg-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Pipeline</th>
                    <th className="px-2 py-2 text-right font-medium">Runs</th>
                    <th className="px-2 py-2 font-medium">Success rate</th>
                    <th className="px-2 py-2 text-right font-medium">Average time</th>
                    <th className="px-4 py-2 font-medium">Newest run</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pipelines.map((pipeline) => (
                    <tr key={pipeline.id} className="border-t border-border-default">
                      <td className="max-w-56 truncate px-4 py-2">
                        <Link to={`/pipelines/${pipeline.id}`} className="hover:underline">
                          {pipeline.name}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{pipeline.runs}</td>
                      <td className="px-2 py-2">
                        <Rate value={pipeline.successRate} />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {time(pipeline.averageMs)}
                      </td>
                      <td className="px-4 py-2">
                        {pipeline.last ? (
                          <Link
                            to={`/pipelines/${pipeline.id}/runs/${pipeline.last.id}`}
                            className="inline-flex items-center gap-1.5 text-xs text-fg-secondary hover:text-fg"
                          >
                            <StatusIcon status={pipeline.last.status} size={13} />#
                            {pipeline.last.number} · {formatRelative(pipeline.last.createdAt)}
                          </Link>
                        ) : (
                          <span className="text-xs text-fg-muted">never run</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {data.slowStages.length > 0 && (
            <section className="rounded-md border border-border-default bg-surface p-4">
              <h2 className="mb-1 text-sm font-semibold">Slowest stages</h2>
              <p className="mb-3 text-xs text-fg-secondary">
                On average, over the runs in this period: where a faster runner, a cache or running
                stages at the same time would help most.
              </p>
              <SlowStages stages={data.slowStages} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  warn = false,
}: {
  label: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-md border border-border-default bg-surface px-4 py-3">
      <p className="text-xs text-fg-secondary">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${warn ? "text-danger" : "text-fg"}`}>
        {value}
      </p>
      <p className="mt-0.5 truncate text-2xs text-fg-muted">{hint}</p>
    </div>
  );
}

/** A success rate as a number and a meter: the fill turns warning, then danger, as it falls. */
function Rate({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-fg-muted">—</span>;
  const tone = value >= 0.9 ? "bg-success" : value >= 0.6 ? "bg-warning" : "bg-danger";
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-hover">
        <span
          className={`block h-full rounded-full ${tone}`}
          style={{ width: `${value * 100}%` }}
        />
      </span>
      <span className="text-xs tabular-nums">{percent(value)}</span>
    </span>
  );
}

function Legend() {
  return (
    <ul className="flex items-center gap-3 text-xs text-fg-secondary">
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm" style={{ background: PASSED }} />
        Passed
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden="true">
          <rect width="10" height="10" rx="2" fill={FAILED} />
          <path
            d="M-2 4 L4 -2 M-2 10 L10 -2 M4 12 L12 4"
            stroke="var(--surface)"
            strokeWidth="1.2"
          />
        </svg>
        Failed
      </li>
    </ul>
  );
}

const PASSED = "var(--chart-passed)";
const FAILED = "var(--danger)";

/**
 * Columns per day: passed at the bottom, failed stacked on top, 2px apart,
 * rounded only at the top. One axis, a few clean ticks, hairline grid; hover a
 * day for its numbers.
 */
function RunsChart({ daily }: { daily: PipelineStats["daily"] }) {
  const pattern = useId().replaceAll(":", "");
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at its real size, so text is never stretched: measure the width.
  const frame = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(640);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const update = () => setMeasured(Math.max(320, element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = 160;
  const top = 8;
  const left = 28;
  const width = measured;
  const slot = (width - left) / daily.length;
  // A label every few days, so they never touch.
  const every = Math.max(1, Math.ceil(54 / slot));
  const most = Math.max(1, ...daily.map((day) => day.passed + day.failed));
  const step = niceStep(most);
  const ceiling = Math.ceil(most / step) * step;
  const y = (value: number) => top + (height - top) * (1 - value / ceiling);
  const bar = Math.max(4, Math.min(24, slot * 0.6));
  const ticks = Array.from({ length: ceiling / step + 1 }, (_, index) => index * step);
  const shown = hover === null ? null : daily[hover];
  return (
    <div ref={frame} className="relative">
      <div>
        <svg
          width={width}
          height={height + 22}
          viewBox={`0 0 ${width} ${height + 22}`}
          className="block"
          role="img"
          aria-label="Runs per day, passed and failed"
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <pattern
              id={pattern}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="5" height="5" fill={FAILED} />
              <line x1="0" y1="0" x2="0" y2="5" stroke="var(--surface)" strokeWidth="1.4" />
            </pattern>
          </defs>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={left}
                x2={width}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--border-default)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={left - 6}
                y={y(tick) + 3}
                textAnchor="end"
                className="fill-fg-muted text-[10px]"
              >
                {tick}
              </text>
            </g>
          ))}
          {daily.map((day, index) => {
            const x = left + index * slot + (slot - bar) / 2;
            const passedTop = y(day.passed);
            const failedTop = y(day.passed + day.failed);
            const gap = day.passed > 0 && day.failed > 0 ? 2 : 0;
            return (
              <g key={day.day}>
                {day.passed > 0 && (
                  <path
                    d={column(x, passedTop, bar, y(0) - passedTop, day.failed === 0)}
                    fill={PASSED}
                    opacity={hover === null || hover === index ? 1 : 0.45}
                  />
                )}
                {day.failed > 0 && (
                  <path
                    d={column(x, failedTop, bar, passedTop - failedTop - gap, true)}
                    fill={`url(#${pattern})`}
                    opacity={hover === null || hover === index ? 1 : 0.45}
                  />
                )}
                {(daily.length - 1 - index) % every === 0 && (
                  <text
                    x={left + index * slot + slot / 2}
                    y={height + 15}
                    textAnchor="middle"
                    className="fill-fg-muted text-[10px]"
                  >
                    {dayLabel(day.day)}
                  </text>
                )}
                {/* The whole day's column is the hover target, not only the bar. */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: hover details only; the same numbers are in "Show as a table" */}
                <rect
                  x={left + index * slot}
                  y={0}
                  width={slot}
                  height={height}
                  fill="transparent"
                  onMouseEnter={() => setHover(index)}
                />
              </g>
            );
          })}
        </svg>
      </div>
      {shown && hover !== null && (
        <div
          className={`pointer-events-none absolute top-0 z-10 rounded-md border border-border-default bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md ${
            // Near the right edge it opens to the left of the day, so it is never squeezed.
            left + hover * slot > width * 0.7 ? "-translate-x-full" : ""
          }`}
          style={{
            left: left + hover * slot + slot / 2 + (left + hover * slot > width * 0.7 ? -10 : 10),
          }}
        >
          <p className="font-medium">{dayLabel(shown.day, true)}</p>
          <p className="text-fg-secondary">
            {shown.passed} passed · {shown.failed} failed
            {shown.other > 0 && ` · ${shown.other} cancelled`}
          </p>
        </div>
      )}
    </div>
  );
}

/** A column with only its top corners rounded (4px), square at the baseline. */
function column(x: number, y: number, width: number, height: number, roundTop: boolean): string {
  if (height <= 0) return "";
  const radius = roundTop ? Math.min(4, height, width / 2) : 0;
  return `M${x},${y + height} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + width - radius} Q${x + width},${y} ${x + width},${y + radius} V${y + height} Z`;
}

function SlowStages({ stages }: { stages: PipelineStats["slowStages"] }) {
  const longest = Math.max(1, ...stages.map((stage) => stage.averageMs));
  return (
    <ul className="grid gap-2">
      {stages.map((stage) => (
        <li
          key={`${stage.pipelineId}-${stage.stage}`}
          className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)] items-center gap-3 text-xs"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">{stage.stage}</span>
            <Link
              to={`/pipelines/${stage.pipelineId}`}
              className="block truncate text-fg-muted hover:underline"
            >
              {stage.pipelineName} · {stage.runs} run{stage.runs === 1 ? "" : "s"}
            </Link>
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="h-2.5 rounded-r bg-info/70"
              style={{ width: `${Math.max(2, (stage.averageMs / longest) * 100)}%` }}
            />
            <span className="shrink-0 tabular-nums text-fg-secondary">{time(stage.averageMs)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function niceStep(most: number): number {
  const rough = most / 4;
  const power = 10 ** Math.floor(Math.log10(Math.max(1, rough)));
  return (
    [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ??
    power * 10
  );
}

function compact(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K` : String(value);
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function time(ms: number | null): string {
  if (ms === null) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function dayLabel(day: string, long = false): string {
  const date = new Date(`${day}T00:00:00Z`);
  return date.toLocaleDateString(undefined, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(long ? { weekday: "short" } : {}),
  });
}
