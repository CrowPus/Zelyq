import assert from "node:assert/strict";
import { test } from "node:test";
import { type MotionCatalogEntry, readCatalog, resolveInstall } from "../src/motion-install.js";

/**
 * What a set of components actually needs.
 *
 * The registry does not say. Its entries list one file each, so a component
 * that imports a hook resolves to nothing once installed — five of the
 * thirty-three do — and three pull in a package nobody would guess at.
 */

const catalog: MotionCatalogEntry[] = [
  { name: "in-view", dependencies: ["motion"], hooks: [], lines: 58 },
  { name: "animated-group", dependencies: ["motion"], hooks: [], lines: 143 },
  {
    name: "toolbar-expandable",
    dependencies: ["motion", "react-use-measure"],
    hooks: ["useClickOutside"],
    lines: 130,
  },
  { name: "dialog", dependencies: ["motion"], hooks: ["usePreventScroll"], lines: 200 },
];

test("the wrappers need nothing but motion and the cn helper's two", () => {
  const plan = resolveInstall(["in-view", "animated-group"], catalog);
  assert.deepEqual(plan.packages, ["clsx", "motion", "tailwind-merge"]);
  assert.deepEqual(plan.hooks, []);
  assert.equal(plan.components.length, 2);
});

test("a component's hook comes with it", () => {
  // The registry never mentions these, so a component installed without its
  // hook fails to resolve the moment it is imported.
  const plan = resolveInstall(["dialog"], catalog);
  assert.deepEqual(plan.hooks, ["usePreventScroll"]);
});

test("hooks are collected once across several components that share one", () => {
  const plan = resolveInstall(["toolbar-expandable", "toolbar-expandable"], catalog);
  assert.deepEqual(plan.hooks, ["useClickOutside"]);
  assert.equal(plan.components.length, 1, "asking twice installs once");
});

test("an unusual package is picked up from the component that needs it", () => {
  const plan = resolveInstall(["toolbar-expandable"], catalog);
  assert.ok(plan.packages.includes("react-use-measure"));
});

test("a name that is not in the catalogue is reported, not silently skipped", () => {
  const plan = resolveInstall(["in-view", "parallax-hero"], catalog);
  assert.deepEqual(plan.unknown, ["parallax-hero"]);
  assert.equal(plan.components.length, 1);
});

test("the real vendored catalogue is present and complete", async () => {
  // Guards the vendoring itself: a refresh that half-ran, or a components
  // directory that drifted from the catalogue, shows up here rather than in
  // somebody's project.
  const { components, root } = await readCatalog();
  assert.equal(components.length, 33);
  assert.ok(components.some((c) => c.name === "in-view"));

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  for (const entry of components) {
    const file = path.join(root, "components", `${entry.name}.tsx`);
    const source = await fs.readFile(file, "utf8");
    assert.ok(source.length > 100, `${entry.name} is suspiciously small`);
    assert.doesNotMatch(source, /^'use client';/, `${entry.name} still carries the Next directive`);
    assert.doesNotMatch(
      source,
      /keyof JSX\.IntrinsicElements/,
      `${entry.name} still uses the JSX namespace React 19 removed`,
    );
  }
  for (const hook of new Set(components.flatMap((c) => c.hooks))) {
    await fs.access(path.join(root, "hooks", `${hook}.tsx`));
  }
});
