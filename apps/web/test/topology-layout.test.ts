import assert from "node:assert/strict";
import { test } from "node:test";
import type { Topology } from "@zelyq/core";
import { layoutTopology, NODE_W } from "../src/components/topologyLayout";

const topo: Topology = {
  layers: [
    { id: "edge", label: "Edge" },
    { id: "app", label: "App" },
    { id: "data", label: "Data" },
  ],
  nodes: [
    { id: "user", label: "Users", layer: "edge" },
    { id: "cf", label: "CDN", layer: "edge" },
    { id: "api", label: "API", layer: "app" },
    { id: "pg", label: "DB", layer: "data" },
  ],
  edges: [
    { from: "user", to: "api" },
    { from: "api", to: "pg" },
    { from: "pg", to: "api" }, // backward
  ],
};

test("layoutTopology is deterministic", () => {
  const a = JSON.stringify(layoutTopology(topo).nodes);
  const b = JSON.stringify(layoutTopology(topo).nodes);
  assert.equal(a, b);
});

test("nodes are placed in left-to-right layer columns", () => {
  const { nodes } = layoutTopology(topo);
  const x = (id: string) => nodes.find((n) => n.id === id)!.x;
  assert.ok(x("user") < x("api"), "edge column left of app column");
  assert.ok(x("api") < x("pg"), "app column left of data column");
  assert.equal(x("user"), x("cf"), "same-layer nodes share a column");
  assert.ok(x("api") - x("user") >= NODE_W, "columns do not overlap");
});

test("edges carry a path and know their direction", () => {
  const { edges } = layoutTopology(topo);
  assert.equal(edges.length, 3);
  assert.ok(edges.every((e) => e.d.startsWith("M ")));
  assert.equal(edges.find((e) => e.from === "pg" && e.to === "api")?.backward, true);
  assert.equal(edges.find((e) => e.from === "user")?.backward, false);
});

test("neighbours and incident maps are built both directions", () => {
  const { neighbours, incident } = layoutTopology(topo);
  assert.deepEqual([...(neighbours.get("api") ?? [])].sort(), ["pg", "user"]);
  assert.equal(incident.get("api")?.size, 3);
  assert.equal(incident.get("cf")?.size, 0);
});

test("canvas grows with the widest layer and the tallest column", () => {
  const wide: Topology = {
    ...topo,
    nodes: [
      ...topo.nodes,
      { id: "cache", label: "Cache", layer: "data" },
      { id: "queue", label: "Queue", layer: "data" },
    ],
  };
  const base = layoutTopology(topo);
  const grown = layoutTopology(wide);
  assert.ok(grown.height > base.height, "more rows in a column → taller");
  assert.equal(grown.width, base.width, "same number of layers → same width");
});
