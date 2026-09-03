#!/usr/bin/env node
/**
 * Re-pull Motion Primitives from upstream into `components/`.
 *
 * The components are vendored rather than fetched at run time, for three
 * reasons measured in `docs/motion-command.md`: the whole set is 159 KB,
 * upstream changes about twice a year, and — the one that decides it — fetching
 * would pipe unreviewed third-party code into a user's project at generation
 * time. Vendored, an upstream change is a diff somebody reads.
 *
 * Run it, read the diff, commit it. That is the whole update process.
 */
import fs from "node:fs/promises";
import path from "node:path";

const RAW = "https://raw.githubusercontent.com/ibelick/motion-primitives/main";
const REGISTRY = `${RAW}/public/c`;
const HERE = path.dirname(new URL(import.meta.url).pathname);

/**
 * Changes we apply to every component, and why.
 *
 * These are not preferences. Upstream targets React 18, and Zelyq's template is
 * React 19 with `strict` and `noUnusedLocals` on, running `tsc` on every turn —
 * so an unpatched component fails the turn rather than merely looking untidy.
 */
const PATCHES = [
  {
    name: "react-19-jsx-namespace",
    why: "React 19 removed the global JSX namespace; it lives on React.JSX now.",
    apply: (s) => s.replaceAll("keyof JSX.IntrinsicElements", "keyof React.JSX.IntrinsicElements"),
  },
  {
    name: "react-19-motion-create-loses-props",
    why:
      "Once the cast above is right, `motion.create` still returns a component " +
      "whose props TypeScript cannot see, so `className` fails to assign. " +
      "Widening to ElementType restores it without pretending to know the tag.",
    apply: (s) =>
      s.replace(
        /(const Motion\w+ = React\.useMemo\(\s*\(\) => motion\.create\([^)]*\),\s*\[\w+\]\s*\))(;)/g,
        "$1 as React.ElementType$2",
      ),
  },
  {
    name: "react-19-unused-type-imports",
    why:
      "`noUnusedLocals` is on in the template and off upstream. React 19's JSX " +
      "transform means `React` no longer has to be in scope for JSX, and `JSX` " +
      "as a type import is unused once the namespace patch above lands — so " +
      "both become hard errors here and warnings nowhere else.",
    apply: (s) => {
      // Only when the file really does not use it. An earlier version stripped
      // `React` unconditionally and broke every component that calls
      // `React.Children` — the import was unused as a *value in JSX*, which is
      // not the same as unused.
      const usesReactValue = /\bReact\.[A-Za-z]/.test(s);
      let out = s;
      if (!usesReactValue) {
        out = out.replace(/^import React, \{([^}]*)\} from 'react';$/m, (m, rest) =>
          /\w/.test(rest) ? `import {${rest}} from 'react';` : m,
        );
        out = out.replace(/^import React from 'react';\n/m, "");
      }
      out = out.replace(/^import \{ JSX \} from 'react';\n/m, "");
      out = out.replace(/^import type \{ JSX \} from 'react';\n/m, "");
      out = out.replace(/^import React, \{ JSX \} from 'react';$/m, "import React from 'react';");
      out = out.replace(/^import \{ JSX, ([^}]*)\} from 'react';$/m, "import { $1} from 'react';");
      out = out.replace(/^import \{([^}]*), JSX \} from 'react';$/m, "import {$1} from 'react';");
      return out;
    },
  },
  {
    name: "react-19-type-only-jsx-import",
    why:
      "`import { type JSX }` is only there for `JSX.IntrinsicElements` in a " +
      "props type, which React 19 moved onto `React.JSX`. Left behind it is an " +
      "unused local, which `noUnusedLocals` rejects.",
    apply: (s) => {
      // `React.JSX` also contains "JSX", and the namespace patch above has
      // already rewritten every use into that form — so a naive search says the
      // import is still needed when it is not.
      const body = s.replace(/^import[^\n]*\n/gm, "").replace(/React\.JSX/g, "");
      if (!/\bJSX\b/.test(body)) {
        return s
          .replace(/^import \{ type JSX, ([^}]*)\} from 'react';$/m, "import { $1} from 'react';")
          .replace(/^import \{([^}]*), type JSX \} from 'react';$/m, "import {$1} from 'react';")
          .replace(
            /^import React, \{([^}]*), type JSX \} from 'react';$/m,
            "import React, {$1} from 'react';",
          )
          .replace(/^import \{ type JSX \} from 'react';\n/m, "");
      }
      return s;
    },
  },
  {
    name: "react-19-nullable-refs",
    why:
      "React 19 types `useRef<T>(null)` as `RefObject<T | null>`. The hooks " +
      "these components pass those refs to declare `RefObject<T>`, so every " +
      "call site fails. Widening the hook is right — a ref that is null before " +
      "mount is exactly what it has always received.",
    apply: (s) => s.replace(/ref: RefObject<T>,/, "ref: RefObject<T | null>,"),
  },
  {
    name: "react-19-cloneelement-props",
    why:
      "`React.Children.map` gives `ReactElement<unknown>` in React 19, so " +
      "spreading `child.props` is a spread of `unknown`. The cast says what the " +
      "code already assumes.",
    apply: (s) =>
      s
        .replace(/\.\.\.child\.props,/g, "...(child.props as Record<string, unknown>),")
        .replace(
          /\.\.\.\(child as [^)]*\)\.props,/g,
          "...(child.props as Record<string, unknown>),",
        ),
  },
  {
    name: "spring-type-widening",
    why:
      "`{ type: 'spring', … }` infers `type: string`, which does not narrow to " +
      "motion's Transition union under `strict`. Upstream gets away with it " +
      "because the object is inlined at a typed position; once it is a variable " +
      "or nested it is not.",
    apply: (s) => s.replace(/(\btype:\s*)'(spring|tween|keyframes|inertia)'/g, "$1'$2' as const"),
  },
  {
    name: "motion-13-use-scroll-options",
    why: "`layoutEffect` was removed from UseScrollOptions after v11.",
    apply: (s) => s.replace(/^\s*layoutEffect:[^,\n]*,?\n/gm, ""),
  },
  {
    name: "react-19-clone-element-props",
    why:
      "React 19 tightened `cloneElement`: the element from `Children.map` is " +
      "`ReactElement<unknown>`, and cloning it with extra props no longer " +
      "matches an overload. Naming the props type says what the code already " +
      "does.",
    apply: (s) =>
      s
        .replace(
          /cloneElement\(\s*child,/g,
          "cloneElement(child as React.ReactElement<Record<string, unknown>>,",
        )
        .replace(
          /cloneElement\(child as React\.ReactElement,/g,
          "cloneElement(child as React.ReactElement<Record<string, unknown>>,",
        )
        .replace(
          /\(child as React\.ReactElement\)\.props\.className/g,
          "(child as React.ReactElement<{ className?: string }>).props.className",
        ),
  },
  {
    name: "drop-use-client",
    why: "A Next.js directive. Vite projects do not use it and it is dead weight.",
    apply: (s) => s.replace(/^'use client';\n/, ""),
  },
];

/**
 * Fixes that are genuinely about one component.
 *
 * Each entry MUST still match, and the script fails if one does not — an
 * override that has silently stopped applying is how a vendored library ships
 * code nobody has looked at.
 */
const OVERRIDES = {
  "glow-effect": [
    {
      why: "The `animations` record is a union of shapes, so indexing it does not narrow to what `animate` accepts.",
      from: "animate={animations[mode]}",
      to: "animate={animations[mode] as TargetAndTransition}",
    },
    {
      why: "…and the cast above needs the type imported.",
      from: "import { motion, Transition } from 'motion/react';",
      to: "import { motion, Transition, type TargetAndTransition } from 'motion/react';",
    },
  ],
  "spinning-text": [
    {
      why: "`finalTransition` is a union of object literals; `transition` wants the Transition union.",
      from: "transition={finalTransition}",
      to: "transition={finalTransition as Transition}",
    },
  ],
};

async function main() {
  const index = await fetch(`${REGISTRY}/registry.json`)
    .then((r) => r.json())
    .catch(() => null);
  const names = index?.items?.map((i) => i.name);
  if (!names?.length) throw new Error("could not read the registry index");

  await fs.mkdir(path.join(HERE, "components"), { recursive: true });
  // Five components import these, and the registry does not carry them — its
  // entries only ever list one file. Without them those five do not resolve.
  await fs.mkdir(path.join(HERE, "hooks"), { recursive: true });
  for (const hook of ["useClickOutside", "usePreventScroll"]) {
    const source = await (await fetch(`${RAW}/hooks/${hook}.tsx`)).text();
    let patched = source;
    for (const patch of PATCHES) patched = patch.apply(patched);
    await fs.writeFile(path.join(HERE, "hooks", `${hook}.tsx`), patched);
  }
  const catalog = [];
  const applied = new Map();

  for (const name of names.sort()) {
    const item = await (await fetch(`${REGISTRY}/${name}.json`)).json();
    const file = item.files?.[0];
    if (!file?.content) {
      console.warn(`  ${name}: no inlined source, skipped`);
      continue;
    }
    let source = file.content;
    for (const patch of PATCHES) {
      const after = patch.apply(source);
      if (after !== source) applied.set(patch.name, (applied.get(patch.name) ?? 0) + 1);
      source = after;
    }
    for (const override of OVERRIDES[name] ?? []) {
      if (!source.includes(override.from)) {
        throw new Error(
          `${name}: override no longer matches — upstream changed.\n  looking for: ${override.from}\n  reason: ${override.why}`,
        );
      }
      source = source.replace(override.from, override.to);
      applied.set(`override:${name}`, (applied.get(`override:${name}`) ?? 0) + 1);
    }
    await fs.writeFile(path.join(HERE, "components", `${name}.tsx`), source);
    // Which hooks the component imports. The registry never says — its entries
    // list one file — and a component whose hook is missing does not resolve.
    const hooks = [...source.matchAll(/from '@\/hooks\/(\w+)'/g)].map((m) => m[1]);
    catalog.push({
      name,
      dependencies: item.dependencies ?? [],
      hooks: [...new Set(hooks)],
      lines: source.split("\n").length,
    });
  }

  // Short arrays on one line, matching what this repo's formatter would print —
  // so a refresh does not leave the tree failing its own lint.
  const json = JSON.stringify({ source: index.homepage, components: catalog }, null, 2).replace(
    /\[\n\s+((?:"[^"]*",?\s*)+)\n\s+\]/g,
    (_, inner) => `[${inner.trim().replace(/,\s+/g, ", ")}]`,
  );
  await fs.writeFile(path.join(HERE, "catalog.json"), `${json}\n`);

  console.log(`${catalog.length} components`);
  for (const [name, n] of applied) console.log(`  patched ${n}× — ${name}`);
}

await main();
