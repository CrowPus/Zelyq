---
name: ai-integration
description: Wire a language-model feature (chatbot, extractor, agent, classifier, generator — not chat-specific) into a Zelyq project. Key in Supabase, call in an Edge Function, current SDK confirmed. Use for any task that calls an LLM provider.
---

# AI integration

A Zelyq project is a browser SPA with no server of its own. A model API key cannot
live in the browser. So: the key lives in Supabase, the call runs in a Supabase
Edge Function, and the SDK call shape is confirmed against the *installed*
package — not recalled from memory, which is usually a version behind.

The feature can be anything. "The AI function" below means whatever Edge
Function(s) the design names for the task (`chat`, `extract-invoice`,
`classify-ticket`, `book-flight`, …). The only fixed function is
`save-credential`.

## 1. Get the real call shape

- `use_ai_provider("<slug>")` for the provider's package, client init, the
  non-streaming and streaming call, the key name, and the docs URL.
- `fetch_provider_docs({ provider })` (or `{ url }` on the docs allowlist) to
  pull the current quickstart. If it can't retrieve, or the SDK surface looks
  different from the notes, **ask the user to paste the exact SDK snippet or a
  docs link**, and record it in `architecture/ai.md` (or
  `docs/<provider>-notes.md` with no Architect package).
- Install the package, then read its own `.d.ts` / README. Where the notes and
  the installed package disagree, the installed package wins.

## 2. The credential store

A table `ai_credentials`:

- `user_id uuid` → `auth.users(id) on delete cascade`, `provider text`,
  `secret text`, `created_at`, `updated_at`, `unique (user_id, provider)`.
- `alter table ai_credentials enable row level security;`
- `revoke all on ai_credentials from anon, authenticated;`
- `grant insert, update on ai_credentials to authenticated;`
- Policies: an `insert` and an `update` policy, each
  `using (user_id = auth.uid()) with check (user_id = auth.uid())`.
- **No `select` policy for any client role.** The browser can save a key and
  never read one back. Only an Edge Function reads it, with `service_role`.

If this table is not in the applied schema, add it to `backend.md`, write it
into the migration, `supabase_apply_migration`, then `supabase_verify_backend`.

## 3. The Edge Functions (Deno)

Write under `supabase/functions/<name>/index.ts`. Deploy each with
`supabase_deploy_function({ slug, path })` (`verify_jwt` defaults on). If a
deploy fails, give the user the exact `supabase functions deploy <name>`
command — do not leave it half-wired.

**`save-credential`** (fixed): authenticate the caller; read
`{ provider, key }` from the body; make ONE cheap test call to the provider
with the key (e.g. list models, or a 1-token generation); on failure return a
clear message and DO NOT store; on success `upsert` into `ai_credentials` for
`auth.uid()`. Never echo the key back.

**The AI function(s)** (named for the task): authenticate the caller; load that
user's key from `ai_credentials` with `service_role`; read the provider key
name from `Deno.env` only as a fallback for an instance-wide key, never a
hard-coded literal; call the model with the shape from step 1; stream the
response when the feature benefits; return the provider's errors mapped to
distinct, human messages (rate limit, auth, content filter, timeout).

Never put `sb_secret_*` / `service_role` / a provider key as a literal in any
function file — `supabase_deploy_function` refuses it.

## 4. The client — the Connect screen and the feature state

**Where the Connect form lives: a Settings / account page, not the sidebar and
not the main feature surface.** Add (or extend) a `/settings` route with an
"AI provider" section:

- A real, working form — a password-type input for the key, a Save button, a
  visible success and error state. On submit it POSTs `{ provider, key }` to
  the `save-credential` Edge Function; on success it shows "Connected" (and,
  since the key can never be read back, offers "Replace key" rather than
  showing the value); on failure it shows the provider's rejection message.
  It is not a placeholder, a disabled input, or a link to nowhere.
- After a save, the app knows a key exists by asking a tiny "has-credential"
  endpoint (a `select count(*)` in an Edge Function, or a boolean column the
  browser MAY read) — never by reading the secret.

**The feature surface** (the chat / extractor / whatever):

- Renders fully before a key is set. Trying to use it links to
  `/settings` with a clear "connect your <provider> key in Settings first"
  message — never a crash, never a dead button.
- Once a key exists, it calls the AI Edge Function with the user's Supabase
  session.
- Validate the configured **model id** against the provider's model-list
  endpoint (from `PROVIDER.md`) — a wrong id fails here with the valid list,
  not silently at call time.

## 5. Done means

- **Settings has a working "AI provider" section** — entering a key and
  pressing Save stores it (a row appears in `ai_credentials`) and the section
  then reads "Connected"; a bad key shows the provider's error and stores
  nothing.
- The feature works with the "connect in Settings" placeholder before any key
  is set.
- Both functions are deployed (or the user has the exact deploy command).
- `ai_credentials` has RLS on and no client `select`.
- With a key saved, one real end-to-end model call succeeds in the preview.
- No provider key string in `src/`, `.env`, the bundle, `report.html`, logs,
  a commit message, or any table the browser can read.
