import assert from "node:assert/strict";
import { test } from "node:test";
import { loadLanguage } from "../src/lib/i18n";
import { opsText } from "../src/lib/opsWords";

test("Ops's own words come out in the reader's language; names and unknown text stay as they are", async () => {
  await loadLanguage("en");
  assert.equal(opsText("shop on staging answers"), "shop on staging answers");
  await loadLanguage("de");
  assert.equal(opsText("shop on staging answers"), "shop auf staging antwortet");
  assert.equal(
    opsText("shop on staging answers at its usual speed"),
    "shop auf staging antwortet so schnell wie sonst",
  );
  assert.equal(opsText("answered 200 in 5 ms"), "hat mit 200 in 5 ms geantwortet");
  assert.equal(
    opsText("Pipeline Release ships without failing"),
    "Pipeline Release liefert ohne Fehler aus",
  );
  assert.equal(
    opsText(
      "disk 96% full; memory almost gone (3% free) (disk 96%, memory 3% free, load 0.9 on 8 processors)",
    ),
    "Datenträger zu 96 % voll; Speicher fast aufgebraucht (3 % frei) (Datenträger 96 %, Speicher 3 % frei, Last 0.9 auf 8 Prozessoren)",
  );
  assert.equal(opsText("a machine said something new"), "a machine said something new");
  await loadLanguage("ja");
  assert.equal(opsText("shop on staging is running"), "staging 上の shop が動いている");
  await loadLanguage("en");
});
