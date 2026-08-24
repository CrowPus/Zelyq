import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { renderReport } from "../evals/checks.js";

/**
 * Proof that the `renders` check is capable of failing.
 *
 * `017` made this binding: a metric that has never reported a failure must be
 * assumed broken until a deliberately failing input is shown to make it fail.
 * This check exists because `intact` scored 22/22 with a hole in it, so shipping
 * it on the strength of "it looks right" would be the same mistake a third time.
 *
 * The pages here are served over HTTP rather than mocked. What is being tested
 * is whether a real browser reports a real failure, and a stub would only prove
 * that the stub agrees with the implementation.
 */

const PAGES: Record<string, string> = {
  // Mounts normally.
  "/good": `<!doctype html><html><body><div id="root"></div>
    <script>document.querySelector("#root").innerHTML = "<h1>hello</h1>";</script>
    </body></html>`,

  // Compiles, is served, and throws on mount — the exact shape `preview` cannot
  // see and the reason this check exists.
  "/throws": `<!doctype html><html><body><div id="root"></div>
    <script>throw new Error("Cannot read properties of undefined (reading 'map')");</script>
    </body></html>`,

  // No error at all, and nothing ever appears. A white screen.
  "/empty": `<!doctype html><html><body><div id="root"></div></body></html>`,

  // Mounts late. A slow machine must not be scored as a broken app.
  "/slow": `<!doctype html><html><body><div id="root"></div>
    <script>setTimeout(() => { document.querySelector("#root").innerHTML = "<p>late</p>"; }, 2500);</script>
    </body></html>`,

  // Writes a console warning and mounts. React does this in normal operation.
  "/warns": `<!doctype html><html><body><div id="root"></div>
    <script>console.warn("Each child in a list should have a unique key prop.");
    document.querySelector("#root").innerHTML = "<p>fine</p>";</script>
    </body></html>`,
};

let server: http.Server;
let base: string;

before(async () => {
  server = http.createServer((request, response) => {
    const body = PAGES[(request.url ?? "/").split("?")[0] as string];
    if (!body) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("an app that mounts passes", async () => {
  const result = await renderReport(`${base}/good`);
  assert.equal(result.ok, true, result.detail);
});

test("an app that throws on mount fails, and the message says what threw", async () => {
  // The condition the council attached: without this, `renders` is another
  // check we believe rather than know.
  const result = await renderReport(`${base}/throws`);
  assert.equal(result.ok, false, "a page that throws on mount was scored as working");
  assert.match(result.detail, /threw on render/);
  assert.match(result.detail, /Cannot read properties of undefined/);
});

test("a white screen fails, and is reported differently from a throw", async () => {
  const result = await renderReport(`${base}/empty`);
  assert.equal(result.ok, false, "an empty page was scored as working");
  assert.match(result.detail, /#root is empty/);
  // "It threw" and "it never appeared" are different bugs. A single message for
  // both would send somebody looking for an exception that does not exist.
  assert.doesNotMatch(result.detail, /threw/);
});

test("an app that mounts late still passes", async () => {
  // A slow mount on a loaded machine must not read as a broken app. Today's
  // other two flakes were both this mistake.
  const result = await renderReport(`${base}/slow`);
  assert.equal(result.ok, true, result.detail);
});

test("a console warning is not a failure", async () => {
  // React warns in normal operation. A check that fails on warnings is one
  // somebody marks cosmetic and then stops reading.
  const result = await renderReport(`${base}/warns`);
  assert.equal(result.ok, true, result.detail);
});
