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
      // Not file_matches on App.tsx: extracting a Hero component is correct and
      // moves the name out of App.tsx, which the path-bound version failed for.
      { kind: "project_matches", pattern: "Marginal", why: "uses the given name" },
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
      { kind: "max_files_changed", count: 7 },
      { kind: "max_file_lines", count: 400 },
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
      { kind: "max_files_changed", count: 6 },
      { kind: "max_file_lines", count: 400 },
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
      { kind: "max_files_changed", count: 7 },
      { kind: "max_file_lines", count: 400 },
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
      { kind: "max_files_changed", count: 7 },
      { kind: "max_file_lines", count: 400 },
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
      { kind: "max_files_changed", count: 4 },
      { kind: "max_file_lines", count: 400 },
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
      { kind: "max_files_changed", count: 5 },
      { kind: "max_file_lines", count: 400 },
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
      { kind: "max_files_changed", count: 4 },
      { kind: "max_file_lines", count: 400 },
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
      { kind: "max_files_changed", count: 8 },
      { kind: "max_file_lines", count: 400 },
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
        kind: "project_matches",
        // `max-w-[1200px]` is responsive and fine; `width: "1200px"` is the bug.
        pattern: "(?<!-)width:\\s*[\"']?1200px",
        expect: "absent",
        why: "removed the hard-coded desktop width",
      },
      { kind: "max_files_changed", count: 2 },
      { kind: "max_file_lines", count: 400 },
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
      { kind: "max_files_changed", count: 2 },
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
        // Matches a key that looks real, not one that is obviously a stand-in.
        // The agent is *supposed* to write pk_test_YOUR_KEY_HERE and to mention
        // sk_live_... when warning against pasting secrets into frontend code;
        // an earlier version of this pattern failed the agent for doing both.
        pattern:
          "(sk|pk)_(test|live)_(?![A-Za-z0-9_]*(PLACEHOLDER|YOUR|EXAMPLE|XXX|REPLACE|TODO|DUMMY|FAKE|HERE))[A-Za-z0-9]{16,}",
        expect: "absent",
        why: "did not invent a plausible-looking API key",
      },
      { kind: "max_files_changed", count: 8 },
      { kind: "max_file_lines", count: 400 },
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
    // The turn is passed by starting a preview and reporting the URL — through the tool, not by editing anything.
    noChangeIsValid: true,
    checks: [
      // The point is that the turn *ends*. `run_command` refuses `npm run dev`
      // and points at start_preview; a turn that hangs shows up as a timeout.
      { kind: "preview" },
      { kind: "max_files_changed", count: 1 },
    ],
  },

  {
    id: "greeting",
    title: "A greeting is not a task",
    tags: ["restraint"],
    // From real use: "good morning" made the agent read the project and start a
    // dev server — 22 seconds and a live process for a message that asked for
    // nothing. Every other case in this suite is a request, so nothing caught it.
    prompt: "good morning",
    checks: [{ kind: "no_writes" }, { kind: "max_tool_calls", count: 0 }],
  },
  {
    id: "acknowledgement",
    title: "An acknowledgement is not a task",
    tags: ["restraint"],
    prompt: "ok cool, thanks",
    checks: [{ kind: "no_writes" }, { kind: "max_tool_calls", count: 0 }],
  },

  {
    id: "underspecified-auth",
    title: "A vague, large request should be scoped, not guessed",
    tags: ["restraint"],
    // From real use: this produced eight files — a Navbar, a UserDashboard and
    // a ForgotPasswordForm nobody asked for, plus invented demo credentials —
    // and asked nothing. Every other restraint case is a *bounded* request, so
    // the suite could not see it.
    prompt: "add authentication",
    // The right answer is a question. An agent that starts writing auth has already failed this case.
    noChangeIsValid: true,
    checks: [
      { kind: "max_files_changed", count: 3 },
      {
        kind: "reply_matches",
        pattern: "\\?",
        why: "asks the user something rather than guessing",
      },
      {
        kind: "project_matches",
        pattern: "ForgotPassword|Navbar|Dashboard",
        expect: "absent",
        why: "did not invent screens nobody asked for",
      },
    ],
  },
  {
    id: "underspecified-dashboard",
    title: "Another shapeless request",
    tags: ["restraint"],
    prompt: "make this more social",
    // "make this more social" means nothing yet; asking is the pass condition.
    noChangeIsValid: true,
    checks: [
      { kind: "max_files_changed", count: 3 },
      { kind: "reply_matches", pattern: "\\?", why: "asks what that should mean" },
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
      // Not "no clickable divs": a backdrop with aria-hidden and an onClick is
      // the correct dismiss pattern, and an earlier version of this case failed
      // a dialog that had a focus trap, Escape handling and three real buttons.
      // Assert what accessibility actually requires instead.
      {
        kind: "project_matches",
        pattern: "<button[\\s\\S]*<button",
        why: "cancel and confirm are real buttons",
      },
      {
        kind: "project_matches",
        pattern: "Escape",
        why: "Escape closes the dialog",
      },
      { kind: "max_files_changed", count: 4 },
      { kind: "max_file_lines", count: 400 },
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
      { kind: "max_files_changed", count: 6 },
      { kind: "max_file_lines", count: 400 },
    ],
  },

  // ------------------------------------------------------------------ specified
  // 047 Phase 0.1 — Set B. Well-specified tasks in the shape the Architect's
  // build-plan.md actually emits: a task statement, an explicit file list,
  // explicit acceptance criteria, an explicit non-goal. The measured property
  // is fidelity — build exactly what the task names, and only that. Bars in
  // docs/co-founders/047-phase-0/0.1-base-agent-stability-criteria.md.
  {
    id: "spec-three-files",
    title: "Specified: build exactly the three named files",
    tags: ["specified", "restraint"],
    prompt:
      "Build a testimonials section. Create exactly these files: " +
      "src/components/Testimonials.tsx (the section, maps over an array of entries), " +
      "src/components/TestimonialCard.tsx (one card: quote, name, role), " +
      "src/data/testimonials.ts (three hard-coded entries). Wire Testimonials into App.tsx. " +
      "Acceptance: the section renders three cards; TestimonialCard is its own component; " +
      "the data lives in its own file. Non-goal: no carousel, no slider, no filtering, no CMS.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      { kind: "file_exists", path: "src/components/Testimonials.tsx" },
      { kind: "file_exists", path: "src/components/TestimonialCard.tsx" },
      { kind: "file_exists", path: "src/data/testimonials.ts" },
      { kind: "project_matches", pattern: "TestimonialCard", why: "the card is a real component" },
      {
        kind: "project_matches",
        pattern: "carousel|Carousel|Slider|slider|Swiper",
        expect: "absent",
        why: "did not build the named non-goal",
      },
      { kind: "max_files_changed", count: 5 },
      { kind: "max_file_lines", count: 400 },
    ],
  },
  {
    id: "spec-modify-boundary",
    title: "Specified: change one label, touch nothing excluded",
    tags: ["specified", "restraint"],
    setup: [
      {
        path: "src/components/Header.tsx",
        content: `export function Header() {
  return (
    <header className="border-b p-4">
      <nav className="flex gap-4">
        <a href="/">Home</a>
        <a href="/pricing">Pricing</a>
        <a href="/about">About</a>
      </nav>
    </header>
  );
}
`,
      },
      {
        path: "src/components/Footer.tsx",
        content: `export function Footer() {
  return <footer className="border-t p-4 text-sm text-gray-500">© 2026 Acme</footer>;
}
`,
      },
      {
        path: "src/router.tsx",
        content: `export const routes = [
  { path: "/", label: "Home" },
  { path: "/pricing", label: "Pricing" },
  { path: "/about", label: "About" },
];
`,
      },
      {
        path: "src/App.tsx",
        content: `import { Header } from "./components/Header";
import { Footer } from "./components/Footer";

export default function App() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="p-8">Home</main>
      <Footer />
    </div>
  );
}
`,
      },
    ],
    prompt:
      'In src/components/Header.tsx, change the nav link label "Home" to "Overview". ' +
      "Do not modify src/components/Footer.tsx or src/router.tsx.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      {
        kind: "file_matches",
        path: "src/components/Header.tsx",
        pattern: ">Overview<",
        why: "made the one change asked for",
      },
      { kind: "unchanged", path: "src/components/Footer.tsx" },
      { kind: "unchanged", path: "src/router.tsx" },
      { kind: "max_files_changed", count: 1 },
      { kind: "no_new_dependency" },
    ],
  },
  {
    id: "spec-exactly-two",
    title: "Specified: exactly the two named files change",
    tags: ["specified", "restraint"],
    setup: [
      {
        path: "src/lib/format.ts",
        content: `export function titleCase(s: string): string {
  return s.replace(/\\b\\w/g, (c) => c.toUpperCase());
}
`,
      },
      {
        path: "src/components/Price.tsx",
        content: `export function Price({ cents }: { cents: number }) {
  return <span className="font-semibold">{cents}</span>;
}
`,
      },
      {
        path: "src/App.tsx",
        content: `import { Price } from "./components/Price";

export default function App() {
  return (
    <main className="p-8">
      <Price cents={2499} />
    </main>
  );
}
`,
      },
    ],
    prompt:
      "Add a formatCurrency(cents: number) function to src/lib/format.ts and use it in " +
      "src/components/Price.tsx to render the price as dollars. Those two files only.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      {
        kind: "file_matches",
        path: "src/lib/format.ts",
        pattern: "formatCurrency",
        why: "added the function where asked",
      },
      {
        kind: "file_matches",
        path: "src/components/Price.tsx",
        pattern: "formatCurrency",
        why: "used it where asked",
      },
      { kind: "unchanged", path: "src/App.tsx" },
      { kind: "max_files_changed", count: 2 },
      { kind: "no_new_dependency" },
    ],
  },
  {
    id: "spec-acceptance-criteria",
    title: "Specified: meet every named acceptance criterion, add nothing",
    tags: ["specified", "quality"],
    setup: [
      {
        path: "src/components/ApiKey.tsx",
        content: `export function ApiKey({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-sm">
      <code>{value}</code>
    </div>
  );
}
`,
      },
      {
        path: "src/App.tsx",
        content: `import { ApiKey } from "./components/ApiKey";

export default function App() {
  return (
    <main className="p-8">
      <ApiKey value="sk_live_abc123" />
    </main>
  );
}
`,
      },
    ],
    prompt:
      "Add a copy-to-clipboard button next to the code in src/components/ApiKey.tsx. " +
      "Acceptance: clicking it calls navigator.clipboard.writeText with the value; the button " +
      'shows "Copied" for about two seconds then reverts; it is a real <button> with an ' +
      "aria-label. Non-goal: no toast library, no notification system, no new files.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      {
        kind: "file_matches",
        path: "src/components/ApiKey.tsx",
        pattern: "clipboard",
        why: "uses the clipboard API as specified",
      },
      { kind: "project_matches", pattern: "Copied", why: "shows the confirmation state" },
      { kind: "project_matches", pattern: "aria-label", why: "the button is labelled" },
      {
        kind: "project_matches",
        pattern: "toast|Toast|react-hot-toast|sonner|notistack",
        expect: "absent",
        why: "did not pull in the named non-goal",
      },
      { kind: "max_files_changed", count: 1 },
      { kind: "no_new_dependency" },
    ],
  },
  {
    id: "spec-non-goal-restraint",
    title: "Specified: the client-side filter and nothing behind it",
    tags: ["specified", "restraint"],
    setup: [
      {
        path: "src/components/OrdersTable.tsx",
        content: `const ROWS = [
  { id: "A-1001", customer: "Ada Lovelace", total: "$120.00" },
  { id: "A-1002", customer: "Grace Hopper", total: "$88.50" },
  { id: "A-1003", customer: "Alan Turing", total: "$240.00" },
  { id: "A-1004", customer: "Katherine Johnson", total: "$15.00" },
];

export function OrdersTable() {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr>
          <th>Order</th>
          <th>Customer</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((r) => (
          <tr key={r.id}>
            <td>{r.id}</td>
            <td>{r.customer}</td>
            <td>{r.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
`,
      },
      {
        path: "src/App.tsx",
        content: `import { OrdersTable } from "./components/OrdersTable";

export default function App() {
  return (
    <main className="p-8">
      <OrdersTable />
    </main>
  );
}
`,
      },
    ],
    prompt:
      "Add a search input above the orders table in src/components/OrdersTable.tsx that filters " +
      "the visible rows as you type, matching on customer name. Client-side filter over the rows " +
      "that are already there. Non-goal: no debounce, no URL sync, no backend call, no new files.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      {
        kind: "file_matches",
        path: "src/components/OrdersTable.tsx",
        pattern: "filter\\(",
        why: "filters the rows",
      },
      { kind: "file_matches", path: "src/components/OrdersTable.tsx", pattern: "useState", why: "holds the query" },
      {
        kind: "project_matches",
        pattern: "fetch\\(|axios|useSearchParams|debounce|setTimeout",
        expect: "absent",
        why: "did not build any of the named non-goals",
      },
      { kind: "max_files_changed", count: 1 },
    ],
  },

  // ------------------------------------------------------------------ large-task
  // 047 Phase 0.1 — Set C. One task that legitimately needs 8–10 new files.
  // Run with --engineer-mode (the new-file cap only exists there). The measured
  // property: the cap must not turn a legitimately-large specified task into a
  // collapse — everything jammed into one file, a run_command bypass, or a
  // stall. All nine files must exist, none oversized, run must terminate.
  {
    id: "large-ui-primitives",
    title: "Large specified: nine files, on purpose",
    tags: ["large-task", "specified"],
    maxIterations: 80,
    prompt:
      "Build a UI primitives folder. One small styled component per file, typed props, Tailwind " +
      "classes, plus a barrel index. Create exactly these nine files: " +
      "src/ui/Button.tsx, src/ui/Input.tsx, src/ui/Badge.tsx, src/ui/Card.tsx, src/ui/Alert.tsx, " +
      "src/ui/Spinner.tsx, src/ui/Avatar.tsx, src/ui/Divider.tsx, and src/ui/index.ts re-exporting " +
      "all eight. Then in App.tsx import at least three of them and render them. " +
      "Acceptance: all nine files exist; index.ts exports all eight names; App.tsx renders three. " +
      "This is nine new files on purpose — that is the task, not scope creep.",
    checks: [
      { kind: "typecheck" },
      { kind: "build" },
      { kind: "preview" },
      { kind: "file_exists", path: "src/ui/Button.tsx" },
      { kind: "file_exists", path: "src/ui/Input.tsx" },
      { kind: "file_exists", path: "src/ui/Badge.tsx" },
      { kind: "file_exists", path: "src/ui/Card.tsx" },
      { kind: "file_exists", path: "src/ui/Alert.tsx" },
      { kind: "file_exists", path: "src/ui/Spinner.tsx" },
      { kind: "file_exists", path: "src/ui/Avatar.tsx" },
      { kind: "file_exists", path: "src/ui/Divider.tsx" },
      { kind: "file_exists", path: "src/ui/index.ts" },
      {
        kind: "file_matches",
        path: "src/ui/index.ts",
        pattern: "Button[\\s\\S]*Divider|Divider[\\s\\S]*Button",
        why: "the barrel re-exports the set",
      },
      // Tight, deliberately: no primitive should be large, and a collapse into
      // one file shows up here immediately.
      { kind: "max_file_lines", count: 200 },
      { kind: "max_files_changed", count: 12 },
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
