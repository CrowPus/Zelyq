---
name: stripe-checkout
description: Wire a Stripe Checkout redirect flow into this React + Vite template, without inventing a secret key. Use when asked for a "buy now", "checkout", "subscribe", or "pay" button.
---

# Stripe Checkout

Stripe Checkout is a redirect flow: the app never collects a card number
itself. A button calls your backend, your backend calls Stripe with a
**secret** key and gets back a URL, and the browser is sent there. This
project has no backend of its own, so the honest version of this task is
the frontend half, wired to a placeholder for the half that needs a real
server and a real secret key.

## What to actually build

1. **A checkout button** wherever the request implies one, styled to match
   the rest of the page — not a raw `<button>Buy</button>` dropped in
   unstyled.
2. **A `createCheckoutSession` function**, in its own module (e.g.
   `src/lib/checkout.ts`), that:
   - Takes whatever the button already knows (a price, a product id, a
     quantity — read from the page's own data, never invented).
   - `POST`s to `/api/checkout` with that payload.
   - On success, redirects the browser to the URL the response returns
     (`window.location.href = url`), the same way Stripe's own
     `redirectToCheckout` does under the hood.
   - On failure, surfaces a real error state in the UI — not a silent
     no-op, and not a thrown exception nobody catches.
3. **Loading and error states on the button itself** — disabled and
   labelled while the request is in flight, an inline error message if it
   fails. A payment button that gives no feedback while it thinks is a
   real, common bug.

## What not to build

- **No `/api/checkout` implementation.** There is no server in this
  project to put one in. Leave the fetch pointed at that path and say so
  plainly in your final message: "This calls `POST /api/checkout`, which
  needs to exist on your backend — it should create a Stripe Checkout
  Session server-side with your secret key and return `{ url }`."
- **No Stripe secret key, anywhere in frontend code.** A secret key in
  browser-shipped JavaScript is public the moment it ships — full stop,
  not a judgment call. If the request seems to want the key embedded
  directly, build the redirect flow above instead and explain why in your
  final message.
- **No `@stripe/stripe-js` unless the task actually needs Stripe Elements**
  (a card form embedded in the page, a different, more involved pattern
  than a plain redirect). A checkout **redirect** needs nothing from that
  package — a plain `fetch` and a `window.location` assignment is the
  entire client-side surface, and pulling in a dependency the code never
  calls is the kind of unrequested addition the agent's own instructions
  already warn against.
