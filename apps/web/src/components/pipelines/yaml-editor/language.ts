import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippet,
  startCompletion,
} from "@codemirror/autocomplete";
import type { Diagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";
import { type EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import type { PipelineFileIssue, PipelinePluginSummary } from "@zelyq/core";
import {
  closest,
  cursorContext,
  expressionOptions,
  fileNames,
  type KeyDoc,
  keyAt,
  keyDoc,
  keysAt,
  locateWarning,
  siblings,
  suggestKey,
  type ValueSource,
} from "../../../lib/pipeline-yaml";

/** What of the team's the editor can suggest. Read when suggesting, so it is always current. */
export interface Lookups {
  vault: string[];
  runners: { name: string; labels: string[] }[];
  apps: string[];
  pipelines: string[];
  environments: string[];
  plugins: PipelinePluginSummary[];
}

export const NO_LOOKUPS: Lookups = {
  vault: [],
  runners: [],
  apps: [],
  pipelines: [],
  environments: [],
  plugins: [],
};

const SETUP_VALUES = ["node@22", "node@lts", "node", "python@3.12", "java@21", "go@1.26"];

/** A step written out, offered where a new step goes. */
const STEP_SNIPPETS: { label: string; detail: string; body: string }[] = [
  { label: "run", detail: "A shell command", body: "run: ${}" },
  { label: "checkout", detail: "Fetch the source", body: "checkout: true" },
  { label: "setup", detail: "Node, Python, Java or Go", body: "setup: ${node@22}" },
  { label: "cache", detail: "Keep a folder between runs", body: "cache: ${node_modules}" },
  {
    label: "docker",
    detail: "Build and push an image",
    body: "docker:\n\timage: ${registry.example.com/team/app}\n\ttags: [latest]\n\tpush: ${true}",
  },
  { label: "approval", detail: "Wait for a person", body: "approval: ${Deploy to production?}" },
  {
    label: "deploy",
    detail: "To an environment",
    body: "deploy:\n\tto: ${production}\n\tport: ${3000}",
  },
  { label: "pipeline", detail: "Start another pipeline", body: "pipeline:\n\trun: ${}" },
  { label: "download", detail: "Another run's files", body: "download:\n\tartifact: ${dist}" },
  { label: "plugin", detail: "An installed plugin", body: "plugin: ${}" },
];

const STAGE_SNIPPET = "name: ${Build}\nsteps:\n\t- run: ${}";

/**
 * A snippet's later lines are indented from the start of its line. After a
 * `- `, the keys sit two columns further in, so they go one level deeper.
 */
function shape(body: string, dashed: boolean): string {
  return dashed ? body.replace(/\n/g, "\n\t") : body;
}

function info(entry: KeyDoc): () => Node {
  return () => {
    const box = document.createElement("div");
    const text = document.createElement("div");
    text.textContent = entry.doc;
    box.append(text);
    if (entry.example) {
      const pre = document.createElement("pre");
      pre.style.cssText =
        "margin:6px 0 0;font-family:var(--font-mono);font-size:11px;line-height:16px;color:var(--text-secondary)";
      pre.textContent = entry.example;
      box.append(pre);
    }
    return box;
  };
}

/** After a key is put in, offer its values straight away, as editors do. */
function thenSuggest(view: EditorView) {
  window.setTimeout(() => startCompletion(view), 0);
}

function keyOption(entry: KeyDoc, dashed: boolean): Completion {
  const base = {
    label: entry.key,
    type: "property",
    detail: entry.required ? "required" : undefined,
    info: info(entry),
    boost: entry.required ? 2 : 0,
  };
  if (entry.snippet) return { ...base, apply: snippet(shape(entry.snippet, dashed)) };
  return {
    ...base,
    apply: (view, _completion, from, to) => {
      const insert = `${entry.key}: `;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        userEvent: "input.complete",
      });
      if (entry.values) thenSuggest(view);
    },
  };
}

function valuesOf(source: ValueSource, lookups: Lookups): Completion[] {
  if (Array.isArray(source)) return source.map((label) => ({ label, type: "enum" }));
  switch (source) {
    case "boolean":
      return [
        { label: "true", type: "keyword" },
        { label: "false", type: "keyword" },
      ];
    case "vault":
      return lookups.vault.map((name) => ({
        label: `vault://${name}`,
        type: "variable",
        detail: "Vault",
      }));
    case "runner": {
      const labels = [...new Set(lookups.runners.flatMap((runner) => runner.labels))];
      return [
        { label: "local", type: "constant", detail: "The Zelyq server" },
        ...lookups.runners.map((runner) => ({
          label: runner.name,
          type: "constant",
          detail: "Runner",
        })),
        ...labels.map((label) => ({ label: `[${label}]`, type: "constant", detail: "Label" })),
      ];
    }
    case "app":
      return lookups.apps.map((label) => ({ label, type: "constant", detail: "App" }));
    case "pipeline":
      return lookups.pipelines.map((label) => ({ label, type: "constant", detail: "Pipeline" }));
    case "environment":
      return lookups.environments.map((label) => ({
        label,
        type: "constant",
        detail: "Environment",
      }));
    case "plugin":
      return lookups.plugins.map((plugin) => ({
        label: `${plugin.pluginId}@${plugin.version}`,
        type: "class",
        detail: plugin.name,
        info: plugin.description,
      }));
    case "setup":
      return SETUP_VALUES.map((label) => ({ label, type: "enum" }));
  }
  return [];
}

/** Suggestions for wherever the cursor is: keys, values, vault://, ${{ … }}. */
export function pipelineCompletions(getLookups: () => Lookups) {
  return (context: CompletionContext): CompletionResult | null => {
    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const before = line.text.slice(0, pos - line.from);
    const lookups = getLookups();

    // ${{ inputs.… }}, ${{ steps.ID.outputs.… }} and the like.
    const expression = /\$\{\{\s*([\w.-]*)$/.exec(before);
    if (expression) {
      const typed = expression[1] ?? "";
      const last = typed.slice(typed.lastIndexOf(".") + 1);
      const names = fileNames(state.doc.toString());
      const options = expressionOptions(typed, names, (ref) => {
        const plugin = lookups.plugins.find(
          (entry) => `${entry.pluginId}@${entry.version}` === ref,
        );
        return plugin?.outputs.map((output) => output.name) ?? [];
      });
      if (options.length === 0) return null;
      const parts = typed.split(".");
      const head = parts[0];
      const leaf =
        ((head === "inputs" || head === "matrix") && parts.length === 2) ||
        (head === "services" && parts.length === 3) ||
        (head === "steps" && parts.length === 4);
      const closed = line.text
        .slice(pos - line.from)
        .trimStart()
        .startsWith("}}");
      return {
        from: pos - last.length,
        options: options.map((label) => ({
          label,
          type: "variable",
          apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
            const insert = !leaf ? `${label}.` : closed ? label : `${label} }}`;
            view.dispatch({
              changes: { from, to, insert },
              selection: { anchor: from + insert.length },
              userEvent: "input.complete",
            });
            // inputs. → the inputs; steps.meta. → outputs: keep going.
            if (!leaf) thenSuggest(view);
          },
        })),
        validFor: /^[\w-]*$/,
      };
    }

    // vault://NAME anywhere a value goes.
    const vault = /vault:\/\/([\w.-]*)$/.exec(before);
    if (vault) {
      return {
        from: pos - vault[0].length,
        options: valuesOf("vault", lookups),
        validFor: /^vault:\/\/[\w.-]*$/,
      };
    }

    const text = state.doc.toString();
    const at = cursorContext(text, pos);

    if (at.mode === "value") {
      if (!at.key) return null;
      const entry = keyDoc(at.path, at.key);
      const parent = at.path[at.path.length - 1];
      let options: Completion[] = entry?.values ? valuesOf(entry.values, lookups) : [];
      // Variables and plugin inputs: a value may come from Vault.
      if (!entry && (parent === "env" || parent === "with" || parent === "build-args")) {
        options = valuesOf("vault", lookups);
      }
      if (options.length === 0) return null;
      if (!context.explicit && at.prefix === "" && !before.endsWith(": ")) return null;
      return { from: at.from, options, validFor: /^[\w@./:[\]-]*$/ };
    }

    // A key. Only offered when asked, or once something is typed.
    if (!context.explicit && at.prefix === "" && !at.listItem) return null;
    if (/\s/.test(at.prefix)) return null;
    const last = at.path[at.path.length - 1];
    // The key goes right after a `- ` on its line.
    const dashed = /^\s*(-\s+)+$/.test(line.text.slice(0, at.from - line.from));

    // Where a list item goes: a new stage or step, written out.
    if (!at.listItem && (last === "stages" || last === "steps")) {
      if (last === "stages") {
        return {
          from: at.from,
          options: [
            {
              label: "- name",
              detail: "A new stage",
              type: "keyword",
              apply: snippet(`- ${shape(STAGE_SNIPPET, true)}`),
            },
          ],
        };
      }
      return {
        from: at.from,
        options: STEP_SNIPPETS.map((step, index) => ({
          label: `- ${step.label}`,
          detail: step.detail,
          type: "keyword",
          // The order they are listed in, most used first; not the alphabet.
          boost: STEP_SNIPPETS.length - index,
          apply: snippet(`- ${shape(step.body, true)}`),
        })),
      };
    }

    const known = keysAt(at.path);
    if (!known) {
      // A plugin step's inputs, from what the plugin declares.
      if (last === "with" && at.path[at.path.length - 2] === "-") {
        const stepColumn = at.columns[at.columns.length - 1] ?? 0;
        const ref = siblings(text, line.from + stepColumn, stepColumn).get("plugin");
        const plugin = lookups.plugins.find(
          (entry) => `${entry.pluginId}@${entry.version}` === ref,
        );
        if (!plugin) return null;
        const written = siblings(text, pos, at.column);
        return {
          from: at.from,
          options: plugin.inputs
            .filter((input) => !written.has(input.name))
            .map((input) => ({
              label: input.name,
              type: "property",
              detail: input.required ? "required" : input.secret ? "secret" : undefined,
              info: input.description ?? undefined,
              apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
                const insert = `${input.name}: ${input.secret ? "vault://" : ""}`;
                view.dispatch({
                  changes: { from, to, insert },
                  selection: { anchor: from + insert.length },
                  userEvent: "input.complete",
                });
                if (input.secret) thenSuggest(view);
              },
            })),
          validFor: /^[\w-]*$/,
        };
      }
      return null;
    }
    const written = siblings(text, pos, at.column);
    let options = known
      .filter((entry) => !written.has(entry.key))
      .map((entry) => keyOption(entry, dashed));
    // In a step with no kind yet, the kinds come first and are written out.
    if (last === "-" && at.path[at.path.length - 2] === "steps") {
      const hasKind = STEP_SNIPPETS.some((step) => written.has(step.label));
      if (!hasKind) {
        options = [
          ...STEP_SNIPPETS.map((step, index) => ({
            label: step.label,
            detail: step.detail,
            type: "keyword",
            boost: 20 + STEP_SNIPPETS.length - index,
            apply: snippet(shape(step.body, dashed)),
          })),
          ...options.filter((option) => !STEP_SNIPPETS.some((step) => step.label === option.label)),
        ];
      } else {
        options = options.filter(
          (option) => !STEP_SNIPPETS.some((step) => step.label === option.label),
        );
      }
    }
    return { from: at.from, options, validFor: /^[\w-]*$/ };
  };
}

// ---------------------------------------------------------------------------
// Hover help
// ---------------------------------------------------------------------------

function docBox(title: string, body: string, example?: string, badge?: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "cm-zelyq-doc";
  const head = document.createElement("div");
  const key = document.createElement("span");
  key.className = "cm-zelyq-doc-key";
  key.textContent = title;
  head.append(key);
  if (badge) {
    const tag = document.createElement("span");
    tag.className = "cm-zelyq-doc-required";
    tag.textContent = badge;
    head.append(tag);
  }
  const text = document.createElement("p");
  text.textContent = body;
  box.append(head, text);
  if (example) {
    const pre = document.createElement("pre");
    pre.textContent = example;
    box.append(pre);
  }
  return box;
}

/** What a key does, what a vault:// secret is, what a plugin takes — on hover. */
export function pipelineHover(getLookups: () => Lookups) {
  return hoverTooltip((view, pos): Tooltip | null => {
    const text = view.state.doc.toString();
    const line = view.state.doc.lineAt(pos);
    const offset = pos - line.from;

    const around = (pattern: RegExp) => {
      for (const match of line.text.matchAll(pattern)) {
        const start = match.index ?? 0;
        if (offset >= start && offset <= start + match[0].length) return { match, start };
      }
      return null;
    };

    const vault = around(/vault:\/\/([A-Za-z][\w.-]*)/g);
    if (vault) {
      const name = vault.match[1] ?? "";
      const known = getLookups().vault.includes(name);
      return {
        pos: line.from + vault.start,
        end: line.from + vault.start + vault.match[0].length,
        above: true,
        create: () => ({
          dom: docBox(
            name,
            known
              ? "A secret from the team's Vault. Its value is put in when the run starts and hidden in the log."
              : "Not in the team's Vault yet. Add it in Vault before the pipeline runs.",
            undefined,
            known ? "Vault" : "missing",
          ),
        }),
      };
    }

    const plugin = around(/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*@[\w.-]+/g);
    if (plugin) {
      const found = getLookups().plugins.find(
        (entry) => `${entry.pluginId}@${entry.version}` === plugin.match[0],
      );
      if (found) {
        const inputs = found.inputs
          .map(
            (input) =>
              `${input.name}${input.required ? " (required)" : ""}${input.secret ? " — vault://" : ""}`,
          )
          .join("\n");
        return {
          pos: line.from + plugin.start,
          end: line.from + plugin.start + plugin.match[0].length,
          above: true,
          create: () => ({
            dom: docBox(
              found.name,
              found.description,
              inputs ? `with:\n${inputs}` : undefined,
              "plugin",
            ),
          }),
        };
      }
    }

    const found = keyAt(text, pos);
    if (!found) return null;
    const entry = keyDoc(found.path, found.key);
    if (!entry) return null;
    return {
      pos: found.from,
      end: found.to,
      above: true,
      create: () => ({
        dom: docBox(entry.key, entry.doc, entry.example, entry.required ? "required" : undefined),
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Problems in the text
// ---------------------------------------------------------------------------

export interface Problem {
  severity: "error" | "warning";
  message: string;
  /** Where in the text, when known. */
  from: number | null;
  to: number | null;
  line: number | null;
  /** A change that fixes it, when one is obvious. */
  fix: { label: string; insert: string } | null;
}

/** An empty range (a key with no value) is shown on what is written on that line. */
function widen(state: EditorState, from: number, to: number): [number, number] {
  const max = state.doc.length;
  const start = Math.min(Math.max(0, from), max);
  const end = Math.min(Math.max(start, to), max);
  if (end > start) return [start, end];
  const line = state.doc.lineAt(start);
  const content = line.text.trimEnd();
  const lead = line.text.length - line.text.trimStart().length;
  if (content.length > lead) return [line.from + lead, line.from + content.length];
  // A blank line: the line before it, where the thing left empty is.
  if (line.number > 1) {
    const previous = state.doc.line(line.number - 1);
    const prevLead = previous.text.length - previous.text.trimStart().length;
    return [previous.from + prevLead, previous.from + previous.text.trimEnd().length];
  }
  return [start, Math.min(start + 1, max)];
}

/** The parser's issues and the server's warnings, placed in the text with fixes where obvious. */
export function problemsFor(
  state: EditorState,
  issues: readonly PipelineFileIssue[],
  warnings: readonly string[],
): Problem[] {
  const text = state.doc.toString();
  const out: Problem[] = [];
  for (const issue of issues) {
    let from: number | null = null;
    let to: number | null = null;
    if (issue.from !== undefined && issue.to !== undefined) {
      [from, to] = widen(state, issue.from, issue.to);
    } else if (issue.line !== null && issue.line <= state.doc.lines) {
      const line = state.doc.line(issue.line);
      [from, to] = widen(state, line.from, line.from);
    }
    let fix: Problem["fix"] = null;
    if (from !== null && to !== null) {
      const written = text.slice(from, to);
      if (/^Unrecognized key/.test(issue.message)) {
        const meant = suggestKey(issue.path);
        if (meant) fix = { label: `Change to ${meant}`, insert: meant };
      } else {
        // A value that is not one of a key's words: the nearest word.
        const parts = issue.path.split(".");
        const key = parts.pop();
        const path = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : part));
        const values = key ? keyDoc(path, key)?.values : undefined;
        if (Array.isArray(values)) {
          const meant = closest(written, values);
          if (meant) fix = { label: `Change to ${meant}`, insert: meant };
        }
      }
    }
    out.push({
      severity: "error",
      message: issue.message.replace(
        /^Unrecognized key: "(.+)"$/,
        "$1 is not something this place takes.",
      ),
      from,
      to,
      line: from === null ? issue.line : state.doc.lineAt(from).number,
      fix,
    });
  }
  for (const warning of warnings) {
    const place = locateWarning(text, warning);
    out.push({
      severity: "warning",
      message: warning,
      from: place?.from ?? null,
      to: place?.to ?? null,
      line: place ? state.doc.lineAt(place.from).number : null,
      fix: null,
    });
  }
  return out;
}

/** Problems as the editor underlines them. */
export function toDiagnostics(problems: readonly Problem[]): Diagnostic[] {
  return problems
    .filter((problem) => problem.from !== null && problem.to !== null)
    .map((problem) => ({
      from: problem.from as number,
      to: problem.to as number,
      severity: problem.severity,
      message: problem.message,
      actions: problem.fix
        ? [
            {
              name: problem.fix.label,
              apply: (view: EditorView, from: number, to: number) => {
                view.dispatch({
                  changes: { from, to, insert: problem.fix?.insert ?? "" },
                  userEvent: "input.fix",
                });
              },
            },
          ]
        : [],
    }));
}
