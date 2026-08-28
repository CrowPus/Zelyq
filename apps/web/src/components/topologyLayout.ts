import type { Topology, TopologyEdge } from "@zelyq/core";

/**
 * Deterministic left-to-right layered layout for a {@link Topology}. Pure and
 * side-effect free so it can be unit-tested and memoised: same input → same
 * geometry, every time.
 *
 * Each layer is a column, in the order `topology.layers` lists them. Nodes sit
 * in their layer's column in the order they appear in `topology.nodes`, and
 * every column is centred vertically against the tallest one. Edges are cubic
 * béziers from the right edge of the source to the left edge of the target
 * (or a routed loop-back when the target sits in an earlier column).
 */

export const NODE_W = 148;
export const NODE_H = 62;
export const COL_GAP = 96;
export const ROW_GAP = 30;
export const PAD = 40;

export interface PlacedNode {
  id: string;
  label: string;
  tech?: string;
  note?: string;
  kind?: string;
  layer: string;
  layerIndex: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
}

export interface PlacedEdge {
  id: string;
  from: string;
  to: string;
  protocol?: string;
  label?: string;
  kind?: TopologyEdge["kind"];
  /** SVG path `d` for the connector. */
  d: string;
  /** Midpoint, for the protocol label. */
  mx: number;
  my: number;
  backward: boolean;
}

export interface TopologyLayoutResult {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
  /** node id → the set of node ids one hop away (either direction). */
  neighbours: Map<string, Set<string>>;
  /** node id → the set of edge ids incident on it. */
  incident: Map<string, Set<string>>;
}

export function layoutTopology(topology: Topology): TopologyLayoutResult {
  const layerIndex = new Map(topology.layers.map((l, i) => [l.id, i]));
  const columns: string[][] = topology.layers.map(() => []);
  for (const node of topology.nodes) {
    const idx = layerIndex.get(node.layer) ?? 0;
    columns[idx]!.push(node.id);
  }

  const tallest = Math.max(1, ...columns.map((c) => c.length));
  const contentH = tallest * NODE_H + (tallest - 1) * ROW_GAP;

  const placed = new Map<string, PlacedNode>();
  topology.nodes.forEach((node) => {
    const li = layerIndex.get(node.layer) ?? 0;
    const col = columns[li]!;
    const row = col.indexOf(node.id);
    const colH = col.length * NODE_H + (col.length - 1) * ROW_GAP;
    const x = PAD + li * (NODE_W + COL_GAP);
    const y = PAD + (contentH - colH) / 2 + row * (NODE_H + ROW_GAP);
    placed.set(node.id, {
      id: node.id,
      label: node.label,
      tech: node.tech,
      note: node.note,
      kind: node.kind,
      layer: node.layer,
      layerIndex: li,
      x,
      y,
      cx: x + NODE_W / 2,
      cy: y + NODE_H / 2,
    });
  });

  const width = PAD * 2 + topology.layers.length * NODE_W + (topology.layers.length - 1) * COL_GAP;
  const height = PAD * 2 + contentH;

  const neighbours = new Map<string, Set<string>>();
  const incident = new Map<string, Set<string>>();
  for (const n of topology.nodes) {
    neighbours.set(n.id, new Set());
    incident.set(n.id, new Set());
  }

  const edges: PlacedEdge[] = topology.edges.map((edge, i) => {
    const a = placed.get(edge.from)!;
    const b = placed.get(edge.to)!;
    const id = `e${i}`;
    neighbours.get(edge.from)?.add(edge.to);
    neighbours.get(edge.to)?.add(edge.from);
    incident.get(edge.from)?.add(id);
    incident.get(edge.to)?.add(id);

    const backward = b.layerIndex <= a.layerIndex;
    let d: string;
    let mx: number;
    let my: number;
    if (!backward) {
      const x1 = a.x + NODE_W;
      const y1 = a.cy;
      const x2 = b.x;
      const y2 = b.cy;
      const dx = Math.max(40, (x2 - x1) / 2);
      d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      mx = (x1 + x2) / 2;
      my = (y1 + y2) / 2;
    } else {
      // Route a backward / same-column edge under the nodes as a rounded loop.
      const x1 = a.cx;
      const y1 = a.y + NODE_H;
      const x2 = b.cx;
      const y2 = b.y + NODE_H;
      const drop = 46 + Math.abs(a.layerIndex - b.layerIndex) * 10;
      const ymax = Math.max(y1, y2) + drop;
      d = `M ${x1} ${y1} C ${x1} ${ymax}, ${x2} ${ymax}, ${x2} ${y2}`;
      mx = (x1 + x2) / 2;
      my = ymax;
    }
    return {
      id,
      from: edge.from,
      to: edge.to,
      protocol: edge.protocol,
      label: edge.label,
      kind: edge.kind,
      d,
      mx,
      my,
      backward,
    };
  });

  return {
    nodes: [...placed.values()],
    edges,
    width,
    height: Math.max(height, PAD * 2 + contentH + 60),
    neighbours,
    incident,
  };
}

/** A small, fixed palette of theme CSS-var references, cycled per layer. */
export const LAYER_COLORS = [
  "var(--color-primary)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-danger)",
  "#8b5cf6",
  "#0ea5e9",
  "#f59e0b",
] as const;

export function layerColor(index: number): string {
  return LAYER_COLORS[index % LAYER_COLORS.length]!;
}
