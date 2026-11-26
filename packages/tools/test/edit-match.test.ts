import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEdit } from "../src/edit-match.js";

describe("applyEdit", () => {
  it("writes `$` sequences byte for byte (String.replace used to eat them)", () => {
    for (const newText of ["`$${price.toFixed(2)}`", "a $& b", "$' $` $$ $1"]) {
      const result = applyEdit("const a = OLD;\n", "OLD", newText);
      assert.ok(result.ok);
      assert.equal(result.updated, `const a = ${newText};\n`);
    }
  });

  it("an exact single match is replaced and reports its lines", () => {
    const result = applyEdit("one\ntwo\nthree\n", "two", "2a\n2b");
    assert.ok(result.ok);
    assert.equal(result.updated, "one\n2a\n2b\nthree\n");
    assert.equal(result.startLine, 2);
    assert.equal(result.endLine, 3);
    assert.equal(result.note, undefined);
  });

  it("refuses an ambiguous match with the line of each, unless replace_all", () => {
    const refused = applyEdit("x = 1\ny\nx = 1\n", "x = 1", "x = 2");
    assert.equal(refused.ok, false);
    assert.ok(!refused.ok && /lines 1, 3/.test(refused.message));
    const all = applyEdit("x = 1\ny\nx = 1\n", "x = 1", "x = 2", { replaceAll: true });
    assert.ok(all.ok);
    assert.equal(all.updated, "x = 2\ny\nx = 2\n");
    assert.equal(all.replacements, 2);
  });

  it("matches lines that differ only in trailing whitespace, and says so", () => {
    const file = "function a() {   \n  return 1;\n}\n";
    const result = applyEdit(
      file,
      "function a() {\n  return 1;\n}",
      "function a() {\n  return 2;\n}",
    );
    assert.ok(result.ok);
    assert.equal(result.updated, "function a() {\n  return 2;\n}\n");
    assert.match(result.note ?? "", /trailing whitespace/);
  });

  it("matches lines indented differently and keeps the file's indentation", () => {
    const file = "export function A() {\n    if (x) {\n        go();\n    }\n}\n";
    const result = applyEdit(file, "if (x) {\n    go();\n}", "if (x) {\n    go();\n    stop();\n}");
    assert.ok(result.ok);
    assert.equal(
      result.updated,
      "export function A() {\n    if (x) {\n        go();\n        stop();\n    }\n}\n",
    );
    assert.match(result.note ?? "", /indentation/);
  });

  it("never guesses when a fuzzy match is not unique", () => {
    const file = "  a();\n  b();\n\n    a();\n    b();\n";
    const result = applyEdit(file, "a();\nb();", "c();");
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.reason === "ambiguous");
  });

  it("keeps CRLF line endings when the model wrote plain newlines", () => {
    const result = applyEdit("one\r\ntwo\r\nthree\r\n", "one\ntwo", "uno\ndos");
    assert.ok(result.ok);
    assert.equal(result.updated, "uno\r\ndos\r\nthree\r\n");
  });

  it("on no match, shows the closest lines with their numbers", () => {
    const file =
      "import x from 'x';\n\nexport function PriceTag({ price }) {\n  return <span>{price}</span>;\n}\n";
    const result = applyEdit(file, "export function PriceTag({ amount }) {", "x");
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.reason === "no_match");
    assert.ok(!result.ok && /3\texport function PriceTag/.test(result.message));
  });

  it("an empty old_text is refused", () => {
    assert.equal(applyEdit("abc", "", "x").ok, false);
  });
});
