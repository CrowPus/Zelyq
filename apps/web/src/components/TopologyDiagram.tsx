import type { Topology } from "@zelyq/core";
import { Minus, Plus, Scan } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from "react";
import { layerColor, layoutTopology, NODE_H, NODE_W } from "./topologyLayout";
import { IconButton } from "./ui";

const MIN_SCALE = 0.35;
const MAX_SCALE = 2.4;

/**
 * The live system-design view. Renders a {@link Topology} as an interactive
 * SVG: layered columns, curved connectors with protocol labels, hover-to-trace
 * (a node lights its direct path and dims everything else), click to pin that
 * focus, drag to pan, wheel to zoom. Theme-aware through the app's CSS vars.
 */
export function TopologyDiagram({ topology }: { topology: Topology }) {
  const layout = useMemo(() => layoutTopology(topology), [topology]);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const active = focused ?? hovered;
  const lit = useMemo(() => {
    if (!active) return null;
    const nodes = new Set<string>([active, ...(layout.neighbours.get(active) ?? [])]);
    const edges = layout.incident.get(active) ?? new Set<string>();
    return { nodes, edges };
  }, [active, layout]);

  const layerLabel = new Map(topology.layers.map((l) => [l.id, l.label]));
  const layerIdx = new Map(topology.layers.map((l, i) => [l.id, i]));

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setScale((s) => clamp(s * (e.deltaY < 0 ? 1.12 : 0.89), MIN_SCALE, MAX_SCALE));
  }
  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  }
  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    setPan({
      x: drag.current.px + (e.clientX - drag.current.x),
      y: drag.current.py + (e.clientY - drag.current.y),
    });
  }
  function endDrag() {
    drag.current = null;
  }
  function reset() {
    setScale(1);
    setPan({ x: 0, y: 0 });
    setFocused(null);
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-canvas">
      {topology.title || topology.summary ? (
        <div className="shrink-0 border-b border-border-default px-4 py-2.5">
          {topology.title ? (
            <h3 className="text-sm font-semibold text-fg">{topology.title}</h3>
          ) : null}
          {topology.summary ? (
            <p className="mt-0.5 text-xs text-fg-muted">{topology.summary}</p>
          ) : null}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <svg
          className="h-full w-full touch-none select-none"
          role="img"
          aria-label={topology.title ?? "System design diagram"}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={() => {
            endDrag();
            setHovered(null);
          }}
          style={{ cursor: drag.current ? "grabbing" : "grab" }}
        >
          <defs>
            <marker
              id="td-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-fg-muted)" />
            </marker>
            <marker
              id="td-arrow-lit"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-primary)" />
            </marker>
          </defs>

          <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
            {/* layer bands */}
            {topology.layers.map((layer, i) => {
              const x = 40 + i * (NODE_W + 96) - 16;
              return (
                <g key={layer.id} opacity={active ? 0.5 : 1}>
                  <rect
                    x={x}
                    y={8}
                    width={NODE_W + 32}
                    height={layout.height - 16}
                    rx={12}
                    fill="var(--color-surface-subtle)"
                    stroke="var(--color-border-default)"
                    strokeDasharray="3 4"
                    opacity={0.5}
                  />
                  <text
                    x={x + (NODE_W + 32) / 2}
                    y={26}
                    textAnchor="middle"
                    className="fill-fg-muted"
                    fontSize={10}
                    fontWeight={600}
                    style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
                  >
                    {layer.label}
                  </text>
                </g>
              );
            })}

            {/* edges */}
            {layout.edges.map((edge) => {
              const isLit = lit?.edges.has(edge.id) ?? false;
              const dim = lit && !isLit;
              return (
                <g key={edge.id} opacity={dim ? 0.12 : 1} style={{ transition: "opacity .15s" }}>
                  <path
                    d={edge.d}
                    fill="none"
                    stroke={isLit ? "var(--color-primary)" : "var(--color-fg-muted)"}
                    strokeWidth={isLit ? 2 : 1.25}
                    strokeDasharray={edge.kind === "async" ? "5 5" : undefined}
                    markerEnd={`url(#td-arrow${isLit ? "-lit" : ""})`}
                    className={isLit && edge.kind !== "async" ? "td-flow" : undefined}
                  />
                  {edge.protocol ? (
                    <text
                      x={edge.mx}
                      y={edge.my - 4}
                      textAnchor="middle"
                      fontSize={9}
                      className={isLit ? "fill-fg" : "fill-fg-muted"}
                      style={{
                        paintOrder: "stroke",
                        stroke: "var(--color-canvas)",
                        strokeWidth: 3,
                      }}
                    >
                      {edge.protocol}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {/* nodes */}
            {layout.nodes.map((node) => {
              const isActive = active === node.id;
              const isLit = lit?.nodes.has(node.id) ?? false;
              const dim = lit && !isLit;
              const color = layerColor(layerIdx.get(node.layer) ?? 0);
              return (
                // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>; role + key handlers are the accessible equivalent for an in-canvas node
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.label}${node.tech ? ` (${node.tech})` : ""}`}
                  aria-pressed={focused === node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  opacity={dim ? 0.2 : 1}
                  style={{ transition: "opacity .15s", cursor: "pointer", outline: "none" }}
                  onPointerEnter={() => setHovered(node.id)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(node.id)}
                  onBlur={() => setHovered(null)}
                  onClick={() => setFocused((f) => (f === node.id ? null : node.id))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setFocused((f) => (f === node.id ? null : node.id));
                    }
                  }}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={9}
                    fill="var(--color-surface)"
                    stroke={isActive || isLit ? color : "var(--color-border-strong)"}
                    strokeWidth={isActive ? 2 : 1.25}
                  />
                  <rect width={4} height={NODE_H} rx={2} fill={color} />
                  <text x={14} y={24} fontSize={12} fontWeight={600} className="fill-fg">
                    {truncate(node.label, 18)}
                  </text>
                  {node.tech ? (
                    <text x={14} y={40} fontSize={9.5} className="fill-fg-muted">
                      {truncate(node.tech, 22)}
                    </text>
                  ) : null}
                  {node.kind ? (
                    <text
                      x={NODE_W - 10}
                      y={16}
                      textAnchor="end"
                      fontSize={8}
                      className="fill-fg-muted"
                    >
                      {node.kind}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>

        {/* focused node note */}
        {focused ? (
          <FocusCard
            node={layout.nodes.find((n) => n.id === focused)}
            layerLabel={layerLabel.get(layout.nodes.find((n) => n.id === focused)?.layer ?? "")}
            onClose={() => setFocused(null)}
          />
        ) : null}

        {/* controls */}
        <div className="absolute right-2 top-2 flex flex-col gap-1 rounded-lg border border-border-default bg-surface/90 p-1 backdrop-blur">
          <IconButton
            size="sm"
            label="Zoom in"
            onClick={() => setScale((s) => clamp(s * 1.15, MIN_SCALE, MAX_SCALE))}
          >
            <Plus size={13} strokeWidth={1.75} />
          </IconButton>
          <IconButton
            size="sm"
            label="Zoom out"
            onClick={() => setScale((s) => clamp(s * 0.87, MIN_SCALE, MAX_SCALE))}
          >
            <Minus size={13} strokeWidth={1.75} />
          </IconButton>
          <IconButton size="sm" label="Reset view" onClick={reset}>
            <Scan size={13} strokeWidth={1.75} />
          </IconButton>
        </div>

        {/* legend */}
        <div className="absolute bottom-2 left-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border-default bg-surface/90 px-2.5 py-1.5 text-2xs text-fg-muted backdrop-blur">
          {topology.layers.map((layer, i) => (
            <span key={layer.id} className="inline-flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-sm"
                style={{ background: layerColor(i) }}
                aria-hidden
              />
              {layer.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function FocusCard({
  node,
  layerLabel,
  onClose,
}: {
  node?: { label: string; tech?: string; note?: string };
  layerLabel?: string;
  onClose: () => void;
}) {
  if (!node) return null;
  return (
    <div className="absolute left-2 top-2 max-w-[15rem] rounded-lg border border-border-default bg-surface p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-fg">{node.label}</p>
          {node.tech || layerLabel ? (
            <p className="mt-0.5 text-2xs text-fg-muted">
              {[node.tech, layerLabel].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-2xs text-fg-muted hover:text-fg"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      {node.note ? (
        <p className="mt-2 text-2xs leading-relaxed text-fg-secondary">{node.note}</p>
      ) : null}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
