# Plugins

A plugin adds tools the agent can call — the same kind of thing
[read_file](../packages/tools/src/files.ts) or `run_command` already are, just written by
you instead of shipped in the box.

## The trust model, stated plainly

Every tool — built-in or not — gets exactly the same access: the full
`RuntimeDriver` for whatever project the agent is working on, and nothing
else. There is no ambient filesystem, network, or database reach beyond
that. A plugin does not receive a *smaller* sandbox than a built-in tool,
and it does not receive a *larger* one either — it receives the same one.

Which means a plugin is not a new privilege level to reason about. It is
code the Zelyq maintainers did not write, running at the level code the
Zelyq maintainers *did* write already runs at. The question a plugin
raises is supply-chain trust, not privilege escalation, and the answer is:

**a plugin is exactly as trusted as whoever can already configure and
restart this instance — never less.**

That is why loading one requires filesystem access to the machine Zelyq
runs on and a restart, and nothing less than that. It is deliberately not
reachable from the Settings screen, deliberately not something a project's
own repository can supply, and deliberately not fetched from anywhere over
the network. Each of those would move plugin-loading to a lower trust
level than the one above — an instance admin picking a provider from a
dropdown is not the same act as an instance admin loading arbitrary code,
and a project a teammate cloned should never get to choose what tools the
agent that reads it is handed.

## Writing one

Set `ZELYQ_PLUGIN_DIR` to a local directory (see
[configuration.md](./configuration.md)). At boot, the agent imports every
top-level `.mjs` file in it — not subdirectories, not anything re-scanned
later while it's running. Each file is expected to `export default` an
array of tools shaped like this:

```js
import { z } from "zod";

export default [
  {
    name: "word_count",
    description: "Counts words in a project file. Use this instead of reading " +
      "the whole file when the caller only needs a count.",
    schema: z.object({ path: z.string() }),
    async run(context, input) {
      const file = await context.runtime.readFile(context.projectId, input.path);
      const words = file.content.trim().split(/\s+/).filter(Boolean).length;
      return { output: `${words} words` };
    },
  },
];
```

`schema` has to be a real [zod](https://zod.dev) schema, not just an object
that happens to have a `safeParse` method — the agent converts it to JSON
Schema for the model once per session, and that conversion needs an actual
zod schema to work from. A stand-in that merely *looks* like one passes a
shallow check and then breaks every session created afterward, not just a
call to that one tool — found the hard way, which is why the loader now
also verifies the conversion itself succeeds at boot (see below) and
refuses the tool, cleanly, if it doesn't.

Since `ZELYQ_PLUGIN_DIR` is typically a directory outside Zelyq's own
checkout, `import { z } from "zod"` only resolves if that directory has its
own copy — Node looks for `node_modules` starting from the importing file,
not from Zelyq's. Run `npm init -y && npm install zod` once inside your
plugin directory, the same way you'd bootstrap any standalone Node script.

### What `context` gives you

The second argument to `run` is a `ToolContext`:

| Field | What it is |
| --- | --- |
| `projectId` | The project this turn is running against. |
| `runtime` | A `RuntimeDriver` — `readFile`, `writeFile`, `deleteFile`, `listFiles`, `exec`, `startPreview`/`stopPreview`/`previewLogs`, snapshots. The same object every built-in tool receives; there is no separate, smaller interface for a plugin. |
| `signal` | An `AbortSignal`, cancelled if the user stops the turn. A tool that runs long should check it. |
| `onFileChanged(path)` | Call this after writing a file so the UI refreshes without polling. |
| `log(message)` | Structured progress, surfaced in the event stream. |

There is nothing to import to get any of this — it's handed to `run` as
its first argument, exactly like a built-in tool receives it.

### What actually happens at boot

- Every `.mjs` file directly inside `ZELYQ_PLUGIN_DIR` is imported, in
  filename order.
- A file that fails to import (a syntax error, a thrown top-level
  statement, a missing dependency) is logged and skipped. It never stops
  the agent from starting, and it never stops the rest of the directory
  from loading.
- A default export that isn't an array, or an array entry missing
  `name`, `description`, `schema`, or `run`, is logged and skipped the
  same way — including a `schema` that isn't a real zod schema, checked by
  actually converting it, not just checking it has the right-shaped methods.
- A tool whose `name` matches a built-in tool's name is logged loudly and
  skipped. A plugin adds tools; it never replaces or shadows one that
  ships in the box.
- None of the above is reachable once the agent is running — adding or
  changing a plugin means restarting the agent process, on purpose. That
  restart is the same access a plugin already requires to exist at all.

## What this is not

Not a marketplace, not something installed by name (`npm install` or
otherwise), and not something a project can configure for itself. All
three are real, larger features that would sit on top of this — this is
the smallest honest version of "add a tool," not a placeholder for a
bigger one still to come. If you want more than that, write the tool and
keep the source next to your own deployment, the same way you'd keep any
other operator-trusted script.
