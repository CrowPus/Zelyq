import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { executeTool } from "../src/index.js";
import type { ToolContext } from "../src/types.js";

/**
 * drive_preview against a real Chromium and a small app with state: a todo
 * list that keeps its items across a reload, and a "Clear" button with a bug
 * that throws.
 */

const TODO = `<!doctype html><html lang="en"><body><main>
<h1>Todos</h1>
<form id="f"><label>New todo <input id="t" placeholder="What needs doing?"></label>
<button type="submit">Add</button></form>
<ul id="list"></ul>
<p role="status" id="count">0 items</p>
<button id="clear">Clear</button>
<a href="#/about">About</a>
<script>
  const items = JSON.parse(localStorage.getItem("todos") || "[]");
  const render = () => {
    document.getElementById("list").innerHTML = items.map((i) => "<li>" + i + "</li>").join("");
    document.getElementById("count").textContent = items.length + " items";
    localStorage.setItem("todos", JSON.stringify(items));
  };
  document.getElementById("f").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = document.getElementById("t");
    if (t.value.trim()) items.push(t.value.trim());
    t.value = "";
    render();
  });
  document.getElementById("clear").addEventListener("click", () => { undefined.length; });
  render();
</script></main></body></html>`;

// A converter whose field label also appears inside a longer label, and a
// styled switch whose real checkbox sits under a drawn cover.
const WIDGETS = `<!doctype html><html lang="en"><body><main>
<label>Kilometres <input id="km" type="number"></label>
<label>Kilometres to miles table <input type="checkbox"></label>
<p id="out">0.00 miles</p>
<label id="sw" style="position:relative;display:inline-block;padding:8px">Yearly billing
<input id="y" type="checkbox" style="position:absolute;inset:0;opacity:0">
<span style="position:absolute;inset:0;background:#ccc"></span></label>
<p id="price">$9</p>
<script>
  document.getElementById("km").addEventListener("input", (e) => {
    document.getElementById("out").textContent = (Number(e.target.value) * 0.621371).toFixed(2) + " miles";
  });
  document.getElementById("y").addEventListener("change", (e) => {
    document.getElementById("price").textContent = e.target.checked ? "$90" : "$9";
  });
</script></main></body></html>`;

let server: http.Server;
let url = "";

before(async () => {
  server = http.createServer((request, response) => {
    if (request.url === "/w") {
      response.writeHead(200, { "content-type": "text/html" }).end(WIDGETS);
      return;
    }
    if (request.url === "/" || request.url?.startsWith("/?")) {
      response.writeHead(200, { "content-type": "text/html" }).end(TODO);
      return;
    }
    response.writeHead(404).end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function context(): ToolContext {
  return {
    projectId: "prj_drive",
    signal: new AbortController().signal,
    onFileChanged: () => undefined,
    log: () => undefined,
    runtime: {
      previewStatus: async () => ({ status: "running", url }),
    } as unknown as ToolContext["runtime"],
  };
}

describe("drive_preview", () => {
  it("adds items, sees them, and they survive a reload", async () => {
    const result = await executeTool(context(), "drive_preview", {
      steps: [
        { action: "fill", target: { label: "New todo" }, value: "Buy milk" },
        { action: "click", target: { role: "button", name: "Add" } },
        { action: "fill", target: { placeholder: "What needs doing?" }, value: "Walk dog" },
        { action: "press", key: "Enter", target: { label: "New todo" } },
        { action: "expect_text", text: "Buy milk" },
        { action: "expect_text", text: "2 items" },
        { action: "reload" },
        { action: "expect_visible", target: { role: "listitem", name: "Walk dog" } },
        { action: "click", target: { role: "link", name: "About" } },
        { action: "expect_url", path: "#/about" },
      ],
    });
    assert.equal(result.isError, undefined, result.output);
    assert.match(result.output, /Every step passed/);
  });

  it("a step that is not true fails, with the page's controls and a screenshot", async () => {
    const result = await executeTool(context(), "drive_preview", {
      steps: [
        { action: "expect_text", text: "Nothing here yet" },
        { action: "click", target: { role: "button", name: "Add" } },
      ],
    });
    assert.equal(result.isError, true);
    assert.match(result.output, /1\. expect text "Nothing here yet" — FAILED: .* not on the page/);
    assert.match(result.output, /1 later step\(s\) not run/);
    assert.match(result.output, /button "Add"/);
    assert.equal(result.images?.[0]?.mimeType, "image/jpeg");
  });

  it("an error the app throws fails the step even though the click went through", async () => {
    const result = await executeTool(context(), "drive_preview", {
      steps: [{ action: "click", target: { role: "button", name: "Clear" } }],
    });
    assert.equal(result.isError, true);
    assert.match(result.output, /click button "Clear" — ok\n\s+threw: .*length/);
  });

  it("an ambiguous target is refused rather than guessed", async () => {
    const result = await executeTool(context(), "drive_preview", {
      steps: [{ action: "click", target: { role: "button" } }],
    });
    assert.equal(result.isError, true);
    assert.match(result.output, /2 elements match button; add nth, exact, or a role/);
  });

  it("a label that loosely matches two fields means the one named exactly that", async () => {
    const result = await executeTool(context(), "drive_preview", {
      steps: [
        { action: "goto", path: "/w" },
        { action: "fill", target: { label: "Kilometres" }, value: "10" },
        { action: "expect_text", text: "6.21 miles" },
      ],
    });
    assert.ok(!result.isError, result.output);
  });

  it("a switch drawn over its checkbox is clicked through its label, as a person would", async () => {
    const result = await executeTool(context(), "drive_preview", {
      steps: [
        { action: "goto", path: "/w" },
        { action: "click", target: { label: "Yearly billing" } },
        { action: "expect_text", text: "$90" },
      ],
    });
    assert.ok(!result.isError, result.output);
  });

  it("goto refuses a site outside the app", async () => {
    const result = await executeTool(context(), "drive_preview", {
      steps: [{ action: "goto", path: "https://example.com/" }],
    });
    assert.equal(result.isError, true);
    assert.match(result.output, /not a path in this app/);
  });
});
