import type { RunQueueInfo } from "@zelyq/core";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "../../lib/i18n";
import { teamHref } from "../../lib/routes";

/** "next", "2nd", "3rd", "11th": a place in line. */
export function placeInLine(position: number): string {
  if (position <= 1) return t("next");
  return t("{position, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}", { position });
}

/** "in about 3 min", "any moment now": when a waiting run should start. */
export function startsIn(startsAt: string | null, now = Date.now()): string | null {
  if (!startsAt) return null;
  const seconds = Math.round((Date.parse(startsAt) - now) / 1000);
  if (seconds <= 10) return t("any moment now");
  if (seconds < 60) return t("in under a minute");
  if (seconds < 90) return t("in about a minute");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("in about {minutes} min", { minutes });
  const hours = Math.floor(minutes / 60);
  return t("in about {hours} h {minutes} min", { hours, minutes: minutes % 60 });
}

/** One line for a list: "Waiting · 2nd in line · starts in about 3 min". */
export function queueSummary(queue: RunQueueInfo | null): string {
  if (!queue) return t("Waiting to start");
  if (queue.reason === "update") return t("Waiting for the Zelyq update");
  if (queue.reason === "plan")
    return [
      t("{places, plural, one {Your plan runs one at a time} other {Your plan runs # at a time}}", {
        places: queue.places ?? 1,
      }),
      startsIn(queue.startsAt) ? t("starts {when}", { when: startsIn(queue.startsAt) }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const when = startsIn(queue.startsAt);
  return [
    queue.position <= 1
      ? t("Next in line")
      : t("{position, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} in line", {
          position: queue.position,
        }),
    when ? t("starts {when}", { when }) : null,
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
            ? t("Waiting to start")
            : queue.position <= 1
              ? t("Waiting to start · next in line")
              : t(
                  "Waiting to start · {position, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} in line",
                  { position: queue.position },
                )}
        </p>
        {queue?.reason === "update" && (
          <p className="mt-0.5 text-xs text-fg-secondary">
            {t(
              "Zelyq is being updated. Runs already going finish first; this one starts as soon as the update is done.",
            )}
          </p>
        )}
        {queue && queue.reason !== "update" && (
          <p className="mt-0.5 text-xs text-fg-secondary">
            {queue.reason === "plan" ? (
              <>
                {t(
                  "{places, plural, one {Your team's plan runs one pipeline at a time} other {Your team's plan runs # pipelines at a time}}",
                  { places: queue.places ?? 1 },
                )}
                {t("{going, plural, one {, and one is going} other {, and # are going}}", {
                  going: Math.max(blockers.length, queue.places ?? 1),
                })}
                {blockers.length > 0 && <>: </>}
              </>
            ) : queue.reason === "machine" ? (
              <>
                {queue.places === 1
                  ? t("{value} takes one run at a time, and it is busy", {
                      value: queue.machine ? capitalise(queue.machine) : t("The runner"),
                    })
                  : t("All {places} places on {machine} are taken", {
                      places: queue.places,
                      machine: queue.machine,
                    })}
                {blockers.length > 0 && <>: </>}
              </>
            ) : (
              <>{t("This pipeline runs one at a time; first")} </>
            )}
            {blockers.map((blocker, index) => (
              <span key={blocker.id}>
                {index > 0 && ", "}
                <Link
                  to={teamHref(`/pipelines/${blocker.pipelineId}/runs/${blocker.id}`)}
                  className="text-info hover:underline"
                >
                  {blocker.pipelineName} #{blocker.number}
                </Link>
              </span>
            ))}
            .
          </p>
        )}
        {queue && queue.reason !== "update" && (
          <p className="mt-0.5 text-xs text-fg-secondary">
            {when
              ? t("It should start {when}, going by how long these runs usually take.", { when })
              : t("No estimate yet: these pipelines have no passed runs to go by.")}
            {queue.reason === "plan" && <> {t("A bigger plan runs more at once.")}</>}
            {queue.reason === "machine" && (
              <>
                {t(" To run more at once, raise ")}
                {queue.machine === "the local runner" ? (
                  <Link to="/admin" className="text-info hover:underline">
                    {t("Local runs at once")}
                  </Link>
                ) : (
                  t("the runner’s runs at once in Pipelines › Runners")
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
