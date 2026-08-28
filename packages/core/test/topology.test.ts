import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTopology } from "../src/topology.js";

const good = {
  title: "Sample Web App",
  layers: [
    { id: "edge", label: "Edge" },
    { id: "app", label: "Application" },
    { id: "data", label: "Data" },
  ],
  nodes: [
    { id: "user", label: "Users", layer: "edge", kind: "client" },
    { id: "cf", label: "CloudFront", layer: "edge", kind: "cdn" },
    { id: "api", label: "API Server", layer: "app", kind: "service", tech: "FastAPI" },
    { id: "pg", label: "PostgreSQL", layer: "data", kind: "datastore" },
  ],
  edges: [
    { from: "user", to: "cf", protocol: "HTTPS" },
    { from: "cf", to: "api", protocol: "HTTPS" },
    { from: "api", to: "pg", protocol: "SQL", kind: "sync" },
  ],
};

test("parseTopology accepts a well-formed document", () => {
  const topo = parseTopology(JSON.stringify(good));
  assert.ok(topo);
  assert.equal(topo.nodes.length, 4);
  assert.equal(topo.edges.length, 3);
});

test("parseTopology returns null on invalid JSON", () => {
  assert.equal(parseTopology("{not json"), null);
});

test("parseTopology returns null when a node references an unknown layer", () => {
  const bad = { ...good, nodes: [{ id: "x", label: "X", layer: "nope" }] };
  assert.equal(parseTopology(JSON.stringify(bad)), null);
});

test("parseTopology returns null on duplicate node ids", () => {
  const bad = {
    ...good,
    nodes: [
      { id: "a", label: "A", layer: "edge" },
      { id: "a", label: "A2", layer: "app" },
    ],
  };
  assert.equal(parseTopology(JSON.stringify(bad)), null);
});

test("parseTopology drops dangling and self edges rather than failing", () => {
  const topo = parseTopology(
    JSON.stringify({
      ...good,
      edges: [
        { from: "user", to: "cf" },
        { from: "user", to: "ghost" },
        { from: "api", to: "api" },
      ],
    }),
  );
  assert.ok(topo);
  assert.equal(topo.edges.length, 1);
  assert.equal(topo.edges[0]?.to, "cf");
});

test("parseTopology rejects an empty object", () => {
  assert.equal(parseTopology("{}"), null);
});
