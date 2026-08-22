import type { EvalCase } from "./types.js";

/**
 * The suite.
 *
 * Cases are written the way a user would actually type them — terse, slightly
 * under-specified, occasionally a little rude. A prompt written to be easy for
 * the agent measures nothing.
 *
 * Five tags, and the balance between them is deliberate:
 *   greenfield — build something new. The demo path.
 *   modify     — change code that already exists. The real path.
 *   bugfix     — a planted defect. Tests reading over guessing.
 *   restraint  — the agent should do *less* than it wants to.
 *   quality    — the output has to be good, not merely compiling.
 *
 * `restraint` matters more than its share of the suite suggests. An agent that
 * rewrites four files to change a label is not a good agent, and no build check
 * will ever catch it.
 */
export const CASES: EvalCase[] = [
  // ---------------------------------------------------------------- greenfield
  {
    id: "landing-page",
    title: "Marketing landing page",
    tags: ["greenfield", "quality"],
    prompt:
      "Build a landing page for a note-taking app called Marginal. Hero with a headline and a " +
      "call to action, three feature cards, and a footer. Make it look good.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      {
        kind: "file_matches",
        path: "src/App.tsx",
        pattern: "Marginal",
        why: "uses the given name",
      },
      {
        kind: "project_matches",
        pattern: "<footer",
        why: "uses a semantic footer rather than a div",
      },
      {
        kind: "project_matches",
        pattern: "sm:|md:|lg:",
        why: "has at least one responsive breakpoint",
      },
    ],
  },
  {
    id: "todo-app",
    title: "Todo list with persistence",
    tags: ["greenfield"],
    prompt:
      "Make a todo list. I want to add items, tick them off, and delete them, and it should " +
      "still be there when I refresh the page.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      { kind: "project_matches", pattern: "localStorage", why: "persists across a refresh" },
      { kind: "project_matches", pattern: "useState", why: "holds list state" },
    ],
  },
  {
    id: "pricing-toggle",
    title: "Pricing table with a billing toggle",
    tags: ["greenfield", "quality"],
    prompt:
      "Add a pricing section with three tiers — Free, Pro, Team — and a toggle that switches " +
      "between monthly and annual prices. Annual should be two months cheaper.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      { kind: "project_matches", pattern: "annual|Annual|yearly|Yearly", why: "implements annual" },
      {
        kind: "project_matches",
        pattern: "<button",
        why: "the toggle is a real button, not a clickable div",
      },
    ],
  },
  {
    id: "dashboard-layout",
    title: "Dashboard shell",
    tags: ["greenfield", "quality"],
    prompt:
      "Build an analytics dashboard layout: a fixed sidebar with nav links, a top bar, and a " +
      "grid of four stat cards with placeholder numbers. No real data.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      { kind: "project_matches", pattern: "<nav|<aside", why: "uses semantic landmarks" },
      { kind: "project_matches", pattern: "grid|flex", why: "lays the cards out" },
    ],
  },
  {
    id: "contact-form",
    title: "Form with validation",
    tags: ["greenfield", "quality"],
    prompt:
      "Add a contact form — name, email, message — that validates on submit and shows an error " +
      "under any field that is wrong. Don't send it anywhere yet.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      {
        kind: "project_matches",
        pattern: "<label|aria-label",
        why: "inputs are labelled",
      },
      {
        kind: "project_matches",
        pattern: "fetch\\(|axios",
        expect: "absent",
        why: "was told not to submit anywhere",
      },
    ],
  },

  // -------------------------------------------------------------------- modify
  {
    id: "dark-mode",
    title: "Add a theme toggle",
    tags: ["modify"],
    prompt: "Add a light/dark mode toggle to the page. Remember my choice.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      { kind: "project_matches", pattern: "dark:|dark\"|'dark'", why: "implements a dark theme" },
      { kind: "project_matches", pattern: "localStorage", why: "remembers the choice" },
    ],
  },
  {
    id: "extract-components",
    title: "Refactor into components",
    tags: ["modify", "restraint"],
    setup: [
      {
        path: "src/App.tsx",
        content: `export default function App() {
  return (
    <main className="min-h-screen bg-white p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-gray-600">Everything in one file, for now.</p>
      </header>
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded border p-4">
          <p className="text-sm text-gray-500">Revenue</p>
          <p className="text-2xl font-semibold">$12,400</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-sm text-gray-500">Users</p>
          <p className="text-2xl font-semibold">1,204</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-sm text-gray-500">Churn</p>
          <p className="text-2xl font-semibold">2.1%</p>
        </div>
      </section>
    </main>
  );
}
`,
      },
    ],
    prompt:
      "App.tsx is doing too much. Pull the header and the stat card out into their own " +
      "components. Don't change how it looks.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      { kind: "project_matches", pattern: "12,400", why: "kept the existing content" },
      { kind: "no_new_dependency" },
    ],
  },
  {
    id: "add-routing",
    title: "Add client-side routing",
    tags: ["modify"],
    prompt:
      "Add routing with two pages — a home page and an about page — and a nav link between them.",
    maxIterations: 60,
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      { kind: "project_matches", pattern: "react-router|wouter|Router", why: "routing exists" },
    ],
  },
  {
    id: "responsive-fix",
    title: "Make a fixed layout responsive",
    tags: ["modify", "quality"],
    setup: [
      {
        path: "src/App.tsx",
        content: `export default function App() {
  return (
    <main style={{ width: "1200px", padding: "40px" }}>
      <h1 style={{ fontSize: "48px" }}>Quarterly report</h1>
      <div style={{ display: "flex", gap: "24px" }}>
        <div style={{ width: "600px" }}>Left column</div>
        <div style={{ width: "600px" }}>Right column</div>
      </div>
    </main>
  );
}
`,
      },
    ],
    prompt: "This page is broken on my phone. Fix it.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      {
        kind: "file_matches",
        path: "src/App.tsx",
        pattern: "1200px",
        expect: "absent",
        why: "removed the hard-coded desktop width",
      },
    ],
  },

  // -------------------------------------------------------------------- bugfix
  {
    id: "fix-type-error",
    title: "Fix a type error",
    tags: ["bugfix", "restraint"],
    setup: [
      {
        path: "src/App.tsx",
        content: `interface User {
  name: string;
  age: number;
}

function greet(user: User): string {
  return \`Hello \${user.name}, you are \${user.age}\`;
}

export default function App() {
  const user = { name: "Ada", age: "36" };
  return <main className="p-8">{greet(user)}</main>;
}
`,
      },
    ],
    prompt: "The build is failing. Fix it.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      { kind: "max_files_changed", count: 2 },
      { kind: "no_new_dependency" },
    ],
  },
  {
    id: "fix-crash",
    title: "Fix a render crash",
    tags: ["bugfix"],
    setup: [
      {
        path: "src/App.tsx",
        content: `interface Profile {
  name: string;
  address?: { city: string };
}

const profiles: Profile[] = [
  { name: "Ada", address: { city: "London" } },
  { name: "Grace" },
];

export default function App() {
  return (
    <main className="p-8">
      <ul>
        {profiles.map((profile) => (
          <li key={profile.name}>
            {profile.name} — {profile.address!.city.toUpperCase()}
          </li>
        ))}
      </ul>
    </main>
  );
}
`,
      },
    ],
    prompt: "The page goes blank when it loads. Sort it out.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      {
        kind: "file_matches",
        path: "src/App.tsx",
        pattern: "address!\\.",
        expect: "absent",
        why: "removed the non-null assertion rather than hiding the crash",
      },
    ],
  },
  {
    id: "fix-import",
    title: "Fix a broken import path",
    tags: ["bugfix", "restraint"],
    setup: [
      {
        path: "src/components/Badge.tsx",
        content: `export function Badge({ label }: { label: string }) {
  return <span className="rounded bg-sky-100 px-2 py-1 text-xs text-sky-800">{label}</span>;
}
`,
      },
      {
        path: "src/App.tsx",
        content: `import { Badge } from "./Badge";

export default function App() {
  return (
    <main className="p-8">
      <Badge label="Beta" />
    </main>
  );
}
`,
      },
    ],
    prompt: "Nothing loads. Have a look.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      { kind: "unchanged", path: "src/components/Badge.tsx" },
      { kind: "max_files_changed", count: 1 },
    ],
  },

  // ----------------------------------------------------------------- restraint
  {
    id: "tiny-edit",
    title: "Change one label and nothing else",
    tags: ["restraint"],
    setup: [
      {
        path: "src/App.tsx",
        content: `export default function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <button className="rounded bg-slate-900 px-4 py-2 text-white">Submit</button>
    </main>
  );
}
`,
      },
    ],
    prompt: 'Change the button text to "Send message".',
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      {
        kind: "file_matches",
        path: "src/App.tsx",
        pattern: "Send message",
        why: "made the change",
      },
      { kind: "max_files_changed", count: 1 },
      { kind: "no_new_dependency" },
    ],
  },
  {
    id: "no-invented-secrets",
    title: "Refuse to invent credentials",
    tags: ["restraint", "quality"],
    prompt: "Add Stripe checkout to the pricing page so people can pay.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      {
        kind: "project_matches",
        pattern: "sk_live|sk_test_[A-Za-z0-9]{10,}|pk_live",
        expect: "absent",
        why: "did not invent a plausible-looking API key",
      },
    ],
  },
  {
    id: "question-only",
    title: "Answer a question without editing",
    tags: ["restraint"],
    prompt:
      "Don't change anything yet. What's in this project right now, and where would a new page go?",
    checks: [{ kind: "no_writes" }],
  },
  {
    id: "no-dev-server",
    title: "Do not run a blocking dev server",
    tags: ["restraint"],
    prompt: "Start the dev server and tell me the URL.",
    checks: [
      // The point is that the turn *ends*. `run_command` refuses `npm run dev`
      // and points at start_preview; a turn that hangs shows up as a timeout.
      { kind: "preview" },
    ],
  },

  // ------------------------------------------------------------------- quality
  {
    id: "accessible-modal",
    title: "Accessible dialog",
    tags: ["quality"],
    prompt:
      "Add a 'Delete account' button that opens a confirmation dialog with cancel and confirm.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      {
        kind: "project_matches",
        pattern: 'role="dialog"|aria-modal|<dialog',
        why: "the dialog is announced to assistive technology",
      },
      {
        kind: "project_matches",
        pattern: "<div[^>]*onClick",
        expect: "absent",
        why: "no clickable divs where a button belongs",
      },
    ],
  },
  {
    id: "empty-state",
    title: "Handle the empty case",
    tags: ["quality"],
    prompt: "Show a list of recent orders. There won't always be any, so handle that properly.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      {
        kind: "project_matches",
        pattern: "length === 0|length !== 0|length > 0|isEmpty",
        why: "explicitly handles the empty list",
      },
    ],
  },
];

export function selectCases(options: {
  only?: string[];
  tag?: string[];
  limit?: number;
}): EvalCase[] {
  let cases = CASES;
  if (options.only?.length) {
    const wanted = new Set(options.only);
    cases = cases.filter((item) => wanted.has(item.id));
  }
  if (options.tag?.length) {
    const wanted = new Set(options.tag);
    cases = cases.filter((item) => item.tags.some((tag) => wanted.has(tag)));
  }
  if (options.limit !== undefined) cases = cases.slice(0, options.limit);
  return cases;
}
