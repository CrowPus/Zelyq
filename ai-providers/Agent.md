# AI provider integration — the rules

Wiring a model into a Zelyq project (a browser SPA with no server of its own).
The AI feature can be anything — an assistant, an invoice extractor, a booking
agent, a classifier, a copy generator. None of this is chat-specific; "the AI
function" below means whatever Edge Function(s) the design names for the task.
These are MUST / SHOULD / NEVER. The verifier and the Architect's DoD check the
observable ones.

## MUST

- **The provider key lives in Supabase, never in the browser.** It is stored in
  the `ai_credentials` table (RLS on; the browser role has no `select`) and
  read only by an Edge Function using `service_role`. No `VITE_` key, no key in
  `.env`, no key in `src/`, the bundle, `.env.example`, `report.html`, logs, or
  any commit.
- **Every model call goes through an Edge Function**
  (`supabase/functions/<name-the-design-chose>`), never from the browser. The
  function authenticates the caller, loads that user's key, calls the provider,
  and returns / streams the result. Its request and response shape are whatever
  the feature needs — a message and a reply, a document and a summary, a record
  and a label. There may be more than one.
- **A real Connect screen, in Settings.** The "connect your <provider> key"
  form lives on a Settings / account page — NOT the sidebar, NOT the main
  feature surface. It is a working form (key input, Save, success + error
  states), not a placeholder or a dead link. It POSTs to `save-credential`;
  on success it shows "Connected" and offers "Replace key" (the value is never
  read back). Before a key is saved, the feature surface still renders every
  control and points the user to Settings — never a crash, never a dead button.
- **Save the key through the `save-credential` function** (this one IS fixed —
  same for every feature). It makes one cheap test call to the provider first;
  a rejected key is reported to the user immediately and not stored. On
  success the Connect screen reads "Connected" and the feature unlocks.
- **Validate the model id.** Confirm the configured model against the
  provider's model-list endpoint before the AI feature is declared done. An
  unknown id fails, with the valid list.
- **Handle the provider's error shape.** Rate limits, auth failures, content
  filters, and timeouts each get a distinct, human message in the UI.
- **Confirm the SDK call against the installed package.** The `PROVIDER.md`
  notes are pinned to a date; the installed package's types / README are the
  source of truth when they disagree.

## SHOULD

- Stream the response when the feature benefits and the provider supports it —
  a long generation that shows nothing until it finishes reads as broken.
- When the feature is conversational, keep a per-conversation history and send
  it as context; cap it so a long thread does not blow the context window or
  the cost. (Not every AI feature has a conversation.)
- Show a token / cost hint if the provider returns usage.
- Put the prompt / instructions the feature sends the model in one named place
  in the code, not scattered or duplicated per call site.

## NEVER

- Never call the provider directly from client code "just for the prototype".
- Never log or echo the key, not even the last few characters, unless the
  provider's own dashboard format is already partially masked.
- Never hard-code a model id the user did not choose.
- Never invent an endpoint, a header, or a request field — fetch the docs or
  ask the user for the snippet.
