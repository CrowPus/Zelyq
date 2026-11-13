import type { RunQueueInfo } from "@zelyq/core";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/** "next", "2nd", "3rd", "11th": a place in line. */
export function placeInLine(position: number): string {
  if (position <= 1) return "next";
  const tens = position % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? "th"
      : position % 10 === 1
        ? "st"
        : position % 10 === 2
          ? "nd"
          : position % 10 === 3
            ? "rd"
            : "th";
  return `${position}${suffix}`;
}

/** "in about 3 min", "any moment now": when a waiting run should start. */
export function startsIn(startsAt: string | null, now = Date.now()): string | null {
  if (!startsAt) return null;
  const seconds = Math.round((Date.parse(startsAt) - now) / 1000);
  if (seconds <= 10) return "any moment now";
  if (seconds < 60) return "in under a minute";
  if (seconds < 90) return "in about a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `in about ${hours} h ${minutes % 60} min`;
}

/** One line for a list: "Waiting · 2nd in line · starts in about 3 min". */
export function queueSummary(queue: RunQueueInfo | null): string {
  if (!queue) return "Waiting to start";
  const when = startsIn(queue.startsAt);
  return [
    queue.position <= 1 ? "Next in line" : `${placeInLine(queue.position)} in line`,
    when ? `starts ${when}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A queued run, explained: its place in line, what it waits for, and roughly
 * when it starts. The time counts down between refreshes.
 */
export function QueueNotice({ queue }: { queue: RunQueueInfo | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const when = queue ? startsIn(queue.startsAt, now) : null;
  const blockers = queue?.blockers ?? [];
  return (
    <section
      aria-live="polite"
      className="mb-3 flex items-start gap-2 rounded-md border border-border-default bg-surface-subtle px-3 py-2 text-sm"
    >
      <Clock size={15} className="mt-0.5 shrink-0 text-fg-muted" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {!queue
            ? "Waiting to start"
            : queue.position <= 1
              ? "Waiting to start · next in line"
              : `Waiting to start · ${placeInLine(queue.position)} in line`}
        </p>
        {queue && (
          <p className="mt-0.5 text-xs text-fg-secondary">
            {queue.reason === "machine" ? (
              <>
                {queue.places === 1
                  ? `${capitalise(queue.machine ?? "The runner")} takes one run at a time, and it is busy`
                  : `All ${queue.places} places on ${queue.machine} are taken`}
                {blockers.length > 0 && <>: </>}
              </>
            ) : (
              <>This pipeline runs one at a time; first </>
            )}
            {blockers.map((blocker, index) => (
              <span key={blocker.id}>
                {index > 0 && ", "}
                <Link
                  to={`/pipelines/${blocker.pipelineId}/runs/${blocker.id}`}
                  className="text-info hover:underline"
                >
                  {blocker.pipelineName} #{blocker.number}
                </Link>
              </span>
            ))}
            .
          </p>
        )}
        {queue && (
          <p className="mt-0.5 text-xs text-fg-secondary">
            {when
              ? `It should start ${when}, going by how long these runs usually take.`
              : "No estimate yet: these pipelines have no passed runs to go by."}
            {queue.reason === "machine" && (
              <>
                {" "}
                To run more at once, raise{" "}
                {queue.machine === "the local runner" ? (
                  <Link to="/settings" className="text-info hover:underline">
                    Local runs at once
                  </Link>
                ) : (
                  "the runner's runs at once in Pipelines › Runners"
                )}
                .
              </>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
