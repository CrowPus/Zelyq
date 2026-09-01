/**
 * Figma node tree → a compact tree the build agent can actually read (proposal
 * 068).
 *
 * A raw `GET /v1/files/:key/nodes` response is megabytes of transform matrices,
 * vector path data, and defaults. This keeps only what maps to web — geometry,
 * auto-layout, resolved fills/effects, text + text style, component identity —
 * and caps the node count so one frame's tree stays well under a prompt's
 * budget. Pure and deterministic; `figma-tree-prune.test.ts` covers it.
 */

export interface PrunedNode {
  id: string;
  name: string;
  type: string;
  /** Relative to the frame's own top-left, rounded. */
  bbox?: { x: number; y: number; w: number; h: number };
  layout?: {
    mode: "row" | "col";
    gap?: number;
    /** top, right, bottom, left */
    padding?: [number, number, number, number];
    justify?: string;
    align?: string;
    wrap?: boolean;
  };
  /** Responsive hints from Figma constraints, e.g. { h: "stretch", v: "top" }. */
  constraints?: { h: string; v: string };
  /** Resolved: "#rrggbb", "rgba(…)", "linear-gradient(…)", "image". */
  fills?: string[];
  stroke?: { color: string; weight: number };
  /** "shadow: …", "inner-shadow: …", "blur: Npx", "backdrop-blur: Npx". */
  effects?: string[];
  radius?: number | [number, number, number, number];
  /** Only when < 1. */
  opacity?: number;
  text?: {
    content: string;
    fontFamily: string;
    fontWeight: number;
    fontSize: number;
    lineHeightPx?: number;
    letterSpacing?: number;
    align?: string;
    case?: string;
    decoration?: string;
  };
  /** For INSTANCE / COMPONENT — the identity, so repeats become one component. */
  component?: { id: string; name?: string };
  children?: PrunedNode[];
  /** The subtree here was cut for the node budget — request this id explicitly. */
  truncated?: boolean;
}

export interface PruneOptions {
  /** Hard ceiling on nodes kept across the whole tree. Default 4000. */
  maxNodes?: number;
  /** Max nesting depth. Default 24. */
  maxDepth?: number;
}

// biome-ignore lint/suspicious/noExplicitAny: the Figma node is an untyped blob
type FigmaNode = Record<string, any>;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function rgbaToCss(c: { r: number; g: number; b: number; a?: number }): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  const a = c.a ?? 1;
  if (a >= 1) {
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${round(a)})`;
}

function resolveFill(fill: FigmaNode): string | null {
  if (fill.visible === false) return null;
  const opacity = fill.opacity ?? 1;
  switch (fill.type) {
    case "SOLID": {
      if (!fill.color) return null;
      const color = { ...fill.color, a: (fill.color.a ?? 1) * opacity };
      return rgbaToCss(color);
    }
    case "GRADIENT_LINEAR":
    case "GRADIENT_RADIAL":
    case "GRADIENT_ANGULAR": {
      const stops = (fill.gradientStops ?? [])
        .map((s: FigmaNode) => `${rgbaToCss(s.color)} ${Math.round((s.position ?? 0) * 100)}%`)
        .join(", ");
      const kind = fill.type === "GRADIENT_RADIAL" ? "radial-gradient" : "linear-gradient";
      return stops ? `${kind}(${stops})` : null;
    }
    case "IMAGE":
      return "image";
    default:
      return null;
  }
}

function resolveEffect(effect: FigmaNode): string | null {
  if (effect.visible === false) return null;
  const radius = Math.round(effect.radius ?? 0);
  switch (effect.type) {
    case "DROP_SHADOW":
    case "INNER_SHADOW": {
      const x = Math.round(effect.offset?.x ?? 0);
      const y = Math.round(effect.offset?.y ?? 0);
      const spread = Math.round(effect.spread ?? 0);
      const color = effect.color ? rgbaToCss(effect.color) : "rgba(0,0,0,0.25)";
      const label = effect.type === "INNER_SHADOW" ? "inner-shadow" : "shadow";
      return `${label}: ${x}px ${y}px ${radius}px ${spread}px ${color}`;
    }
    case "LAYER_BLUR":
      return `blur: ${radius}px`;
    case "BACKGROUND_BLUR":
      return `backdrop-blur: ${radius}px`;
    default:
      return null;
  }
}

const ALIGN: Record<string, string> = {
  MIN: "flex-start",
  MAX: "flex-end",
  CENTER: "center",
  SPACE_BETWEEN: "space-between",
  BASELINE: "baseline",
};

const CONSTRAINT: Record<string, string> = {
  MIN: "start",
  MAX: "end",
  CENTER: "center",
  STRETCH: "stretch",
  SCALE: "scale",
};

function textStyle(
  style: FigmaNode | undefined,
  characters: string,
): PrunedNode["text"] | undefined {
  if (!style) return undefined;
  const lh = typeof style.lineHeightPx === "number" ? round(style.lineHeightPx) : undefined;
  return {
    content: characters.length > 400 ? `${characters.slice(0, 400)}…` : characters,
    fontFamily: style.fontFamily ?? "",
    fontWeight: style.fontWeight ?? 400,
    fontSize: round(style.fontSize ?? 16),
    ...(lh !== undefined ? { lineHeightPx: lh } : {}),
    ...(typeof style.letterSpacing === "number" && style.letterSpacing !== 0
      ? { letterSpacing: round(style.letterSpacing) }
      : {}),
    ...(style.textAlignHorizontal
      ? { align: String(style.textAlignHorizontal).toLowerCase() }
      : {}),
    ...(style.textCase && style.textCase !== "ORIGINAL"
      ? { case: String(style.textCase).toLowerCase() }
      : {}),
    ...(style.textDecoration && style.textDecoration !== "NONE"
      ? { decoration: String(style.textDecoration).toLowerCase() }
      : {}),
  };
}

/**
 * Prune one node (usually a FRAME) into a `PrunedNode`. `origin` is subtracted
 * from every `absoluteBoundingBox` so coordinates are frame-relative.
 */
export function pruneNode(root: FigmaNode, options: PruneOptions = {}): PrunedNode {
  const maxNodes = options.maxNodes ?? 4000;
  const maxDepth = options.maxDepth ?? 24;
  const origin = {
    x: root.absoluteBoundingBox?.x ?? 0,
    y: root.absoluteBoundingBox?.y ?? 0,
  };
  let budget = maxNodes;

  const walk = (node: FigmaNode, depth: number): PrunedNode => {
    budget -= 1;
    const out: PrunedNode = { id: node.id, name: node.name ?? "", type: node.type ?? "" };

    if (node.absoluteBoundingBox) {
      out.bbox = {
        x: round(node.absoluteBoundingBox.x - origin.x),
        y: round(node.absoluteBoundingBox.y - origin.y),
        w: round(node.absoluteBoundingBox.width),
        h: round(node.absoluteBoundingBox.height),
      };
    }

    if (node.layoutMode && node.layoutMode !== "NONE") {
      out.layout = {
        mode: node.layoutMode === "HORIZONTAL" ? "row" : "col",
        ...(node.itemSpacing ? { gap: round(node.itemSpacing) } : {}),
        ...(node.paddingTop || node.paddingRight || node.paddingBottom || node.paddingLeft
          ? {
              padding: [
                round(node.paddingTop ?? 0),
                round(node.paddingRight ?? 0),
                round(node.paddingBottom ?? 0),
                round(node.paddingLeft ?? 0),
              ] as [number, number, number, number],
            }
          : {}),
        ...(node.primaryAxisAlignItems && ALIGN[node.primaryAxisAlignItems]
          ? { justify: ALIGN[node.primaryAxisAlignItems] }
          : {}),
        ...(node.counterAxisAlignItems && ALIGN[node.counterAxisAlignItems]
          ? { align: ALIGN[node.counterAxisAlignItems] }
          : {}),
        ...(node.layoutWrap === "WRAP" ? { wrap: true } : {}),
      };
    }

    if (node.constraints) {
      out.constraints = {
        h: CONSTRAINT[node.constraints.horizontal] ?? "start",
        v: CONSTRAINT[node.constraints.vertical] ?? "start",
      };
    }

    if (Array.isArray(node.fills)) {
      const fills = node.fills
        .map(resolveFill)
        .filter((f: string | null): f is string => f !== null);
      if (fills.length) out.fills = fills;
    }

    if (Array.isArray(node.strokes) && node.strokes.length && node.strokeWeight) {
      const first = node.strokes.find((s: FigmaNode) => s.type === "SOLID" && s.color);
      if (first) out.stroke = { color: rgbaToCss(first.color), weight: round(node.strokeWeight) };
    }

    if (Array.isArray(node.effects)) {
      const effects = node.effects
        .map(resolveEffect)
        .filter((e: string | null): e is string => e !== null);
      if (effects.length) out.effects = effects;
    }

    if (Array.isArray(node.rectangleCornerRadii)) {
      out.radius = node.rectangleCornerRadii.map((r: number) => round(r)) as [
        number,
        number,
        number,
        number,
      ];
    } else if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
      out.radius = round(node.cornerRadius);
    }

    if (typeof node.opacity === "number" && node.opacity < 1) out.opacity = round(node.opacity);

    if (node.type === "TEXT" && typeof node.characters === "string") {
      out.text = textStyle(node.style, node.characters);
    }

    if ((node.type === "INSTANCE" || node.type === "COMPONENT") && node.componentId) {
      out.component = { id: node.componentId, ...(node.name ? { name: node.name } : {}) };
    }

    const kids: FigmaNode[] = Array.isArray(node.children) ? node.children : [];
    const visibleKids = kids.filter((k) => k.visible !== false);
    if (visibleKids.length > 0) {
      if (depth >= maxDepth || budget <= 0) {
        out.truncated = true;
      } else {
        out.children = [];
        for (const kid of visibleKids) {
          if (budget <= 0) {
            out.truncated = true;
            break;
          }
          out.children.push(walk(kid, depth + 1));
        }
      }
    }

    return out;
  };

  return walk(root, 0);
}

/** Count nodes in a pruned tree — for the manifest and the tests. */
export function countNodes(node: PrunedNode): number {
  return 1 + (node.children?.reduce((sum, child) => sum + countNodes(child), 0) ?? 0);
}
