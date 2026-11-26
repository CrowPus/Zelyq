import assert from "node:assert/strict";
import { test } from "node:test";
import { readModelChoice, writeModelChoice } from "../src/lib/model-choice.js";

function memory(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const gemini = { provider: "google", model: "gemini-3.8-flash", label: "Gemini 3.8 Flash" };

test("a chat's model choice survives a reload, per project", () => {
  const store = memory();
  writeModelChoice("prj_a", gemini, store);
  assert.deepEqual(readModelChoice("prj_a", store), gemini);
  assert.equal(readModelChoice("prj_b", store), null);
});

test("going back to Default forgets the choice", () => {
  const store = memory();
  writeModelChoice("prj_a", gemini, store);
  writeModelChoice("prj_a", null, store);
  assert.equal(readModelChoice("prj_a", store), null);
});

test("damaged or refused storage means Default, never an error", () => {
  const store = memory();
  store.setItem("zelyq.modelChoice.prj_a", "{not json");
  assert.equal(readModelChoice("prj_a", store), null);
  store.setItem("zelyq.modelChoice.prj_a", JSON.stringify({ model: "x" }));
  assert.equal(readModelChoice("prj_a", store), null);
  const refusing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  } as unknown as Storage;
  assert.equal(readModelChoice("prj_a", refusing), null);
  assert.doesNotThrow(() => writeModelChoice("prj_a", gemini, refusing));
});
