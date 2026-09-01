import assert from "node:assert/strict";
import { test } from "node:test";
import { countNodes, pruneNode } from "../src/services/figma-tree-prune.js";

const frame = {
  id: "1:1",
  name: "Landing / Desktop",
  type: "FRAME",
  absoluteBoundingBox: { x: 100, y: 200, width: 1440, height: 3200 },
  layoutMode: "VERTICAL",
  itemSpacing: 64,
  paddingTop: 80,
  paddingRight: 120,
  paddingBottom: 80,
  paddingLeft: 120,
  primaryAxisAlignItems: "MIN",
  counterAxisAlignItems: "CENTER",
  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
  children: [
    {
      id: "1:2",
      name: "Header",
      type: "FRAME",
      absoluteBoundingBox: { x: 100, y: 200, width: 1440, height: 96 },
      layoutMode: "HORIZONTAL",
      itemSpacing: 24,
      counterAxisAlignItems: "CENTER",
      primaryAxisAlignItems: "SPACE_BETWEEN",
      children: [
        {
          id: "1:3",
          name: "Logo",
          type: "TEXT",
          absoluteBoundingBox: { x: 220, y: 230, width: 120, height: 32 },
          characters: "Acme",
          style: {
            fontFamily: "Inter",
            fontWeight: 700,
            fontSize: 24,
            lineHeightPx: 32,
            letterSpacing: -0.5,
            textAlignHorizontal: "LEFT",
          },
          fills: [{ type: "SOLID", color: { r: 0.05, g: 0.05, b: 0.05, a: 1 } }],
        },
      ],
    },
    {
      id: "1:4",
      name: "Hero heading",
      type: "TEXT",
      absoluteBoundingBox: { x: 340, y: 400, width: 960, height: 120 },
      characters: "Build faster",
      style: { fontFamily: "Inter", fontWeight: 800, fontSize: 64, lineHeightPx: 72 },
      effects: [
        {
          type: "DROP_SHADOW",
          radius: 24,
          offset: { x: 0, y: 8 },
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.15 },
          visible: true,
        },
      ],
    },
    {
      id: "1:5",
      name: "CTA",
      type: "INSTANCE",
      componentId: "9:9",
      absoluteBoundingBox: { x: 620, y: 560, width: 200, height: 56 },
      cornerRadius: 12,
      fills: [{ type: "SOLID", color: { r: 0.1, g: 0.4, b: 1, a: 1 } }],
      constraints: { horizontal: "CENTER", vertical: "TOP" },
    },
    {
      id: "1:6",
      name: "Hidden thing",
      type: "RECTANGLE",
      visible: false,
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
    },
  ],
};

test("bbox is made frame-relative and rounded", () => {
  const pruned = pruneNode(frame);
  assert.deepEqual(pruned.bbox, { x: 0, y: 0, w: 1440, h: 3200 });
  const header = pruned.children?.[0];
  assert.deepEqual(header?.bbox, { x: 0, y: 0, w: 1440, h: 96 });
  const hero = pruned.children?.[1];
  assert.deepEqual(hero?.bbox, { x: 240, y: 200, w: 960, h: 120 });
});

test("auto-layout becomes a layout object with flex semantics", () => {
  const pruned = pruneNode(frame);
  assert.deepEqual(pruned.layout, {
    mode: "col",
    gap: 64,
    padding: [80, 120, 80, 120],
    justify: "flex-start",
    align: "center",
  });
  assert.equal(pruned.children?.[0]?.layout?.justify, "space-between");
});

test("text nodes carry the resolved style, long strings clipped", () => {
  const pruned = pruneNode(frame);
  const logo = pruned.children?.[0]?.children?.[0];
  assert.equal(logo?.text?.content, "Acme");
  assert.equal(logo?.text?.fontFamily, "Inter");
  assert.equal(logo?.text?.fontWeight, 700);
  assert.equal(logo?.text?.fontSize, 24);
  assert.equal(logo?.text?.letterSpacing, -0.5);
});

test("solid fills resolve to hex, effects to a shadow string, radius kept", () => {
  const pruned = pruneNode(frame);
  assert.deepEqual(pruned.fills, ["#ffffff"]);
  const hero = pruned.children?.[1];
  assert.deepEqual(hero?.effects, ["shadow: 0px 8px 24px 0px rgba(0, 0, 0, 0.15)"]);
  const cta = pruned.children?.[2];
  assert.deepEqual(cta?.fills, ["#1a66ff"]);
  assert.equal(cta?.radius, 12);
  assert.deepEqual(cta?.component, { id: "9:9", name: "CTA" });
  assert.deepEqual(cta?.constraints, { h: "center", v: "start" });
});

test("invisible nodes are dropped", () => {
  const pruned = pruneNode(frame);
  const ids = (pruned.children ?? []).map((c) => c.id);
  assert.ok(!ids.includes("1:6"));
  assert.equal(pruned.children?.length, 3);
});

test("the node budget truncates deep trees instead of exploding", () => {
  // A frame with 50 children, budget 10 → only some kept, `truncated` set.
  const big = {
    id: "2:0",
    name: "Big",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    children: Array.from({ length: 50 }, (_, i) => ({
      id: `2:${i + 1}`,
      name: `n${i}`,
      type: "RECTANGLE",
      absoluteBoundingBox: { x: i, y: 0, width: 1, height: 1 },
    })),
  };
  const pruned = pruneNode(big, { maxNodes: 10 });
  assert.equal(pruned.truncated, true);
  assert.ok((pruned.children?.length ?? 0) < 50);
  assert.ok(countNodes(pruned) <= 10);
});

test("gradient fills resolve to a css gradient", () => {
  const node = {
    id: "3:1",
    name: "g",
    type: "RECTANGLE",
    absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
    fills: [
      {
        type: "GRADIENT_LINEAR",
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
      },
    ],
  };
  assert.deepEqual(pruneNode(node).fills, ["linear-gradient(#ff0000 0%, #0000ff 100%)"]);
});
