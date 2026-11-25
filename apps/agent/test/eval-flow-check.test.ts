import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { FlowStep } from "@zelyq/tools";
import { flowReport } from "../evals/checks.js";

/**
 * The hidden-flow grader must be able to fail: a todo app whose Add button
 * does nothing, and one that forgets everything on reload, are both caught,
 * and the working one passes.
 */

const app = (onAdd: string, load: string) => `<!doctype html><html><body><div id="root">
<label>New todo <input id="t"></label><button id="add">Add</button><ul id="l"></ul></div>
<script>
  let items = ${load};
  const render = () => { document.getElementById("l").innerHTML = items.map((i) => "<li>" + i + "</li>").join(""); };
  document.getElementById("add").onclick = () => { ${onAdd} };
  render();
</script></body></html>`;

const SAVE = `items.push(document.getElementById("t").value); localStorage.setItem("i", JSON.stringify(items)); render();`;
const PAGES: Record<string, string> = {
  "/works": app(SAVE, `JSON.parse(localStorage.getItem("i") || "[]")`),
  "/dead": app("", "[]"),
  "/forgets": app(`items.push(document.getElementById("t").value); render();`, "[]"),
};

let server: http.Server;
let base = "";
before(async () => {
  server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" }).end(PAGES[request.url ?? ""] ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const steps: FlowStep[] = [
  { action: "fill", target: { label: "New todo" }, value: "Buy milk" },
  { action: "click", target: { role: "button", name: "Add" } },
  { action: "expect_text", text: "Buy milk" },
  { action: "reload" },
  { action: "expect_text", text: "Buy milk" },
];

test("a todo app that works passes the hidden flow", async () => {
  const report = await flowReport(`${base}/works`, steps, "/works");
  assert.equal(report.ok, true, report.detail);
});

test("an Add button that does nothing fails it", async () => {
  const report = await flowReport(`${base}/dead`, steps, "/dead");
  assert.equal(report.ok, false);
  assert.match(report.detail, /3\. expect text "Buy milk" — FAILED/);
});

test("an app that forgets on reload fails it at the reload", async () => {
  const report = await flowReport(`${base}/forgets`, steps, "/forgets");
  assert.equal(report.ok, false);
  assert.match(report.detail, /5\. expect text "Buy milk" — FAILED/);
});
