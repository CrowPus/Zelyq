import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, isValidElement } from "react";
import {
  currentLanguage,
  LANGUAGES,
  languageOf,
  loadLanguage,
  t,
  translateDisplayFields,
  translateServerMessage,
} from "../src/lib/i18n.js";

/**
 * Translation is the English text as its key, filled with a small ICU
 * subset. A missing translation must fall back to English, never to a key.
 */

test("English fills placeholders and keeps quoted braces", async () => {
  await loadLanguage("en");
  assert.equal(t("Delete {name}?", { name: "Shop" }), "Delete Shop?");
  assert.equal(t("Use '{'x'}' here"), "Use {x} here");
  assert.equal(t("Missing {value} stays empty", {}), "Missing  stays empty");
});

test("plurals choose by the language's rules, with # as the number", async () => {
  await loadLanguage("en");
  const apps = (n: number) => t("{n, plural, one {# app} other {# apps}}", { n });
  assert.equal(apps(1), "1 app");
  assert.equal(apps(3), "3 apps");
  assert.equal(apps(1200), "1,200 apps");
  assert.equal(t("{n, plural, =0 {none} other {#}}", { n: 0 }), "none");
});

test("select and selectordinal", async () => {
  await loadLanguage("en");
  const role = (r: string) => t("{role, select, admin {an admin} other {a {role}}}", { role: r });
  assert.equal(role("admin"), "an admin");
  assert.equal(role("viewer"), "a viewer");
  const place = (n: number) =>
    t("{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}", { n });
  assert.deepEqual([1, 2, 3, 4, 11, 22].map(place), ["1st", "2nd", "3rd", "4th", "11th", "22nd"]);
});

test("a React element among the values comes back as a fragment", async () => {
  await loadLanguage("en");
  const out = t("Read {link} first", { link: createElement("a", { href: "/x" }, "this") });
  assert.ok(isValidElement(out));
});

test("French and German load, translate, and count their own way", async () => {
  await loadLanguage("fr");
  assert.equal(currentLanguage(), "fr");
  assert.equal(t("Save"), "Enregistrer");
  assert.equal(t("{n, plural, one {# app} other {# apps}}", { n: 0 }), "0 app");
  assert.equal(t("Not a message anyone wrote"), "Not a message anyone wrote");
  await loadLanguage("de");
  assert.equal(t("Save"), "Speichern");
  assert.equal(t("{n, plural, one {# app} other {# apps}}", { n: 2 }), "2 Apps");
  await loadLanguage("en");
});

test("server messages: exact, then by their template, else as sent", async () => {
  await loadLanguage("de");
  assert.equal(translateServerMessage("That is not your password."), "Das ist nicht Ihr Passwort.");
  assert.equal(
    translateServerMessage("Dana is already a member of this team."),
    "Dana ist bereits Mitglied dieses Teams.",
  );
  assert.equal(
    translateServerMessage("Something new from the server"),
    "Something new from the server",
  );
  // A value in apostrophes is text, not ICU quoting.
  assert.equal(
    translateServerMessage("This agent may not use 'deploy'."),
    "Dieser Agent darf 'deploy' nicht verwenden.",
  );
  await loadLanguage("en");
  assert.equal(translateServerMessage("That is not your password."), "That is not your password.");
  assert.equal(t("It's {name}'s", { name: "Ada" }), "It's Ada's");
});

test("why a pipeline run failed is read in the person's language", async () => {
  await loadLanguage("de");
  assert.equal(
    translateServerMessage(
      "The local runner is off on this instance. Add a runner in Pipelines → Runners and name it in runs-on.",
    ),
    "Der lokale Runner ist auf dieser Instanz ausgeschaltet. Fügen Sie unter Pipelines → Runner einen Runner hinzu und tragen Sie seinen Namen bei runs-on ein.",
  );
  assert.equal(
    translateServerMessage("There is no runner called build-01 in this team."),
    "In diesem Team gibt es keinen Runner namens build-01.",
  );
  await loadLanguage("en");
});

test("display fields from the API are translated, names and values are not", async () => {
  await loadLanguage("fr");
  const payload = translateDisplayFields({
    groups: [{ label: "Reasoning effort", value: "Reasoning effort", name: "Storage" }],
    // A pipeline named like an interface word stays as its owner named it.
    title: "Ship",
    description: "Not known to the catalogue",
  });
  assert.equal(payload.groups[0]?.label, "Effort de raisonnement");
  assert.equal(payload.groups[0]?.value, "Reasoning effort");
  assert.equal(payload.groups[0]?.name, "Storage");
  assert.equal(payload.description, "Not known to the catalogue");
  assert.equal(payload.title, "Ship");
  await loadLanguage("en");
});

test("pseudo-locale marks every message and keeps placeholders intact", async () => {
  await loadLanguage("pseudo");
  const out = t("Save {name}", { name: "Shop" });
  assert.match(out, /^\[Šàvé Shop ~+\]$/);
  await loadLanguage("en");
});

test("a locale tag maps to an interface language, or to none", () => {
  assert.equal(languageOf("de-AT"), "de");
  assert.equal(languageOf("fr_CA"), "fr");
  assert.equal(languageOf("es-MX"), "es");
  assert.equal(languageOf("pt-PT"), "pt");
  assert.equal(languageOf("zh-TW"), "zh");
  assert.equal(languageOf("ja-JP"), null);
  assert.equal(languageOf(null), null);
});

test("Spanish, Portuguese and Chinese load, with their own plural rules and page language tags", async () => {
  await loadLanguage("es");
  assert.equal(t("Save"), "Guardar");
  assert.equal(t("{n, plural, one {# app} other {# apps}}", { n: 1 }), "1 app");
  await loadLanguage("pt");
  assert.equal(t("Save"), "Salvar");
  await loadLanguage("zh");
  assert.equal(t("Save"), "保存");
  assert.equal(t("{count, plural, one {# app} other {# apps}}", { count: 3 }), "3 个应用");
  assert.deepEqual(
    LANGUAGES.map((l) => l.tag),
    ["en", "fr", "de", "es", "pt-BR", "zh-CN"],
  );
  await loadLanguage("en");
});
