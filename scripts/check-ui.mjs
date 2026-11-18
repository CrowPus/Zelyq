#!/usr/bin/env node
/**
 * Keeps the web app on its design system.
 *
 * Hard rules (any hit fails): browser pop-ups, raw `<select>`, raw date
 * formatting, colours outside the token set, and type smaller than 11px.
 *
 * Ratchets (may only go down): raw `<button>`, `<input>` and `<textarea>`
 * outside `components/ui`. The allowed counts live in `scripts/ui-baseline.json`;
 * run with `--update` after removing some to lower them.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = path.join(root, "apps/web/src");
const baselineFile = path.join(root, "scripts/ui-baseline.json");
const update = process.argv.includes("--update");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(entry.name) ? [full] : [];
  });
}

const files = walk(src).filter(
  (file) => !file.includes(`${path.sep}components${path.sep}ui${path.sep}`),
);

const RULES = [
  {
    id: "browser-popup",
    why: "Use confirmAction() / promptAction() from components/ui, not the browser's own box.",
    re: /\bwindow\.(confirm|alert|prompt)\s*\(/g,
  },
  {
    id: "raw-select",
    why: "Use <NativeSelect> or <Select> from components/ui.",
    re: /<select\b/g,
  },
  {
    id: "raw-date",
    why: "Use formatDate / formatDateTime / formatTime from lib/format, or <RelativeTime>.",
    re: /new Date\([^)]*\)\.toLocale(Date|Time)?String\(\s*\)/g,
  },
  {
    id: "palette-colour",
    why: "Use the design tokens (bg-surface, text-danger, …), not Tailwind's palette.",
    re: /\b(?:bg|text|border|ring|fill|stroke)-(?:red|blue|green|yellow|amber|emerald|sky|indigo|purple|violet|pink|rose|orange|gray|slate|zinc|neutral|stone|cyan|teal|lime)-\d{2,3}\b/g,
  },
  {
    id: "hex-colour",
    why: "Colours come from tokens in index.css.",
    re: /(?<![\w&])#[0-9a-fA-F]{6}\b(?![\w-])/g,
    only: /\.tsx$/,
  },
  {
    id: "tiny-text",
    why: "The smallest type is 11px (text-2xs).",
    re: /\btext-\[(?:[0-9]|10)px\]/g,
  },
];

const RATCHETS = [
  { id: "raw-button", re: /<button\b/g },
  { id: "raw-input", re: /<input\b(?![^>]*type="(?:checkbox|radio|file|hidden|range|color)")/g },
  { id: "raw-textarea", re: /<textarea\b/g },
];

let failed = false;
for (const rule of RULES) {
  const hits = [];
  for (const file of files) {
    if (rule.only && !rule.only.test(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(rule.re)) {
      const line = text.slice(0, match.index).split("\n").length;
      hits.push(`${path.relative(root, file)}:${line}  ${match[0]}`);
    }
  }
  if (hits.length) {
    failed = true;
    console.error(`\n✗ ${rule.id} — ${rule.why}`);
    for (const hit of hits) console.error(`    ${hit}`);
  }
}

const counts = Object.fromEntries(
  RATCHETS.map((r) => [
    r.id,
    files.reduce((sum, file) => sum + [...fs.readFileSync(file, "utf8").matchAll(r.re)].length, 0),
  ]),
);
const baseline = fs.existsSync(baselineFile)
  ? JSON.parse(fs.readFileSync(baselineFile, "utf8"))
  : {};
for (const [id, count] of Object.entries(counts)) {
  const allowed = baseline[id];
  if (allowed !== undefined && count > allowed) {
    failed = true;
    console.error(
      `\n✗ ${id}: ${count} outside components/ui, up from ${allowed}. Use the library component instead.`,
    );
  } else {
    console.log(`  ${id}: ${count}${allowed !== undefined ? ` (allowed ${allowed})` : ""}`);
  }
}
if (update) {
  fs.writeFileSync(baselineFile, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`Baseline written to ${path.relative(root, baselineFile)}.`);
}

if (failed) {
  console.error("\nThe web app strayed from its design system. See components/ui and /dev/ui.");
  process.exit(1);
}
console.log("✓ The web app keeps to its design system.");
