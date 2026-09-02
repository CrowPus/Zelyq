import { type CSSProperties, useEffect, useState } from "react";
import { type Body, POSTURE_LABEL, pace } from "../lib/posture";
import { AgentBody } from "./AgentBody";

/**
 * The agent's presence, pinned above the composer.
 *
 * It started inside the streaming message, which is where the old spinner sat,
 * and that was wrong for the same reason a spinner would be: the turn grows
 * downward past it, so within seconds you had to scroll up to find out what
 * the agent was doing. A status you have to go looking for is not ambient. It
 * belongs at the edge of the conversation, in one fixed place, the way a
 * status bar does.
 */
export interface AgentPresenceProps {
  body: Body;
  /** Only shown while a turn is actually running. */
  active: boolean;
}

export function AgentPresence({ body, active }: AgentPresenceProps) {
  const elapsed = useElapsed(active);
  if (!active) return null;

  return (
    <div
      className="agent-presence flex shrink-0 items-center gap-2.5 px-3 py-2"
      style={{ "--presence-speed": pace(body.tempo).toFixed(2) } as CSSProperties}
    >
      <AgentBody body={body} size={26} className="shrink-0" />
      <span className="shrink-0 text-xs font-medium text-fg">{POSTURE_LABEL[body.posture]}</span>
      {body.focus && (
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-fg-muted">
          {body.focus}
        </span>
      )}
      <span className="ml-auto shrink-0 font-mono text-2xs text-fg-muted tabular-nums">
        {formatElapsed(elapsed)}
      </span>
    </div>
  );
}

/**
 * Seconds since the turn began. Kept here rather than in the event stream
 * because it is a property of watching, not of what happened — a reload
 * mid-turn should show how long you have been waiting, and the transcript
 * should not carry a number that only means something live.
 */
function useElapsed(active: boolean): number {
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      setStart(null);
      return;
    }
    setStart(Date.now());
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  return start === null ? 0 : Math.max(0, Math.floor((now - start) / 1000));
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}
