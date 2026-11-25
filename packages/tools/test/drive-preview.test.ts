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

let server: http.Server;
let url = "";

before(async () => {
  server = http.createServer((request, response) => {
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

  it("goto refuses a site outside the app", async () => {
    const result = await executeTool(context(), "drive_preview", {
      steps: [{ action: "goto", path: "https://example.com/" }],
    });
    assert.equal(result.isError, true);
    assert.match(result.output, /not a path in this app/);
  });
});
