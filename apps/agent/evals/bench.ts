import type { ScaffoldFile } from "@zelyq/runtime";
import type { FlowStep } from "@zelyq/tools";
import type { Check, EvalCase } from "./types.js";

/**
 * The benchmark tasks (internal round). Each is graded by hidden flows: steps
 * run against the finished app in a fresh browser, the same way for every
 * tool being compared, so "done" means a person could actually do the thing.
 *
 * Each prompt states its interface contract — the labels, button text and
 * messages the flows look for — so a grader can find things whichever tool
 * built the app. Nothing else about the build is prescribed.
 *
 * Each task carries a reference solution, never shown to the agent. The
 * validator (`bench-validate.ts`) proves the untouched start fails every flow
 * and the reference passes every one, so a score measures the agent and not
 * the task.
 *
 * Do not tune the agent's prompt or tools against these tasks.
 */

export interface BenchCase extends EvalCase {
  /** Files that solve the task. For validating the grader only. */
  reference: ScaffoldFile[];
}

const flow = (name: string, steps: FlowStep[], path?: string): Check => ({
  kind: "flow",
  name,
  steps,
  ...(path ? { path } : {}),
});

/** Every task must leave a working project behind. */
const INTACT: Check[] = [{ kind: "typecheck" }, { kind: "build" }, { kind: "preview" }];

const app = (content: string): ScaffoldFile => ({ path: "src/App.tsx", content });

// ---------------------------------------------------------------------------
// Starting apps for the edit and bug-fix tasks
// ---------------------------------------------------------------------------

const PRODUCTS = `const PRODUCTS: Product[] = [
  { id: 1, name: "Desk Lamp", price: 39 },
  { id: 2, name: "Coffee Mug", price: 12 },
  { id: 3, name: "Notebook", price: 8 },
  { id: 4, name: "Wall Clock", price: 45 },
  { id: 5, name: "Plant Pot", price: 18 },
  { id: 6, name: "Throw Pillow", price: 25 },
];`;

const SHOP = app(`type Product = { id: number; name: string; price: number };

${PRODUCTS}

export default function App() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Shop</h1>
      </header>
      <ul className="divide-y">
        {PRODUCTS.map((product) => (
          <li key={product.id} className="flex justify-between py-2">
            <span>{product.name}</span>
            <span>\${product.price}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
`);

const SETTINGS = app(`export default function App() {
  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <section>
        <h2 className="text-lg font-medium">Profile</h2>
        <p>Your display name: Ada</p>
      </section>
      <section>
        <h2 className="text-lg font-medium">Notifications</h2>
        <p>Email me about new comments</p>
      </section>
      <section>
        <h2 className="text-lg font-medium">Billing</h2>
        <p>Your plan: Free</p>
      </section>
    </main>
  );
}
`);

// ---------------------------------------------------------------------------
// The tasks
// ---------------------------------------------------------------------------

export const BENCH_CASES: BenchCase[] = [
  // --- New builds -----------------------------------------------------------
  {
    id: "b-todo-persist",
    title: "Todo list that survives a reload",
    tags: ["bench", "greenfield"],
    prompt:
      'Build a todo list. Add a todo with a text field labelled "New todo" and a button "Add". ' +
      'Each todo shows its text and a "Delete" button. Todos must still be there after the page ' +
      "is reloaded.",
    checks: [
      ...INTACT,
      flow("add, delete and reload todos", [
        // One todo at a time, so the list's order (newest first or last)
        // never decides which one a Delete removes.
        { action: "fill", target: { label: "New todo" }, value: "Buy milk" },
        { action: "click", target: { role: "button", name: "Add", exact: true } },
        { action: "expect_text", text: "Buy milk" },
        { action: "reload" },
        { action: "expect_text", text: "Buy milk" },
        { action: "click", target: { role: "button", name: "Delete" } },
        { action: "expect_text", text: "Buy milk", absent: true },
        { action: "fill", target: { label: "New todo" }, value: "Walk the dog" },
        { action: "click", target: { role: "button", name: "Add", exact: true } },
        { action: "reload" },
        { action: "expect_text", text: "Walk the dog" },
        { action: "expect_text", text: "Buy milk", absent: true },
      ]),
    ],
    reference: [
      app(`import { useEffect, useState } from "react";

type Todo = { id: number; text: string };

function load(): Todo[] {
  try {
    return JSON.parse(localStorage.getItem("todos") ?? "[]") as Todo[];
  } catch {
    return [];
  }
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>(load);
  const [text, setText] = useState("");
  useEffect(() => localStorage.setItem("todos", JSON.stringify(todos)), [todos]);

  return (
    <main className="mx-auto max-w-md p-8">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          setTodos([...todos, { id: Date.now(), text: text.trim() }]);
          setText("");
        }}
      >
        <label>
          New todo <input value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <button type="submit">Add</button>
      </form>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            {todo.text}{" "}
            <button type="button" onClick={() => setTodos(todos.filter((t) => t.id !== todo.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
`),
    ],
  },
  {
    id: "b-pricing-yearly",
    title: "Pricing with a yearly switch",
    tags: ["bench", "greenfield"],
    prompt:
      "Build a pricing section with three plans: Starter at $9, Pro at $29 and Team at $79 per " +
      'month. A checkbox or switch labelled "Yearly billing" changes every price to the yearly ' +
      "price: Starter $90, Pro $290 and Team $790 per year.",
    checks: [
      ...INTACT,
      flow("switch to yearly prices", [
        { action: "expect_text", text: "Starter" },
        { action: "expect_text", text: "$29" },
        { action: "expect_text", text: "$290", absent: true },
        { action: "click", target: { label: "Yearly billing" } },
        { action: "expect_text", text: "$90" },
        { action: "expect_text", text: "$290" },
        { action: "expect_text", text: "$790" },
      ]),
    ],
    reference: [
      app(`import { useState } from "react";

const PLANS = [
  { name: "Starter", monthly: 9, yearly: 90 },
  { name: "Pro", monthly: 29, yearly: 290 },
  { name: "Team", monthly: 79, yearly: 790 },
];

export default function App() {
  const [yearly, setYearly] = useState(false);
  return (
    <main className="mx-auto max-w-3xl p-8">
      <label>
        <input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} />{" "}
        Yearly billing
      </label>
      <div className="grid grid-cols-3 gap-4">
        {PLANS.map((plan) => (
          <section key={plan.name}>
            <h2>{plan.name}</h2>
            <p>
              \${yearly ? plan.yearly : plan.monthly} per {yearly ? "year" : "month"}
            </p>
          </section>
        ))}
      </div>
    </main>
  );
}
`),
    ],
  },
  {
    id: "b-contact-validation",
    title: "Contact form with validation",
    tags: ["bench", "greenfield"],
    prompt:
      'Build a contact form with fields labelled "Name", "Email" and "Message" and a "Send" ' +
      "button. Show messages on the page, not the browser's own pop-ups: sending with an empty " +
      'email shows "Email is required"; an email without an @ shows "Enter a valid email"; a ' +
      'valid form shows "Thanks, we\'ll be in touch".',
    checks: [
      ...INTACT,
      flow("validate and send the form", [
        { action: "fill", target: { label: "Name" }, value: "Ada" },
        { action: "click", target: { role: "button", name: "Send" } },
        { action: "expect_text", text: "Email is required" },
        { action: "fill", target: { label: "Email" }, value: "ada.example.com" },
        { action: "click", target: { role: "button", name: "Send" } },
        { action: "expect_text", text: "Enter a valid email" },
        { action: "fill", target: { label: "Email" }, value: "ada@example.com" },
        { action: "fill", target: { label: "Message" }, value: "Hello there" },
        { action: "click", target: { role: "button", name: "Send" } },
        { action: "expect_text", text: "Thanks, we'll be in touch" },
      ]),
    ],
    reference: [
      app(`import { useState } from "react";

export default function App() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  if (sent) return <p>Thanks, we'll be in touch</p>;
  return (
    <form
      noValidate
      className="mx-auto max-w-md space-y-2 p-8"
      onSubmit={(event) => {
        event.preventDefault();
        if (!email.trim()) setError("Email is required");
        else if (!email.includes("@")) setError("Enter a valid email");
        else setSent(true);
      }}
    >
      <label className="block">
        Name <input name="name" />
      </label>
      <label className="block">
        Email <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block">
        Message <textarea name="message" />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Send</button>
    </form>
  );
}
`),
    ],
  },
  {
    id: "b-km-to-miles",
    title: "Kilometres to miles",
    tags: ["bench", "greenfield"],
    prompt:
      'Build a kilometres to miles converter: a number field labelled "Kilometres", and the ' +
      'result shown as text with two decimals, such as "6.21 miles", updating as you type.',
    checks: [
      ...INTACT,
      flow("convert as you type", [
        { action: "fill", target: { label: "Kilometres" }, value: "10" },
        { action: "expect_text", text: "6.21 miles" },
        { action: "fill", target: { label: "Kilometres" }, value: "42.195" },
        { action: "expect_text", text: "26.22 miles" },
      ]),
    ],
    reference: [
      app(`import { useState } from "react";

export default function App() {
  const [km, setKm] = useState("");
  const miles = Number(km) * 0.621371;
  return (
    <main className="mx-auto max-w-md p-8">
      <label>
        Kilometres <input type="number" value={km} onChange={(e) => setKm(e.target.value)} />
      </label>
      <p>{km === "" ? "" : \`\${miles.toFixed(2)} miles\`}</p>
    </main>
  );
}
`),
    ],
  },

  // --- Edits to an existing app ---------------------------------------------
  {
    id: "b-shop-search",
    title: "Search an existing product list",
    tags: ["bench", "modify"],
    setup: [SHOP],
    prompt:
      'Add a search box labelled "Search products" above the product list that filters the list ' +
      'as you type, ignoring upper and lower case. When nothing matches, show "No products match".',
    checks: [
      ...INTACT,
      flow("filter the list", [
        { action: "expect_text", text: "Coffee Mug" },
        { action: "fill", target: { label: "Search products" }, value: "lamp" },
        { action: "expect_text", text: "Desk Lamp" },
        { action: "expect_text", text: "Coffee Mug", absent: true },
        { action: "fill", target: { label: "Search products" }, value: "zzz" },
        { action: "expect_text", text: "No products match" },
      ]),
    ],
    reference: [
      app(`import { useState } from "react";

type Product = { id: number; name: string; price: number };

${PRODUCTS}

export default function App() {
  const [query, setQuery] = useState("");
  const shown = PRODUCTS.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Shop</h1>
      <label>
        Search products <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {shown.length === 0 && <p>No products match</p>}
      <ul>
        {shown.map((product) => (
          <li key={product.id}>
            {product.name} \${product.price}
          </li>
        ))}
      </ul>
    </main>
  );
}
`),
    ],
  },
  {
    id: "b-shop-cart",
    title: "Add a cart to an existing shop",
    tags: ["bench", "modify"],
    setup: [SHOP],
    prompt:
      'Add a cart. Each product gets an "Add to cart" button, and the page header shows ' +
      '"Cart (N)" with the number of items added.',
    checks: [
      ...INTACT,
      flow("add products to the cart", [
        { action: "expect_text", text: "Cart (0)" },
        { action: "click", target: { role: "button", name: "Add to cart", nth: 0 } },
        { action: "expect_text", text: "Cart (1)" },
        { action: "click", target: { role: "button", name: "Add to cart", nth: 2 } },
        { action: "expect_text", text: "Cart (2)" },
      ]),
    ],
    reference: [
      app(`import { useState } from "react";

type Product = { id: number; name: string; price: number };

${PRODUCTS}

export default function App() {
  const [cart, setCart] = useState<number[]>([]);
  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="flex justify-between">
        <h1 className="text-2xl font-semibold">Shop</h1>
        <span>Cart ({cart.length})</span>
      </header>
      <ul>
        {PRODUCTS.map((product) => (
          <li key={product.id}>
            {product.name} \${product.price}{" "}
            <button type="button" onClick={() => setCart([...cart, product.id])}>
              Add to cart
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
`),
    ],
  },
  {
    id: "b-shop-add-product",
    title: "Add products to an existing list",
    tags: ["bench", "modify"],
    setup: [SHOP],
    prompt:
      'Add a form for adding a product: fields labelled "Product name" and "Price", and an ' +
      '"Add product" button. The new product appears in the list with its price.',
    checks: [
      ...INTACT,
      flow("add a product", [
        { action: "fill", target: { label: "Product name" }, value: "Desk Fan" },
        { action: "fill", target: { label: "Price" }, value: "31" },
        { action: "click", target: { role: "button", name: "Add product" } },
        { action: "expect_text", text: "Desk Fan" },
        { action: "expect_text", text: "$31" },
        { action: "expect_text", text: "Coffee Mug" },
      ]),
    ],
    reference: [
      app(`import { useState } from "react";

type Product = { id: number; name: string; price: number };

${PRODUCTS}

export default function App() {
  const [products, setProducts] = useState(PRODUCTS);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Shop</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setProducts([...products, { id: Date.now(), name, price: Number(price) }]);
          setName("");
          setPrice("");
        }}
      >
        <label>
          Product name <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Price <input value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <button type="submit">Add product</button>
      </form>
      <ul>
        {products.map((product) => (
          <li key={product.id}>
            {product.name} \${product.price}
          </li>
        ))}
      </ul>
    </main>
  );
}
`),
    ],
  },
  {
    id: "b-settings-tabs",
    title: "Turn sections into tabs",
    tags: ["bench", "modify"],
    setup: [SETTINGS],
    prompt:
      "Turn the three settings sections into tabs named Profile, Notifications and Billing, " +
      'with proper tab semantics (role "tab"). Only the selected tab\'s section is shown; ' +
      "Profile is selected first.",
    checks: [
      ...INTACT,
      flow("switch tabs", [
        { action: "expect_text", text: "Your display name" },
        { action: "expect_text", text: "Your plan: Free", absent: true },
        { action: "click", target: { role: "tab", name: "Billing" } },
        { action: "expect_text", text: "Your plan: Free" },
        { action: "expect_text", text: "Your display name", absent: true },
      ]),
    ],
    reference: [
      app(`import { useState } from "react";

const TABS = [
  { name: "Profile", body: "Your display name: Ada" },
  { name: "Notifications", body: "Email me about new comments" },
  { name: "Billing", body: "Your plan: Free" },
];

export default function App() {
  const [active, setActive] = useState(0);
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div role="tablist">
        {TABS.map((tab, i) => (
          <button
            key={tab.name}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
          >
            {tab.name}
          </button>
        ))}
      </div>
      <section role="tabpanel">
        <p>{TABS[active]?.body}</p>
      </section>
    </main>
  );
}
`),
    ],
  },

  // --- Planted bugs -----------------------------------------------------------
  {
    id: "b-bug-cart-total",
    title: "Fix a wrong cart total",
    tags: ["bench", "bugfix"],
    setup: [
      app(`import { useState } from "react";

type Item = { name: string; price: string };

const ITEMS: Item[] = [
  { name: "Mug", price: "10.00" },
  { name: "Pen", price: "5.00" },
];

export default function App() {
  const [cart, setCart] = useState<Item[]>([]);
  const total = cart.reduce((sum, item) => sum + item.price, "");
  return (
    <main className="mx-auto max-w-md p-8">
      {ITEMS.map((item) => (
        <p key={item.name}>
          {item.name} \${item.price}{" "}
          <button type="button" onClick={() => setCart([...cart, item])}>
            Add to cart
          </button>
        </p>
      ))}
      <p>Total: \${total || "0.00"}</p>
    </main>
  );
}
`),
    ],
    prompt:
      "The cart total is wrong once there are two items in the cart. Fix it, keeping the " +
      '"Total: $15.00" format, so a $10 and a $5 item show Total: $15.00.',
    checks: [
      ...INTACT,
      flow("a two-item total", [
        { action: "click", target: { role: "button", name: "Add to cart", nth: 0 } },
        { action: "expect_text", text: "Total: $10.00" },
        { action: "click", target: { role: "button", name: "Add to cart", nth: 1 } },
        { action: "expect_text", text: "Total: $15.00" },
      ]),
    ],
    reference: [
      app(`import { useState } from "react";

type Item = { name: string; price: string };

const ITEMS: Item[] = [
  { name: "Mug", price: "10.00" },
  { name: "Pen", price: "5.00" },
];

export default function App() {
  const [cart, setCart] = useState<Item[]>([]);
  const total = cart.reduce((sum, item) => sum + Number(item.price), 0);
  return (
    <main className="mx-auto max-w-md p-8">
      {ITEMS.map((item) => (
        <p key={item.name}>
          {item.name} \${item.price}{" "}
          <button type="button" onClick={() => setCart([...cart, item])}>
            Add to cart
          </button>
        </p>
      ))}
      <p>Total: \${total.toFixed(2)}</p>
    </main>
  );
}
`),
    ],
  },
  {
    id: "b-bug-delete-wrong",
    title: "Fix deleting the wrong note",
    tags: ["bench", "bugfix"],
    setup: [
      app(`import { useState } from "react";

export default function App() {
  const [notes, setNotes] = useState(["Alpha", "Beta", "Gamma"]);
  return (
    <main className="mx-auto max-w-md p-8">
      <ul>
        {notes.map((note, index) => (
          <li key={note}>
            {note}{" "}
            <button type="button" onClick={() => setNotes(notes.filter((_, i) => i !== index + 1))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
`),
    ],
    prompt: "Deleting a note removes a different note from the one I clicked. Fix it.",
    checks: [
      ...INTACT,
      flow("delete the note clicked", [
        { action: "click", target: { role: "button", name: "Delete", nth: 0 } },
        { action: "expect_text", text: "Alpha", absent: true },
        { action: "expect_text", text: "Beta" },
        { action: "expect_text", text: "Gamma" },
      ]),
    ],
    reference: [
      app(`import { useState } from "react";

export default function App() {
  const [notes, setNotes] = useState(["Alpha", "Beta", "Gamma"]);
  return (
    <main className="mx-auto max-w-md p-8">
      <ul>
        {notes.map((note, index) => (
          <li key={note}>
            {note}{" "}
            <button type="button" onClick={() => setNotes(notes.filter((_, i) => i !== index))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
`),
    ],
  },
  {
    id: "b-bug-blank-when-empty",
    title: "Fix a blank page after the last delete",
    tags: ["bench", "bugfix"],
    setup: [
      app(`import { useState } from "react";

type Note = { id: number; title: string };

export default function App() {
  const [notes, setNotes] = useState<Note[]>([{ id: 1, title: "Groceries" }]);
  const latest = notes[notes.length - 1] as Note;
  return (
    <main className="mx-auto max-w-md p-8">
      <p>Latest: {latest.title}</p>
      <ul>
        {notes.map((note) => (
          <li key={note.id}>
            {note.title}{" "}
            <button type="button" onClick={() => setNotes(notes.filter((n) => n.id !== note.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
`),
    ],
    prompt:
      'After I delete the last note the page goes blank. Fix it: with no notes, show "No notes yet".',
    checks: [
      ...INTACT,
      flow("delete the last note", [
        { action: "expect_text", text: "Groceries" },
        { action: "click", target: { role: "button", name: "Delete" } },
        { action: "expect_text", text: "No notes yet" },
      ]),
    ],
    reference: [
      app(`import { useState } from "react";

type Note = { id: number; title: string };

export default function App() {
  const [notes, setNotes] = useState<Note[]>([{ id: 1, title: "Groceries" }]);
  const latest = notes[notes.length - 1];
  return (
    <main className="mx-auto max-w-md p-8">
      {latest ? <p>Latest: {latest.title}</p> : <p>No notes yet</p>}
      <ul>
        {notes.map((note) => (
          <li key={note.id}>
            {note.title}{" "}
            <button type="button" onClick={() => setNotes(notes.filter((n) => n.id !== note.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
`),
    ],
  },
  {
    id: "b-bug-search-case",
    title: "Fix a case-sensitive search",
    tags: ["bench", "bugfix"],
    setup: [
      app(`import { useState } from "react";

type Product = { id: number; name: string; price: number };

${PRODUCTS}

export default function App() {
  const [query, setQuery] = useState("");
  const shown = PRODUCTS.filter((p) => p.name.includes(query));
  return (
    <main className="mx-auto max-w-2xl p-8">
      <label>
        Search products <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <ul>
        {shown.map((product) => (
          <li key={product.id}>
            {product.name} \${product.price}
          </li>
        ))}
      </ul>
    </main>
  );
}
`),
    ],
    prompt:
      "Search only finds a product if I type its capital letters exactly. Make it ignore upper " +
      "and lower case.",
    checks: [
      ...INTACT,
      flow("search in any case", [
        { action: "fill", target: { label: "Search products" }, value: "lamp" },
        { action: "expect_text", text: "Desk Lamp" },
        { action: "expect_text", text: "Coffee Mug", absent: true },
        { action: "fill", target: { label: "Search products" }, value: "COFFEE" },
        { action: "expect_text", text: "Coffee Mug" },
      ]),
    ],
    reference: [
      app(`import { useState } from "react";

type Product = { id: number; name: string; price: number };

${PRODUCTS}

export default function App() {
  const [query, setQuery] = useState("");
  const shown = PRODUCTS.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <main className="mx-auto max-w-2xl p-8">
      <label>
        Search products <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <ul>
        {shown.map((product) => (
          <li key={product.id}>
            {product.name} \${product.price}
          </li>
        ))}
      </ul>
    </main>
  );
}
`),
    ],
  },
];
