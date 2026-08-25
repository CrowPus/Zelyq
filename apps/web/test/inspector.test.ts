import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeElement,
  INSPECTOR_SELECTED,
  isSelectedElementMessage,
  type SelectedElement,
  withPointedElement,
} from "../src/lib/inspector.js";

function element(overrides: Partial<SelectedElement> = {}): SelectedElement {
  return { tag: "button", classes: ["btn-primary"], text: "Submit", ...overrides };
}

test("isSelectedElementMessage: accepts a well-formed message", () => {
  const data = { type: INSPECTOR_SELECTED, element: element() };
  assert.equal(isSelectedElementMessage(data), true);
});

test("isSelectedElementMessage: rejects a message of a different type", () => {
  assert.equal(isSelectedElementMessage({ type: "something-else", element: element() }), false);
});

test("isSelectedElementMessage: rejects a missing or malformed element", () => {
  assert.equal(isSelectedElementMessage({ type: INSPECTOR_SELECTED }), false);
  assert.equal(isSelectedElementMessage({ type: INSPECTOR_SELECTED, element: null }), false);
  assert.equal(
    isSelectedElementMessage({ type: INSPECTOR_SELECTED, element: { tag: "div" } }),
    false,
    "classes must be present and an array",
  );
  assert.equal(
    isSelectedElementMessage({
      type: INSPECTOR_SELECTED,
      element: { tag: "div", classes: [1, 2] },
    }),
    false,
    "every class must be a string",
  );
  assert.equal(
    isSelectedElementMessage({ type: INSPECTOR_SELECTED, element: { tag: "", classes: [] } }),
    false,
    "an empty tag is not a real element",
  );
});

test("isSelectedElementMessage: rejects non-object input entirely", () => {
  assert.equal(isSelectedElementMessage(null), false);
  assert.equal(isSelectedElementMessage("hello"), false);
  assert.equal(isSelectedElementMessage(undefined), false);
});

test("describeElement: renders tag, class, and text like real markup", () => {
  assert.equal(describeElement(element()), '<button class="btn-primary">Submit</button>');
});

test("describeElement: includes id when present", () => {
  assert.equal(
    describeElement(element({ id: "submit-button" })),
    '<button id="submit-button" class="btn-primary">Submit</button>',
  );
});

test("describeElement: omits class attribute when there are no classes", () => {
  assert.equal(describeElement(element({ classes: [] })), "<button>Submit</button>");
});

test("describeElement: a self-closing-feeling element with no text still closes properly", () => {
  assert.equal(describeElement({ tag: "input", classes: ["field"] }), '<input class="field">');
});

test("withPointedElement: prepends a labelled line ahead of what was typed", () => {
  const result = withPointedElement("make it bigger", element());
  assert.equal(
    result,
    'Regarding <button class="btn-primary">Submit</button> in the preview:\nmake it bigger',
  );
});

test("withPointedElement: an empty message still produces a sendable line on its own", () => {
  const result = withPointedElement("", element());
  assert.equal(result, 'Regarding <button class="btn-primary">Submit</button> in the preview:');
});

test("withPointedElement: whitespace-only input is treated the same as empty", () => {
  const result = withPointedElement("   \n  ", element());
  assert.equal(result, 'Regarding <button class="btn-primary">Submit</button> in the preview:');
});
