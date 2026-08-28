import { z } from "zod";

/**
 * `architecture/topology.json` — the structured system design the Architect
 * writes alongside the prose package. The web renders it as an interactive
 * diagram (nodes grouped by layer, edges with protocols, hover-to-trace), so
 * the "system design" view is a live picture rather than an ASCII box drawing.
 *
 * It is data, not markup: every string is escaped as SVG text at render time,
 * and the renderer is trusted first-party code. There is no executable content
 * here to sanitise.
 */

export const TOPOLOGY_PATH = "architecture/topology.json";

/** A horizontal band. Nodes are placed in the column of their layer, in the
 * order the layers are listed here (left → right = request flow / dependency
 * direction). */
export const topologyLayerSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
});
export type TopologyLayer = z.infer<typeof topologyLayerSchema>;

export const topologyNodeKind = z.enum([
  "client",
  "cdn",
  "gateway",
  "service",
  "worker",
  "function",
  "datastore",
  "cache",
  "queue",
  "storage",
  "auth",
  "external",
]);
export type TopologyNodeKind = z.infer<typeof topologyNodeKind>;

export const topologyNodeSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(60),
  /** Must match a `layers[].id`. */
  layer: z.string().min(1).max(40),
  kind: topologyNodeKind.optional(),
  /** The concrete technology, e.g. "PostgreSQL", "FastAPI", "CloudFront". */
  tech: z.string().max(60).optional(),
  /** One short clause shown on hover / focus. */
  note: z.string().max(200).optional(),
});
export type TopologyNode = z.infer<typeof topologyNodeSchema>;

export const topologyEdgeSchema = z.object({
  /** `nodes[].id` on each end. */
  from: z.string().min(1).max(60),
  to: z.string().min(1).max(60),
  /** e.g. "HTTPS", "gRPC", "SQL", "SQS". */
  protocol: z.string().max(30).optional(),
  /** A verb phrase: "reads through", "drains", "authenticates". */
  label: z.string().max(60).optional(),
  /** `async` edges render dashed; `data` edges are muted. */
  kind: z.enum(["sync", "async", "data"]).optional(),
});
export type TopologyEdge = z.infer<typeof topologyEdgeSchema>;

export const topologySchema = z.object({
  title: z.string().max(80).optional(),
  summary: z.string().max(280).optional(),
  layers: z.array(topologyLayerSchema).min(1).max(12),
  nodes: z.array(topologyNodeSchema).min(1).max(60),
  edges: z.array(topologyEdgeSchema).max(160).default([]),
});
export type Topology = z.infer<typeof topologySchema>;

/** Parse + structurally validate. Returns `null` (never throws) when the
 * document is missing, malformed, or references a layer/node that does not
 * exist — the caller falls back to the prose report. */
export function parseTopology(raw: string): Topology | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = topologySchema.safeParse(json);
  if (!parsed.success) return null;
  const topo = parsed.data;

  const layerIds = new Set(topo.layers.map((l) => l.id));
  if (topo.nodes.some((n) => !layerIds.has(n.layer))) return null;

  const nodeIds = new Set(topo.nodes.map((n) => n.id));
  if (new Set(topo.nodes.map((n) => n.id)).size !== topo.nodes.length) return null;
  // Drop edges that dangle rather than rejecting the whole document.
  topo.edges = topo.edges.filter(
    (e) => nodeIds.has(e.from) && nodeIds.has(e.to) && e.from !== e.to,
  );
  return topo;
}
