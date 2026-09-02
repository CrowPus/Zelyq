import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadTemplate } from "../src/services/templates.js";

/**
 * Every scaffolded project ships with an icon.
 *
 * Without one a browser requests `/favicon.ico`, gets a 404, and shows its
 * default globe — which is what every generated project looked like, because
 * the agent does not think to create one and nothing in the template supplied
 * it.
 *
 * The byte-identity check is the point of this file. `loadTemplate` decides
 * text-vs-binary by looking for a NUL in the first 8 KB and base64-encodes the
 * binaries; an icon that slipped through as "text" would be UTF-8 mangled into
 * a corrupt file that still *looks* present in the scaffold.
 */

const TEMPLATES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "templates",
);
const VARS = { projectName: "Demo App", projectSlug: "demo-app", projectId: "prj_demo" };

for (const template of ["vite-react", "expo-react-native"]) {
  test(`${template} scaffolds a favicon, byte for byte`, async () => {
    const files = await loadTemplate(TEMPLATES, template, VARS);
    const favicon = files.find((f) => f.path === "public/favicon.ico");
    assert.ok(favicon, `${template} must ship public/favicon.ico`);

    assert.equal(favicon.encoding, "base64", "an icon must not be scaffolded as text");
    const scaffolded = Buffer.from(favicon.content, "base64");
    const onDisk = fs.readFileSync(path.join(TEMPLATES, template, "public", "favicon.ico"));
    assert.equal(
      crypto.createHash("sha256").update(scaffolded).digest("hex"),
      crypto.createHash("sha256").update(onDisk).digest("hex"),
      "the scaffolded icon must be identical to the template's — not UTF-8 mangled",
    );
    // A real ICO starts with the 00 00 01 00 header. A corrupted one usually
    // does not, so this catches mangling even if the hashes were both wrong.
    assert.deepEqual([...scaffolded.subarray(0, 4)], [0, 0, 1, 0], "not a valid .ico");
  });
}

test("vite-react links the icon, and still templates the title", async () => {
  const files = await loadTemplate(TEMPLATES, "vite-react", VARS);
  const html = files.find((f) => f.path === "index.html");
  assert.ok(html);
  assert.match(html.content, /<link rel="icon" href="\/favicon\.ico"/);
  assert.match(html.content, /<title>Demo App<\/title>/, "templating must still run on the file");
});

test("expo declares the icon for its web build, and still templates the name", async () => {
  const files = await loadTemplate(TEMPLATES, "expo-react-native", VARS);
  const appJson = files.find((f) => f.path === "app.json");
  assert.ok(appJson);
  const parsed = JSON.parse(appJson.content) as {
    expo: { name: string; web: { favicon?: string } };
  };
  assert.equal(parsed.expo.web.favicon, "./public/favicon.ico");
  assert.equal(parsed.expo.name, "Demo App", "templating must still run on the file");
});
