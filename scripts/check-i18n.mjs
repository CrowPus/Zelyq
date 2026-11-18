#!/usr/bin/env node
/**
 * Keeps the web app's translations whole.
 *
 * Every message — the English inside t("…") in apps/web/src, and every
 * message the server sends in a ZelyqError — must have a French and a German
 * translation in apps/web/src/locales, with the same {placeholders}. The
 * server's messages are listed in locales/server.json, which this script
 * keeps in step (`--update` rewrites it and drops translations nothing uses).
 *
 * Ratchet (may only go down): English left outside t() in JSX text and in
 * the attributes people read (placeholder, title, aria-label, label, …).
 * The allowed count lives in scripts/i18n-baseline.json.
 *
 *   node scripts/check-i18n.mjs            check
 *   node scripts/check-i18n.mjs --update   rewrite server.json, prune, lower the ratchet
 *   node scripts/check-i18n.mjs --missing fr   print what French still lacks, as JSON
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const web = path.join(root, "apps/web/src");
const locales = path.join(web, "locales");
const baselineFile = path.join(root, "scripts/i18n-baseline.json");
const LANGUAGES = ["fr", "de"];
const args = process.argv.slice(2);
const update = args.includes("--update");
const missingFor = args.includes("--missing") ? args[args.indexOf("--missing") + 1] : null;

function walk(dir, test) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ["node_modules", "dist", "test", "__tests__"].includes(entry.name)
        ? []
        : walk(full, test);
    }
    return test(entry.name) ? [full] : [];
  });
}

/** Reads the JS string literal starting at `at`; null if there is none or it is not plain. */
function literalAt(text, at) {
  const quote = text[at];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  let value = "";
  let i = at + 1;
  while (i < text.length && text[i] !== quote) {
    if (quote === "`" && text[i] === "$" && text[i + 1] === "{") return { dynamic: true };
    if (text[i] === "\\") {
      const next = text[i + 1];
      const map = { n: "\n", t: "\t", r: "\r", 0: "\0" };
      if (next === "u") {
        const hex =
          text[i + 2] === "{" ? text.slice(i + 3, text.indexOf("}", i)) : text.slice(i + 2, i + 6);
        value += String.fromCodePoint(Number.parseInt(hex, 16));
        i += text[i + 2] === "{" ? hex.length + 4 : 6;
        continue;
      }
      if (next === "\n") {
        i += 2;
        continue;
      }
      value += map[next] ?? next;
      i += 2;
      continue;
    }
    value += text[i++];
  }
  return { value, end: i + 1 };
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/* ---- The web app's messages ------------------------------------------- */

const webFiles = walk(web, (name) => /\.(tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name));
const webKeys = new Map(); // message -> first place used
const problems = [];
for (const file of webFiles) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  for (const match of text.matchAll(/(?<![\w.$])t\(\s*/g)) {
    const at = match.index + match[0].length;
    const found = literalAt(text, at);
    if (!found) continue; // t(variable): its words are keys elsewhere.
    if (found.dynamic) {
      problems.push(
        `${rel}:${lineOf(text, at)}  t() takes a fixed message; put values in {placeholders}.`,
      );
      continue;
    }
    if (!webKeys.has(found.value)) webKeys.set(found.value, `${rel}:${lineOf(text, at)}`);
  }
}

/* ---- The server's messages -------------------------------------------- */

const serverFiles = ["apps/server/src", "packages/core/src", "packages/db/src"].flatMap((dir) =>
  walk(path.join(root, dir), (name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name)),
);
const quoteBraces = (text) => text.replace(/[{}]/g, (c) => `'${c}'`);
const serverKeys = new Set();
/** The message starting at `at`: one literal, or several joined with +; null if any part is not literal. */
function messageAt(text, at) {
  let i = at;
  let message = "";
  let slot = 0;
  for (;;) {
    const piece = text[i] === "`" ? templateAt(text, i, slot) : literalAt(text, i);
    if (!piece || piece.dynamic) return null;
    message += piece.slots === undefined ? quoteBraces(piece.value) : piece.value;
    slot += piece.slots ?? 0;
    const rest = /^\s*\+\s*/.exec(text.slice(piece.end));
    if (!rest) return message || null;
    i = piece.end + rest[0].length;
  }
}

for (const file of serverFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/new ZelyqError\(\s*(?:"[a-z_]+"|'[a-z_]+'),\s*/g)) {
    const message = messageAt(text, match.index + match[0].length);
    if (message) serverKeys.add(message);
  }
}

/*
 * Words the server and the shared package show in the interface: settings,
 * plans, roles, models, permissions. The web app translates these fields as
 * they arrive (lib/api.ts) or where it shows the shared constants.
 */
const DISPLAY = [
  [
    "apps/server/src/services/settings.ts",
    /\b(name|label|description|help|placeholder|title|hint)$/,
  ],
  ["packages/core/src/plans.ts", /\b(label|description|unit)$/],
  ["packages/core/src/auth.ts", /^(viewer|editor|admin|owner)$/],
  ["packages/core/src/anthropic-models.ts", /\bdescription$/],
  ["packages/core/src/google-models.ts", /\bdescription$/],
  ["packages/core/src/openai-models.ts", /\bdescription$/],
  ["packages/core/src/pipelines.ts", /\b(label|description)$/],
  ["packages/core/src/agents.ts", /\b(label|description)$/],
  ["packages/core/src/ops.ts", /\b(label|description)$/],
];
for (const [file, keyPattern] of DISPLAY) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  for (const match of text.matchAll(/(?:^|[\s{,])([A-Za-z_]\w*):\s*(?=["'`])/g)) {
    if (!keyPattern.test(match[1])) continue;
    const message = messageAt(text, match.index + match[0].length);
    if (message && /[A-Za-z]{2,}/.test(message) && !/^[a-z0-9_.:/-]+$/.test(message))
      serverKeys.add(message);
  }
}
for (const dir of fs.readdirSync(path.join(root, "templates"))) {
  const file = path.join(root, "templates", dir, "template.json");
  if (!fs.existsSync(file)) continue;
  const template = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of ["title", "description"]) {
    if (typeof template[key] === "string") serverKeys.add(quoteBraces(template[key]));
  }
}

/** A template literal, its ${…} parts as {n}, {n+1}, … to match the sent text. */
function templateAt(text, at, firstSlot) {
  let message = "";
  let chunk = "";
  let slot = firstSlot;
  let i = at + 1;
  while (i < text.length && text[i] !== "`") {
    if (text[i] === "\\") {
      chunk += text[i + 1] === "n" ? "\n" : text[i + 1];
      i += 2;
    } else if (text[i] === "$" && text[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") depth--;
        else if (text[i] === "`") {
          i++;
          while (i < text.length && text[i] !== "`") i++;
        }
        i++;
      }
      message += `${quoteBraces(chunk)}{${slot++}}`;
      chunk = "";
    } else chunk += text[i++];
  }
  return { value: message + quoteBraces(chunk), end: i + 1, slots: slot - firstSlot };
}

const serverFile = path.join(locales, "server.json");
const serverList = [...serverKeys].sort();
const stored = fs.existsSync(serverFile) ? JSON.parse(fs.readFileSync(serverFile, "utf8")) : [];
if (update) fs.writeFileSync(serverFile, `${JSON.stringify(serverList, null, 2)}\n`);
else if (JSON.stringify(stored) !== JSON.stringify(serverList)) {
  problems.push(
    "apps/web/src/locales/server.json is out of step with the server's messages; run `node scripts/check-i18n.mjs --update`.",
  );
}

/* ---- Every message translated, placeholders intact -------------------- */

const keys = new Set([...webKeys.keys(), ...serverList]);
/** The argument names in an ICU message, plural and select bodies included. */
function placeholders(message) {
  const names = [];
  const text = message.replace(/'[{}]'/g, "");
  const close = (at) => {
    let depth = 0;
    for (let i = at; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) return i;
    }
    return text.length;
  };
  const walkText = (from, to) => {
    for (let i = from; i < to; i++) {
      if (text[i] !== "{") continue;
      const end = close(i);
      const inner = text.slice(i + 1, end);
      const [name, kind] = inner.split(",", 2).map((part) => part.trim());
      names.push(name);
      if (kind && /^(plural|select|selectordinal)$/.test(kind)) {
        // Options: key {body} …; arguments may sit inside each body.
        const optionsAt = i + 1 + inner.indexOf(",", inner.indexOf(",") + 1) + 1;
        for (let j = optionsAt; j < end; j++) {
          if (text[j] === "{") {
            const bodyEnd = close(j);
            walkText(j + 1, bodyEnd);
            j = bodyEnd;
          }
        }
      }
      i = end;
    }
  };
  walkText(0, text.length);
  return names.sort();
}
const same = (a, b) => JSON.stringify([...new Set(a)]) === JSON.stringify([...new Set(b)]);

if (missingFor) {
  const catalogue = JSON.parse(fs.readFileSync(path.join(locales, `${missingFor}.json`), "utf8"));
  const missing = [...keys].filter((key) => !catalogue[key]?.trim());
  console.log(JSON.stringify(missing, null, 1));
  process.exit(0);
}

for (const language of LANGUAGES) {
  const file = path.join(locales, `${language}.json`);
  const catalogue = JSON.parse(fs.readFileSync(file, "utf8"));
  const missing = [...keys].filter((key) => !catalogue[key]?.trim());
  if (missing.length) {
    problems.push(
      `${language}: ${missing.length} message(s) not translated, e.g. ${JSON.stringify(missing[0])} (${webKeys.get(missing[0]) ?? "server"}). List them with --missing ${language}.`,
    );
  }
  for (const [key, value] of Object.entries(catalogue)) {
    if (keys.has(key) && value && !same(placeholders(key), placeholders(value))) {
      problems.push(
        `${language}: placeholders differ for ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
      );
    }
  }
  const unused = Object.keys(catalogue).filter((key) => !keys.has(key));
  if (update && unused.length) {
    for (const key of unused) delete catalogue[key];
    const sorted = Object.fromEntries(
      Object.entries(catalogue).sort(([a], [b]) => (a < b ? -1 : 1)),
    );
    fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(`${language}: dropped ${unused.length} translation(s) nothing uses.`);
  } else if (unused.length) {
    problems.push(
      `${language}: ${unused.length} translation(s) nothing uses, e.g. ${JSON.stringify(unused[0])}; run --update to drop them.`,
    );
  }
}

/* ---- Ratchet: English outside t() -------------------------------------- */

// Files whose words are not the interface's (code, sample data, machine text).
const NOT_INTERFACE = [
  /components\/pipelines\/yaml-editor\//,
  /lib\/pipeline-yaml\.ts$/,
  /lib\/inspector\.ts$/,
  /planReportSanitizer\.ts$/,
  /lib\/i18n\.ts$/,
  /pages\/GalleryPage\.tsx$/,
  /components\/ui\/.*\.stories\.tsx$/,
];
const ATTRIBUTE =
  /\b(placeholder|title|aria-label|label|description|alt|help|hint|emptyText)="([^"]*[A-Za-z]{2}[^"]*)"/g;
const JSX_TEXT = />\s*([A-Za-z][^<>{}]*[A-Za-z.!?…:][^<>{}]*)\s*</g;
const untranslated = [];
for (const file of webFiles) {
  const rel = path.relative(web, file);
  if (!file.endsWith(".tsx") || NOT_INTERFACE.some((re) => re.test(rel))) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(ATTRIBUTE)) {
    if (/^[\w-]+$/.test(match[2]) && !/^[A-Z]/.test(match[2])) continue; // ids, not words
    // Example values, not words: addresses, URLs, CONSTANT_NAMES, host names.
    if (/@|:\/\/|^[A-Z0-9_]+$|^[\w.-]+\.[a-z]{2,}$/.test(match[2])) continue;
    untranslated.push(`${path.relative(root, file)}:${lineOf(text, match.index)}  ${match[0]}`);
  }
  for (const match of text.matchAll(JSX_TEXT)) {
    const words = match[1].trim();
    // Code between angle brackets (generics, comparisons) is not text.
    if (/[=;()&|]|=>|\b(const|return|typeof|extends)\b/.test(words)) continue;
    if (/^(Promise|Record|Array|Partial|Readonly|ReturnType|Set|Map|HTMLElement)$/.test(words))
      continue;
    if (!/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(words) && !/^[A-Z][a-z]+[.!?:…]?$/.test(words))
      continue;
    untranslated.push(
      `${path.relative(root, file)}:${lineOf(text, match.index)}  ${words.slice(0, 60)}`,
    );
  }
}
const baseline = fs.existsSync(baselineFile)
  ? JSON.parse(fs.readFileSync(baselineFile, "utf8"))
  : { untranslated: untranslated.length };
if (update) {
  fs.writeFileSync(
    baselineFile,
    `${JSON.stringify({ untranslated: untranslated.length }, null, 2)}\n`,
  );
} else if (untranslated.length > baseline.untranslated) {
  problems.push(
    `English outside t(): ${untranslated.length}, allowed ${baseline.untranslated}. Wrap new text in t():\n    ${untranslated.slice(0, process.env.ALL ? 9999 : 20).join("\n    ")}`,
  );
}

if (problems.length) {
  console.error(`check-i18n: ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `check-i18n: ${keys.size} messages (${webKeys.size} web, ${serverList.length} server) translated into ${LANGUAGES.join(", ")}; ${untranslated.length} untranslated spots (allowed ${baseline.untranslated}).`,
);
