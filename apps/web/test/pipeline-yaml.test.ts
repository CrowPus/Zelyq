import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closest,
  contextKey,
  cursorContext,
  expressionOptions,
  fileNames,
  formatYaml,
  keyAt,
  keyDoc,
  keysAt,
  locateWarning,
  siblings,
  suggestKey,
} from "../src/lib/pipeline-yaml.js";

/** The text with `|` marking the cursor, and where it is. */
function at(source: string): [string, number] {
  const pos = source.indexOf("|");
  return [source.slice(0, pos) + source.slice(pos + 1), pos];
}

const FILE = `name: Ship
runs-on: local
stages:
  - name: Build
    steps:
      - run: npm ci
        shell: bash
      - docker:
          image: shop
`;

test("context: a key at the top of the file", () => {
  const context = cursorContext(...at("name: A\nru|"));
  assert.deepEqual(context.path, []);
  assert.equal(context.mode, "key");
  assert.equal(context.prefix, "ru");
});

test("context: a step's key, under a list item", () => {
  const [text, pos] = at(`${FILE.replace("        shell: bash\n", "        sh|\n")}`);
  const context = cursorContext(text, pos);
  assert.deepEqual(context.path, ["stages", "-", "steps", "-"]);
  assert.equal(context.mode, "key");
  assert.equal(context.prefix, "sh");
});

test("context: a key inside a built-in step", () => {
  const context = cursorContext(...at(`${FILE}          pu|`));
  assert.deepEqual(context.path, ["stages", "-", "steps", "-", "docker"]);
  assert.equal(contextKey(context.path), "stages.-.steps.-.docker");
});

test("context: a value, with what is typed of it", () => {
  const context = cursorContext(...at(`${FILE}          push: tr|`));
  assert.equal(context.mode, "value");
  assert.equal(context.key, "push");
  assert.equal(context.prefix, "tr");
});

test("context: back out to the stage, and to a new list item", () => {
  assert.deepEqual(cursorContext(...at(`${FILE}    pa|`)).path, ["stages", "-"]);
  const item = cursorContext(...at(`${FILE}      - |`));
  assert.deepEqual(item.path, ["stages", "-", "steps", "-"]);
  assert.equal(item.listItem, true);
});

test("context: a list written at its key's own indent", () => {
  const context = cursorContext(...at("name: A\nstages:\n- name: B\n  st|"));
  assert.deepEqual(context.path, ["stages", "-"]);
});

test("context: lines of a block scalar are a value, not keys", () => {
  const context = cursorContext(
    ...at("stages:\n  - steps:\n      - run: |\n          npm ci\n          np|"),
  );
  assert.equal(context.mode, "value");
  assert.equal(context.key, "run");
});

test("catalogue: chosen names are wildcards, unknown places have no keys", () => {
  assert.equal(contextKey(["inputs", "environment"]), "inputs.*");
  assert.equal(contextKey(["stages", 2, "steps", 0]), "stages.-.steps.-");
  assert.ok(keysAt(["inputs", "version"])?.some((entry) => entry.key === "choices"));
  assert.equal(keysAt(["env"]), null);
  assert.equal(keyDoc([], "runs-on")?.values, "runner");
});

test("hover: the key under the pointer, with where it sits", () => {
  const pos = FILE.indexOf("shell") + 2;
  const found = keyAt(FILE, pos);
  assert.equal(found?.key, "shell");
  assert.deepEqual(found?.path, ["stages", "-", "steps", "-"]);
  assert.equal(keyAt(FILE, FILE.indexOf("npm ci")), null);
});

test("quick fix: a misspelt key is matched to the one meant", () => {
  assert.equal(suggestKey("timout"), "timeout");
  assert.equal(suggestKey("stages.0.steps.1.shel"), "shell");
  assert.equal(suggestKey("stages.0.steps.1.banana"), null);
  assert.equal(closest("runs_on", ["runs-on", "name"]), "runs-on");
});

test("expressions: names come from the file itself", () => {
  const names = fileNames(`inputs:
  version: {}
services:
  postgres: {image: postgres:16, port: 5432}
stages:
  - name: Node
    matrix: {node: [20, 22]}
    steps:
      - id: meta
        run: echo
      - id: hi
        plugin: acme/hello@1.0.0
`);
  assert.deepEqual(names.inputs, ["version"]);
  assert.deepEqual(names.matrix, ["node"]);
  assert.deepEqual(expressionOptions("steps.", names), ["meta", "hi"]);
  assert.deepEqual(expressionOptions("services.postgres.", names), ["host", "port"]);
  assert.deepEqual(
    expressionOptions("steps.hi.outputs.", names, (plugin) =>
      plugin === "acme/hello@1.0.0" ? ["greeting"] : [],
    ),
    ["greeting"],
  );
  assert.deepEqual(fileNames("stages: [\n").inputs, []);
});

test("warnings: placed on the name they are about", () => {
  const text = "env:\n  KEY: vault://API_KEY\nruns-on: build-01\n";
  const vault = locateWarning(text, "API_KEY is not in the team's Vault yet.");
  assert.equal(vault && text.slice(vault.from, vault.to), "vault://API_KEY");
  const runner = locateWarning(text, "There is no runner called build-01 yet. Add it in Runners.");
  assert.equal(runner && text.slice(runner.from, runner.to), "build-01");
  assert.equal(locateWarning(text, "Something general."), null);
});

test("siblings: the keys already in the map, not its neighbours'", () => {
  const [text, pos] = at(
    `${FILE.replace("        shell: bash\n", "        |\n        shell: bash\n")}`,
  );
  const context = cursorContext(text, pos);
  const keys = siblings(text, pos, context.column);
  assert.deepEqual([...keys.keys()].sort(), ["run", "shell"]);
  assert.equal(keys.get("run"), "npm ci");
});

test("format: two spaces, comments kept, invalid text left alone", () => {
  const out = formatYaml("name: A   # the name\nstages:\n- name: B\n  steps:\n  -   run: x\n");
  assert.equal(out, "name: A # the name\nstages:\n  - name: B\n    steps:\n      - run: x\n");
  assert.equal(formatYaml("a: [\n"), null);
});
