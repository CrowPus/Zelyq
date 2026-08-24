import { type CSSProperties, useEffect, useRef, useState } from "react";

export interface ZelyqThinkingProps {
  /** What the agent is doing right now — "Thinking…", "Building…", … */
  status?: string;
  /** Logo height/width in pixels. Vector underneath, so any size stays sharp. */
  size?: number;
  className?: string;
  /** Whether the indicator should be animating at all. */
  active?: boolean;
  /** Repeat the manifest → settle → reset cycle, or play it once and hold. */
  loop?: boolean;
}

const CYCLE_MS = 2000;

/**
 * Zelyq's own thinking indicator.
 *
 * The Z is never faded in as one piece — it is drawn from three segments
 * that are contiguous pieces of a *single* stroke path (`M20,20 L80,20
 * L20,80 L80,80`, split at its own corners). However each piece is
 * revealed, the three can only ever line up into the same one Z: there is
 * no separate "assembled" artwork whose alignment could drift from the
 * pieces that build it.
 *
 * Top and bottom reveal with opacity + a small scale-and-blur settle. The
 * diagonal draws itself along its own direction using `stroke-dasharray`/
 * `stroke-dashoffset` against a normalised `pathLength` — a real directional
 * reveal, not a fade standing in for one. Once complete, the whole mark
 * tilts a few degrees and springs back before dissolving and repeating.
 *
 * Pure CSS: the project has no animation library, and nothing here needs
 * one. Every keyframe animates `transform`, `opacity`, or `filter` — never a
 * property that forces layout — so this stays on the compositor regardless
 * of how many are on screen.
 */
export function ZelyqThinking({
  status = "Thinking…",
  size = 32,
  className = "",
  active = true,
  loop = true,
}: ZelyqThinkingProps) {
  const [visible, setVisible] = useState(active);
  // Set when `active` goes false — checked at the next natural loop
  // boundary rather than acted on immediately, so a turn that finishes
  // mid-assembly still gets to complete the piece it was drawing instead of
  // vanishing half-built.
  const pendingStop = useRef(false);

  useEffect(() => {
    if (active) {
      pendingStop.current = false;
      setVisible(true);
    } else {
      pendingStop.current = true;
    }
  }, [active]);

  const handleBoundary = () => {
    if (pendingStop.current) setVisible(false);
  };

  if (!visible) return null;

  const [label, ellipsis] = splitTrailingEllipsis(status);

  return (
    <div
      className={`zt-root inline-flex items-center gap-2 ${className}`}
      style={{ "--zt-size": `${size}px` } as CSSProperties}
    >
      <svg
        className="zt-svg"
        width={size}
        height={size}
        viewBox="0 0 100 100"
        role="img"
        aria-label="Zelyq is thinking"
      >
        <defs>
          <linearGradient id="zt-grad" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0a1440" />
            <stop offset="45%" stopColor="#2151e0" />
            <stop offset="100%" stopColor="#2fe0f5" />
          </linearGradient>
        </defs>
        <g
          className="zt-group"
          style={loop ? undefined : { animationIterationCount: 1 }}
          onAnimationIteration={handleBoundary}
          onAnimationEnd={handleBoundary}
        >
          <path className="zt-seg zt-top" d="M20,20 L80,20" />
          <path className="zt-seg zt-diagonal" d="M80,20 L20,80" pathLength={1} />
          <path className="zt-seg zt-bottom" d="M20,80 L80,80" />
          {/* The reference logo's signature crease of light along the fold. */}
          <path className="zt-highlight" d="M72,28 L28,72" pathLength={1} />
        </g>
      </svg>
      {status && (
        <span className="zt-status text-xs text-fg-secondary">
          {label}
          {ellipsis && <span className="zt-ellipsis">{ellipsis}</span>}
        </span>
      )}
      <style>{STYLES}</style>
    </div>
  );
}

/** Splits a trailing `…`/`...` off so only it gets the pulse, not the word. */
function splitTrailingEllipsis(status: string): [string, string] {
  const match = /(\.\.\.|…)$/.exec(status);
  if (!match) return [status, ""];
  return [status.slice(0, -match[0].length), match[0]];
}

const STYLES = `
.zt-svg { display: block; overflow: visible; flex-shrink: 0; }

.zt-seg {
  fill: none;
  stroke: url(#zt-grad);
  stroke-width: 16;
  stroke-linecap: round;
  stroke-linejoin: round;
  transform-box: fill-box;
  transform-origin: center;
}

.zt-highlight {
  fill: none;
  stroke: #ffffff;
  stroke-width: 2.5;
  stroke-linecap: round;
  opacity: 0;
}

.zt-group {
  transform-box: view-box;
  transform-origin: 50px 50px;
  animation: zt-group ${CYCLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1) infinite;
}

.zt-top {
  animation: zt-top ${CYCLE_MS}ms ease-out infinite;
}
.zt-bottom {
  animation: zt-bottom ${CYCLE_MS}ms ease-out infinite;
}

.zt-diagonal {
  stroke-dasharray: 1;
  animation:
    zt-diagonal-draw ${CYCLE_MS}ms cubic-bezier(0.4, 0, 0.2, 1) infinite,
    zt-diagonal-fade ${CYCLE_MS}ms linear infinite;
}
.zt-highlight {
  stroke-dasharray: 1;
  animation:
    zt-diagonal-draw ${CYCLE_MS}ms cubic-bezier(0.4, 0, 0.2, 1) infinite,
    zt-highlight-fade ${CYCLE_MS}ms linear infinite;
}

/* Phase 1 — top: opacity, a small scale settle, blur-to-sharp. 0-260ms. */
@keyframes zt-top {
  0% { opacity: 0; transform: scale(0.94); filter: blur(3px); }
  13% { opacity: 1; transform: scale(1); filter: blur(0); }
  72.5% { opacity: 1; transform: scale(1); filter: blur(0); }
  85% { opacity: 0; transform: scale(0.97); filter: blur(2px); }
  100% { opacity: 0; transform: scale(0.94); filter: blur(3px); }
}

/* Phase 3 — bottom: same treatment as the top, starting once the diagonal
   is under way. 430-690ms. */
@keyframes zt-bottom {
  0%, 21.5% { opacity: 0; transform: scale(0.94); filter: blur(3px); }
  34.5% { opacity: 1; transform: scale(1); filter: blur(0); }
  72.5% { opacity: 1; transform: scale(1); filter: blur(0); }
  85% { opacity: 0; transform: scale(0.97); filter: blur(2px); }
  100% { opacity: 0; transform: scale(0.94); filter: blur(3px); }
}

/* Phase 2 — diagonal: draws itself along its own direction, starting while
   the top is still settling in. 180-480ms. */
@keyframes zt-diagonal-draw {
  0%, 9% { stroke-dashoffset: 1; }
  24% { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: 0; }
}
@keyframes zt-diagonal-fade {
  0%, 9% { opacity: 0; }
  10% { opacity: 1; }
  85% { opacity: 1; }
  85.01%, 100% { opacity: 0; }
}
@keyframes zt-highlight-fade {
  0%, 10% { opacity: 0; }
  24% { opacity: 0.55; }
  70% { opacity: 0.55; }
  85% { opacity: 0; }
  100% { opacity: 0; }
}

/* Phase 4 — a small confident tilt and spring once fully assembled (held
   from the reveal finishing at ~690ms to here), then a brief settle before
   the next cycle's dissolve. 850-1250ms of a 2000ms cycle. */
@keyframes zt-group {
  0%, 42.5% { transform: rotate(0deg) scale(1); }
  50% { transform: rotate(10deg) scale(1); }
  56% { transform: rotate(-1.5deg) scale(1.03); }
  62.5%, 100% { transform: rotate(0deg) scale(1); }
}

.zt-ellipsis {
  display: inline-block;
  animation: zt-ellipsis-pulse 1.4s ease-in-out infinite;
}
@keyframes zt-ellipsis-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .zt-group,
  .zt-top,
  .zt-bottom,
  .zt-diagonal,
  .zt-highlight,
  .zt-ellipsis {
    animation: none !important;
  }
  .zt-seg,
  .zt-highlight {
    opacity: 1;
    filter: none;
    transform: none;
    stroke-dashoffset: 0;
  }
}
`;
