#!/usr/bin/env node

/**
 * Conservative static scan for web-motion implementation risks.
 * Findings are review leads, not proof that an animation is defective.
 * Requires Node.js 18+ and no third-party packages.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const THIS_SCRIPT = fileURLToPath(import.meta.url);

const EXTENSIONS = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".vue",
  ".svelte",
  ".html",
]);
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".nuxt",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "vendor",
]);
const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3 };

const LINE_RULES = [
  [
    "medium",
    "transition-all",
    /(?:transition\s*:\s*all\b|\btransition-all\b)/i,
    "Broad transitions can animate unexpected properties; list the intended properties.",
  ],
  [
    "medium",
    "layout-transition",
    /transition(?:-property)?\s*:[^;]*(?:width|height|top|left|right|bottom|margin|padding)\b/i,
    "This transition may trigger layout; confirm it is necessary and profile it.",
  ],
  [
    "low",
    "persistent-will-change",
    /will-change\s*:/i,
    "Treat will-change as a measured, limited optimization and check layer/GPU cost.",
  ],
  [
    "medium",
    "infinite-motion",
    /(?:animation[^;\n]*\binfinite\b|animation-iteration-count\s*:\s*infinite)/i,
    "Continuous motion needs purpose, a stop strategy, and a reduced-motion branch.",
  ],
  [
    "low",
    "scroll-handler",
    /(?:addEventListener\s*\(\s*['"]scroll['"]|\bonScroll\s*=)/i,
    "Review scroll work for passive handling, frame batching, and unnecessary per-event state.",
  ],
  [
    "medium",
    "expensive-visual-transition",
    /transition(?:-property)?\s*:[^;]*(?:filter|backdrop-filter|box-shadow|clip-path|mask)\b/i,
    "Paint-heavy visual property is transitioned; profile the painted area on mobile.",
  ],
];

function parseArgs(argv) {
  const options = { project: ".", json: false, failOn: null };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--fail-on") options.failOn = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 1) throw new Error("Accepts at most one project directory.");
  if (positional.length === 1) options.project = positional[0];
  if (options.failOn && !(options.failOn in SEVERITY_RANK)) {
    throw new Error("--fail-on must be one of: info, low, medium, high");
  }
  return options;
}

async function* sourceFiles(root) {
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (
        entry.isFile() &&
        fullPath !== THIS_SCRIPT &&
        EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      )
        yield fullPath;
    }
  }
}

function finding(severity, rule, filePath, line, message) {
  return { severity, rule, path: filePath, line, message };
}

async function scan(root) {
  const findings = [];
  const projectText = [];

  for await (const filePath of sourceFiles(root)) {
    let content;
    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      findings.push(
        finding("low", "read-error", filePath, 0, `Could not read file: ${error.message}`),
      );
      continue;
    }

    const relativePath = path.relative(root, filePath) || ".";
    projectText.push(content);
    content.split(/\r?\n/).forEach((line, index) => {
      for (const [severity, rule, pattern, message] of LINE_RULES) {
        if (pattern.test(line))
          findings.push(finding(severity, rule, relativePath, index + 1, message));
      }
    });
  }

  const combined = projectText.join("\n").toLowerCase();
  const motionMarkers = [
    "@keyframes",
    "animation:",
    "transition:",
    "motion/",
    "framer-motion",
    "gsap",
    "scrolltrigger",
    "requestanimationframe",
    "startviewtransition",
  ];

  if (
    motionMarkers.some((marker) => combined.includes(marker)) &&
    !["prefers-reduced-motion", "usereducedmotion", "reducedmotion"].some((marker) =>
      combined.includes(marker),
    )
  ) {
    findings.push(
      finding(
        "high",
        "missing-reduced-motion",
        ".",
        0,
        "Motion code was found but no reduced-motion policy was detected in scanned source.",
      ),
    );
  }
  if (combined.includes("requestanimationframe") && !combined.includes("cancelanimationframe")) {
    findings.push(
      finding(
        "medium",
        "animation-frame-cleanup",
        ".",
        0,
        "requestAnimationFrame is used but cancelAnimationFrame was not detected; verify lifecycle cleanup.",
      ),
    );
  }
  if (
    (combined.includes("scrolltrigger") || combined.includes("gsap.")) &&
    !["context.revert", ".revert()", ".kill()", "usegsap"].some((marker) =>
      combined.includes(marker),
    )
  ) {
    findings.push(
      finding(
        "medium",
        "gsap-cleanup",
        ".",
        0,
        "GSAP usage was detected without an obvious scoped cleanup marker; verify unmount and breakpoint cleanup.",
      ),
    );
  }
  if (
    ["from 'three'", 'from "three"', "@react-three/fiber"].some((marker) =>
      combined.includes(marker),
    ) &&
    !combined.includes(".dispose(")
  ) {
    findings.push(
      finding(
        "medium",
        "webgl-disposal",
        ".",
        0,
        "Three.js/R3F usage was detected without explicit disposal; verify GPU resource ownership and cleanup.",
      ),
    );
  }
  if (
    combined.includes("startviewtransition") &&
    ![
      "if (!document.startviewtransition",
      "if (document.startviewtransition",
      "'startviewtransition' in document",
      '"startviewtransition" in document',
    ].some((marker) => combined.includes(marker))
  ) {
    findings.push(
      finding(
        "medium",
        "view-transition-fallback",
        ".",
        0,
        "View Transition API usage was detected without an obvious feature-detection branch.",
      ),
    );
  }

  return findings.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.rule.localeCompare(b.rule),
  );
}

function usage() {
  return "Usage: node scripts/audit-motion.mjs [project] [--json] [--fail-on info|low|medium|high]";
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${usage()}`);
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const root = path.resolve(options.project);
  let findings;
  try {
    findings = await scan(root);
  } catch (error) {
    console.error(`Could not scan ${root}: ${error.message}`);
    return 2;
  }

  if (options.json) console.log(JSON.stringify({ root, findings }, null, 2));
  else if (!findings.length)
    console.log(
      "No static motion risks detected. Browser and accessibility testing are still required.",
    );
  else {
    for (const item of findings) {
      const location = item.line ? `${item.path}:${item.line}` : item.path;
      console.log(
        `[${item.severity.toUpperCase().padEnd(6)}] ${item.rule.padEnd(28)} ${location} — ${item.message}`,
      );
    }
    console.log(
      `\n${findings.length} finding(s). Treat these as review leads, not proof of defects.`,
    );
  }

  if (
    options.failOn &&
    findings.some((item) => SEVERITY_RANK[item.severity] >= SEVERITY_RANK[options.failOn])
  )
    return 1;
  return 0;
}

process.exitCode = await main();
