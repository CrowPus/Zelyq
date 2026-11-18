import { createElement, Fragment, isValidElement, type ReactNode } from "react";
import serverMessages from "../locales/server.json";

/**
 * Translation. The English text is its own key, so a missing translation
 * shows the English rather than a key nobody can read, and translators see
 * whole sentences.
 *
 *   t("Delete {name}?", { name: app.name })
 *   t("{count, plural, one {# app} other {# apps}}", { count })
 *
 * The language is chosen before the app starts (main.tsx), so text in
 * module-level constants is translated too; changing it reloads the page.
 */

export type Language = "en" | "fr" | "de" | "pseudo";

/** Interface languages, each in its own name. */
export const LANGUAGES: Array<{
  id: Exclude<Language, "pseudo">;
  name: string;
  dir: "ltr" | "rtl";
}> = [
  { id: "en", name: "English", dir: "ltr" },
  { id: "fr", name: "Français", dir: "ltr" },
  { id: "de", name: "Deutsch", dir: "ltr" },
];

const STORAGE_KEY = "zelyq.lang";

let current: Language = "en";
let catalogue: Record<string, string> = {};

export function currentLanguage(): Language {
  return current;
}

/** The interface language a locale tag asks for ("de-AT" → "de"), or null if there is none. */
export function languageOf(tag: string | null | undefined): Exclude<Language, "pseudo"> | null {
  if (!tag) return null;
  const primary = tag.toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.find((language) => language.id === primary)?.id ?? null;
}

/** What to start in: `?lang=`, then the last choice on this device, then the browser's. */
export function initialLanguage(): Language {
  try {
    const asked = new URLSearchParams(window.location.search).get("lang");
    if (asked === "pseudo") return "pseudo";
    const fromQuery = languageOf(asked);
    if (fromQuery) return fromQuery;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "pseudo") return "pseudo";
    const fromStore = languageOf(stored);
    if (fromStore) return fromStore;
  } catch {
    // Storage blocked: fall through to the browser's languages.
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const found = languageOf(tag);
    if (found) return found;
  }
  return "en";
}

/** Loads a language's catalogue and makes it current. English needs none. */
export async function loadLanguage(language: Language): Promise<void> {
  current = language;
  if (language === "en" || language === "pseudo") catalogue = {};
  else {
    const loaded =
      language === "fr" ? await import("../locales/fr.json") : await import("../locales/de.json");
    catalogue = (loaded.default ?? loaded) as Record<string, string>;
  }
  if (typeof document !== "undefined") {
    const meta = LANGUAGES.find((l) => l.id === language);
    document.documentElement.lang = language === "pseudo" ? "en-XA" : language;
    document.documentElement.dir = meta?.dir ?? "ltr";
  }
}

/**
 * Switches language for good: remembered on this device, and the page
 * reloads so every screen, menu and constant is drawn in it. Where the choice
 * cannot be remembered, the address carries it (?lang=) for this visit.
 */
export function switchLanguage(language: Language): void {
  if (remember(language)) {
    if (language !== current) window.location.reload();
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("lang", language);
  window.location.assign(url.toString());
}

/** True only when the choice is stored and reads back. */
function remember(language: Language): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, language);
    return localStorage.getItem(STORAGE_KEY) === language;
  } catch {
    return false;
  }
}

/**
 * Keeps the device's language in step with the account's, reloading once if
 * they differ. Never reloads when the choice cannot be stored (that would
 * repeat forever), and never overrides a ?lang= in the address.
 */
export function followAccountLanguage(locale: string | null | undefined): void {
  if (current === "pseudo") return;
  const wanted = languageOf(locale);
  if (!wanted || wanted === current) return;
  try {
    if (new URLSearchParams(window.location.search).has("lang")) return;
    if (localStorage.getItem(STORAGE_KEY) === wanted) return;
  } catch {
    return;
  }
  if (remember(wanted)) window.location.reload();
}

type Value = string | number | boolean | null | undefined | ReactNode;

/** The translated text, with `{name}` placeholders filled. */
export function t(message: string, values?: Record<string, Value>): string {
  const source = current === "pseudo" ? pseudo(message) : (catalogue[message] ?? message);
  const parts = format(source, values ?? {});
  // A React element among the values (a link, bold words) comes back as a
  // fragment; typed as a string because nearly every use is plain text.
  if (parts.some((part) => typeof part === "object" && part !== null)) {
    return createElement(
      Fragment,
      null,
      ...parts.map((part, i) =>
        isValidElement(part) ? createElement(Fragment, { key: i }, part) : part,
      ),
    ) as unknown as string;
  }
  return parts.join("");
}

/**
 * A server message, translated when the catalogue knows it. Messages with
 * values in them ("Pipeline deploy-web not found") are matched against the
 * server's own list (locales/server.json, kept by scripts/check-i18n.mjs),
 * where the values are {0}, {1}, …
 */
export function translateServerMessage(message: string): string {
  if (catalogue[message] || current === "en") return catalogue[message] ?? message;
  if (current === "pseudo" && (serverMessages as string[]).includes(message))
    return pseudo(message);
  for (const { template, pattern } of serverTemplates()) {
    const found = pattern.exec(message);
    if (!found) continue;
    const values = Object.fromEntries(found.slice(1).map((value, i) => [String(i), value]));
    const source = current === "pseudo" ? pseudo(template) : (catalogue[template] ?? template);
    return format(source, values).join("");
  }
  return message;
}

const DISPLAY_FIELDS = new Set([
  "label",
  "description",
  "help",
  "placeholder",
  "title",
  "hint",
  "unit",
]);

/**
 * Translates, in place, the words the server sends for showing (a setting's
 * label and help, a plan's limits, a model's description). Only fields with
 * those names, and only text the server is known to send, so names and
 * values are never touched.
 */
export function translateDisplayFields<T>(payload: T): T {
  if (current === "en") return payload;
  const visit = (node: unknown, depth: number): void => {
    if (depth > 12 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string") {
        if (DISPLAY_FIELDS.has(key) && isServerText(value))
          record[key] = translateServerMessage(value);
      } else if (typeof value === "object") visit(value, depth + 1);
    }
  };
  visit(payload, 0);
  return payload;
}

let serverSet: Set<string> | null = null;
/** Text the server is known to send (locales/server.json), not a name someone chose. */
function isServerText(value: string): boolean {
  serverSet ??= new Set(serverMessages as string[]);
  return serverSet.has(value) || serverTemplates().some(({ pattern }) => pattern.test(value));
}

let templates: Array<{ template: string; pattern: RegExp }> | null = null;
function serverTemplates() {
  templates ??= (serverMessages as string[])
    // Too little fixed text ("{0} at {1}.") would match anything: exact only.
    .filter(
      (message) => /\{\d+\}/.test(message) && message.replace(/\{\d+\}|[^A-Za-z]/g, "").length >= 6,
    )
    .map((template) => {
      const source = template
        .split(/(\{\d+\})/)
        .map((part, i) =>
          i % 2 === 1
            ? "([\\s\\S]+?)"
            : part.replace(/'([{}])'/g, "$1").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("");
      return { template, pattern: new RegExp(`^${source}$`) };
    })
    // The most specific first: more fixed text means a surer match.
    .sort(
      (a, b) =>
        b.template.replace(/\{\d+\}/g, "").length - a.template.replace(/\{\d+\}/g, "").length,
    );
  return templates;
}

/* ------------------------------------------------------------------------ */
/* A small ICU MessageFormat subset: {name}, plural, select, '{' quoting.   */
/* ------------------------------------------------------------------------ */

function format(message: string, values: Record<string, Value>, hash?: number): Value[] {
  const out: Value[] = [];
  let text = "";
  let i = 0;
  const push = () => {
    if (text) out.push(text);
    text = "";
  };
  while (i < message.length) {
    const ch = message[i]!;
    if (
      ch === "'" &&
      (message[i + 1] === "{" || message[i + 1] === "}") &&
      message[i + 2] === "'"
    ) {
      // '{' and '}' are literal braces; any other apostrophe is just text.
      text += message[i + 1];
      i += 3;
      continue;
    }
    if (ch === "#" && hash !== undefined) {
      text += new Intl.NumberFormat(current === "pseudo" ? "en" : current).format(hash);
      i++;
      continue;
    }
    if (ch !== "{") {
      text += ch;
      i++;
      continue;
    }
    const end = matching(message, i);
    const inner = message.slice(i + 1, end);
    i = end + 1;
    const [name, kind, ...rest] = splitTop(inner);
    const key = name!.trim();
    const value = values[key];
    if (!kind) {
      if (typeof value === "object" && value !== null) {
        push();
        out.push(value);
      } else text += value === undefined || value === null ? "" : String(value);
      continue;
    }
    const options = parseOptions(rest.join(","));
    let chosen: string | undefined;
    if (kind.trim() === "plural" || kind.trim() === "selectordinal") {
      const n = Number(value);
      const rules = new Intl.PluralRules(current === "pseudo" ? "en" : current, {
        type: kind.trim() === "plural" ? "cardinal" : "ordinal",
      });
      chosen = options[`=${n}`] ?? options[rules.select(n)] ?? options.other;
      if (chosen !== undefined) {
        push();
        out.push(...format(chosen, values, n));
      }
    } else {
      chosen = options[String(value)] ?? options.other;
      if (chosen !== undefined) {
        push();
        out.push(...format(chosen, values, hash));
      }
    }
  }
  push();
  return out;
}

function matching(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "'" && (text[i + 1] === "{" || text[i + 1] === "}") && text[i + 2] === "'") {
      i += 2;
      continue;
    }
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

/** Splits "count, plural, one {…} other {…}" at top-level commas (first two only). */
function splitTop(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length && parts.length < 2; i++) {
    const c = inner[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

function parseOptions(text: string): Record<string, string> {
  const options: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i]!)) i++;
    let key = "";
    while (i < text.length && text[i] !== "{" && !/\s/.test(text[i]!)) key += text[i++];
    while (i < text.length && text[i] !== "{") i++;
    if (i >= text.length) break;
    const end = matching(text, i);
    options[key] = text.slice(i + 1, end);
    i = end + 1;
  }
  return options;
}

/** "[Ŝàvé çhàñĝéš ~~~]": shows untranslated text and room for longer words. */
function pseudo(message: string): string {
  const map: Record<string, string> = {
    a: "à",
    e: "é",
    i: "î",
    o: "ö",
    u: "ü",
    c: "ç",
    n: "ñ",
    s: "š",
    y: "ý",
    g: "ĝ",
    A: "À",
    E: "É",
    I: "Î",
    O: "Ö",
    U: "Ü",
    C: "Ç",
    N: "Ñ",
    S: "Š",
    Y: "Ý",
    G: "Ĝ",
  };
  let out = "";
  let depth = 0;
  for (const ch of message) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    out += depth > 0 || ch === "}" ? ch : (map[ch] ?? ch);
  }
  const pad = "~".repeat(Math.max(1, Math.round(message.replace(/\{[^}]*\}/g, "").length * 0.35)));
  return `[${out} ${pad}]`;
}
