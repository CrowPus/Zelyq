# Attachments

You can attach a file to a prompt from the composer's paperclip control.
What happens to it depends on what it is.

## Images

`image/png`, `image/jpeg`, `image/webp`, `image/gif` go to the model as an
actual image — Anthropic's `image` content block, Gemini's `inlineData`, or
the OpenAI dialect's `image_url` data URI, whichever the active provider
speaks. The model sees the picture itself, not a description of it or its
filename.

## Everything else

Any other file is read as UTF-8 text and folded into the prompt as a
labelled, fenced block — the model reads the real contents, the same as if
you'd pasted them into the message yourself. A file that isn't valid UTF-8
(a binary you attached by mistake, for instance) is refused with a clear
reason instead of being silently mangled into garbled text.

## Limits

- 8MB per file.
- The transcript keeps a lightweight reference to what was attached
  (filename, type, size) — never the bytes themselves — so reloading a
  conversation shows what was sent without duplicating storage.
- An attachment is not replayed as an image again after the agent
  restarts. The reference still shows in the transcript; only the live,
  in-progress round-trip needs the actual bytes back — a resolved past
  turn is reconstructed from what it actually did, not replayed as if it
  were happening again.

## Where the bytes live

Uploaded files are stored at `ZELYQ_ATTACHMENTS_DIR` (default: beside the
database, see [configuration.md](./configuration.md)) — deliberately
**outside** any project's own workspace. Two reasons:

- Zelyq commits a project's files to git automatically as the agent works.
  An uploaded image becoming part of that history by accident isn't this
  feature's call to make.
- An attachment is conversation data, not project data — the same
  distinction that keeps the workspace itself outside Zelyq's own checkout.

The agent never touches this storage directly. The server resolves an
attachment to its actual bytes and hands the result to the agent over the
same call that already carries the prompt — the agent only ever sees what
that call gives it, the same boundary an API key or a custom endpoint
already crosses today.
