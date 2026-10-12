import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import {
  bracketMatching,
  foldAll,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  unfoldAll,
} from "@codemirror/language";
import { lintGutter, nextDiagnostic, setDiagnostics } from "@codemirror/lint";
import {
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from "@codemirror/search";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
} from "@codemirror/view";
import { useQuery } from "@tanstack/react-query";
import type { PipelineFileIssue } from "@zelyq/core";
import {
  AlignLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleAlert,
  Keyboard,
  Maximize2,
  Minimize2,
  Save,
  Search,
  TriangleAlert,
  WrapText,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { formatYaml } from "../../lib/pipeline-yaml";
import {
  type Lookups,
  NO_LOOKUPS,
  type Problem,
  pipelineCompletions,
  pipelineHover,
  problemsFor,
  toDiagnostics,
} from "./yaml-editor/language";
import { editorLook } from "./yaml-editor/theme";

interface Props {
  teamId: string;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  /** What the parser found wrong, with where. */
  issues: readonly PipelineFileIssue[];
  /** What the server adds: secrets not in Vault, runners that do not exist. */
  warnings: readonly string[];
  /** Ctrl/⌘+S. Absent when there is nothing to save. */
  onSave?: () => void;
  /** Changed since it was saved: shown in full screen, where the page's own marker is hidden. */
  dirty?: boolean;
}

const WRAP_KEY = "zelyq.yaml-editor.wrap";
const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = mac ? "⌘" : "Ctrl";
const ALT = mac ? "⌥" : "Alt";

const SHORTCUTS: [string, string][] = [
  [`${MOD}+S`, "Save"],
  [`${MOD}+Space`, "Suggest"],
  [`${MOD}+F`, "Find and replace"],
  [`${MOD}+${ALT}+G`, "Go to line"],
  [`Shift+${ALT}+F`, "Format"],
  [`${MOD}+/`, "Comment or uncomment"],
  [`${MOD}+D`, "Select the next match"],
  [`${ALT}+↑ / ↓`, "Move lines"],
  [`Shift+${ALT}+↑ / ↓`, "Copy lines"],
  [`${MOD}+]  /  ${MOD}+[`, "Indent, outdent"],
  [`${MOD}+Shift+[  /  ]`, "Fold, unfold"],
  ["F8", "Next problem"],
  [`${MOD}+Z  /  ${MOD}+Shift+Z`, "Undo, redo"],
  [`${ALT}+click, drag`, "More cursors, a column"],
];

/** Two spaces at each cursor: YAML does not allow tabs for indenting. */
function spaces(target: EditorView): boolean {
  if (target.state.readOnly) return false;
  target.dispatch(target.state.replaceSelection("  "), { userEvent: "input" });
  return true;
}

function readWrap(): boolean {
  try {
    return localStorage.getItem(WRAP_KEY) === "1";
  } catch {
    return false;
  }
}

/** The team's names the editor suggests: secrets, runners, apps, pipelines, environments, plugins. */
function useLookups(teamId: string): Lookups {
  const vault = useQuery({
    queryKey: ["vault-choices", teamId],
    queryFn: () => api.vault.choices({ kind: "team", teamId }).then((r) => r.choices),
  });
  const runners = useQuery({
    queryKey: ["runners", teamId],
    queryFn: () => api.runners.list(teamId),
  });
  const apps = useQuery({ queryKey: ["projects"], queryFn: () => api.listProjects() });
  const pipelines = useQuery({
    queryKey: ["pipelines", teamId],
    queryFn: () => api.pipelines.list(teamId),
  });
  const environments = useQuery({
    queryKey: ["environments", teamId],
    queryFn: () => api.deploys.environments(teamId),
  });
  const plugins = useQuery({
    queryKey: ["pipeline-plugins", teamId],
    queryFn: () => api.pipelines.plugins(teamId),
  });
  return useMemo(
    () => ({
      vault: (vault.data ?? []).map((choice) => choice.name),
      runners: runners.data?.runners ?? [],
      apps: (apps.data?.projects ?? [])
        .filter((app) => app.teamId === teamId)
        .map((app) => app.name),
      pipelines: (pipelines.data?.pipelines ?? []).map((pipeline) => pipeline.name),
      environments: (environments.data?.environments ?? []).map((environment) => environment.name),
      plugins: plugins.data?.plugins ?? NO_LOOKUPS.plugins,
    }),
    [teamId, vault.data, runners.data, apps.data, pipelines.data, environments.data, plugins.data],
  );
}

/**
 * The pipeline file as text, in an editor that knows what goes in it: keys
 * and values suggested where they belong, help on hover, problems underlined
 * where they are with a fix when one is obvious, and the usual editor keys.
 */
export default function YamlEditor({
  teamId,
  value,
  onChange,
  readOnly,
  issues,
  warnings,
  onSave,
  dirty = false,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lookups = useLookups(teamId);
  // Read by the editor when it needs them, so they never go stale inside it.
  const latest = useRef({ onChange, onSave, lookups });
  latest.current = { onChange, onSave, lookups };
  const compartments = useMemo(
    () => ({ readOnly: new Compartment(), wrap: new Compartment() }),
    [],
  );

  const [wrap, setWrap] = useState(readWrap);
  const [full, setFull] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [listOpen, setListOpen] = useState(true);
  const [cursor, setCursor] = useState({ line: 1, column: 1, selected: 0, cursors: 1 });
  const [formatNote, setFormatNote] = useState<string | null>(null);

  const format = (target: EditorView) => {
    const text = target.state.doc.toString();
    const next = formatYaml(text);
    if (next === null) {
      setFormatNote("Fix the YAML errors first; formatting never guesses.");
      return true;
    }
    setFormatNote(null);
    if (next !== text) {
      target.dispatch({ changes: { from: 0, to: text.length, insert: next }, userEvent: "format" });
    }
    return true;
  };

  // The editor is made once; what changes later is sent to it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: made once, on purpose
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter({
            markerDOM: (open) => {
              const marker = document.createElement("span");
              marker.textContent = open ? "⌄" : "›";
              marker.title = open ? "Fold" : "Unfold";
              marker.style.cssText = open
                ? "display:inline-block;transform:translateY(-3px)"
                : "display:inline-block";
              return marker;
            },
          }),
          lintGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          indentUnit.of("  "),
          EditorState.tabSize.of(2),
          yaml(),
          autocompletion({
            override: [pipelineCompletions(() => latest.current.lookups)],
            activateOnTyping: true,
            icons: true,
            closeOnBlur: true,
          }),
          pipelineHover(() => latest.current.lookups),
          editorLook,
          placeholder("name: My pipeline"),
          EditorView.contentAttributes.of({ "aria-label": "Pipeline file" }),
          compartments.readOnly.of(EditorState.readOnly.of(readOnly)),
          compartments.wrap.of(wrap ? EditorView.lineWrapping : []),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                latest.current.onSave?.();
                return true;
              },
            },
            { key: "Shift-Alt-f", run: format },
            { key: "Mod-Alt-g", run: gotoLine },
            { key: "F8", run: nextDiagnostic },
            {
              // Tab takes a suggestion, indents a selection, or puts in two spaces.
              key: "Tab",
              run: (target) =>
                acceptCompletion(target) ||
                (target.state.selection.ranges.some((range) => !range.empty)
                  ? indentMore(target)
                  : spaces(target)),
              shift: indentLess,
            },
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...searchKeymap,
            ...foldKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString());
            if (update.docChanged || update.selectionSet) {
              const main = update.state.selection.main;
              const line = update.state.doc.lineAt(main.head);
              setCursor({
                line: line.number,
                column: main.head - line.from + 1,
                selected: update.state.selection.ranges.reduce(
                  (total, range) => total + range.to - range.from,
                  0,
                ),
                cursors: update.state.selection.ranges.length,
              });
            }
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  // A change from outside: Undo all, a template, the visual editor.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current !== value) {
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.readOnly.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly, compartments]);

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.wrap.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
    try {
      localStorage.setItem(WRAP_KEY, wrap ? "1" : "0");
    } catch {
      // Not remembered in a private window; still applied.
    }
  }, [wrap, compartments]);

  // Problems: underlined in the text, and listed below it.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const found = problemsFor(editor.state, issues, warnings);
    setProblems(found);
    editor.dispatch(setDiagnostics(editor.state, toDiagnostics(found)));
  }, [issues, warnings]);

  // Full screen: the page behind does not scroll, and Escape comes back.
  useEffect(() => {
    if (!full) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      const editor = view.current;
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (editor && completionStatus(editor.state) !== null) return;
      if (document.querySelector(".cm-search")) return;
      setFull(false);
    };
    window.addEventListener("keydown", onKey);
    view.current?.requestMeasure();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

  // The shortcut list closes on Escape or a click elsewhere.
  const keysBox = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!showKeys) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowKeys(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!keysBox.current?.contains(event.target as Node)) setShowKeys(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [showKeys]);

  const run = (command: (target: EditorView) => boolean) => {
    const editor = view.current;
    if (!editor) return;
    command(editor);
    editor.focus();
  };

  const jump = (problem: Problem) => {
    const editor = view.current;
    if (!editor) return;
    const from = problem.from ?? (problem.line ? editor.state.doc.line(problem.line).from : null);
    if (from === null) return;
    editor.dispatch({
      selection: EditorSelection.range(from, problem.to ?? from),
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    editor.focus();
  };

  const fix = (problem: Problem) => {
    const editor = view.current;
    if (!editor || !problem.fix || problem.from === null || problem.to === null) return;
    editor.dispatch({
      changes: { from: problem.from, to: problem.to, insert: problem.fix.insert },
      userEvent: "input.fix",
    });
    editor.focus();
  };

  const errors = problems.filter((problem) => problem.severity === "error").length;
  const warningCount = problems.length - errors;

  return (
    <div
      className={
        full
          ? "fixed inset-0 z-50 flex flex-col bg-canvas p-3 sm:p-4"
          : "flex flex-col overflow-hidden rounded-md border border-border-default bg-surface"
      }
    >
      <div
        className={`flex flex-wrap items-center gap-0.5 border-border-default bg-surface-subtle px-1.5 py-1 ${
          full ? "rounded-t-md border" : "border-b"
        }`}
        role="toolbar"
        aria-label="Editor tools"
      >
        <Tool label={`Find and replace (${MOD}+F)`} onClick={() => run(openSearchPanel)}>
          <Search size={14} />
        </Tool>
        {!readOnly && (
          <Tool label={`Format (Shift+${ALT}+F)`} onClick={() => run(format)}>
            <AlignLeft size={14} />
          </Tool>
        )}
        <span className="mx-1 h-4 w-px bg-border-default" aria-hidden />
        <Tool label="Fold all" onClick={() => run(foldAll)}>
          <ChevronsDownUp size={14} />
        </Tool>
        <Tool label="Unfold all" onClick={() => run(unfoldAll)}>
          <ChevronsUpDown size={14} />
        </Tool>
        <Tool label="Wrap long lines" pressed={wrap} onClick={() => setWrap((on) => !on)}>
          <WrapText size={14} />
        </Tool>
        {formatNote && <span className="ml-2 text-2xs text-warning">{formatNote}</span>}
        <span className="ml-auto flex items-center gap-0.5">
          {full && dirty && <span className="mr-2 text-2xs text-warning">Unsaved changes</span>}
          {full && onSave && (
            <button
              type="button"
              onClick={onSave}
              className="mr-1 flex h-7 items-center gap-1.5 rounded bg-primary px-2.5 text-xs font-medium text-primary-text hover:bg-primary-hover"
            >
              <Save size={13} /> Save
            </button>
          )}
          <span className="relative" ref={keysBox}>
            <Tool
              label="Keyboard shortcuts"
              pressed={showKeys}
              onClick={() => setShowKeys((on) => !on)}
            >
              <Keyboard size={14} />
            </Tool>
            {showKeys && (
              <div
                role="dialog"
                aria-label="Keyboard shortcuts"
                className="absolute top-full right-0 z-20 mt-1 w-80 rounded-md border border-border-default bg-overlay p-2 shadow-overlay"
              >
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {SHORTCUTS.map(([keys, what]) => (
                    <div key={what} className="contents">
                      <dt className="font-mono text-2xs whitespace-nowrap text-fg-secondary">
                        {keys}
                      </dt>
                      <dd className="text-fg">{what}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </span>
          <Tool
            label={full ? "Leave full screen (Esc)" : "Full screen"}
            pressed={full}
            onClick={() => setFull((on) => !on)}
          >
            {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Tool>
        </span>
      </div>

      <div
        ref={host}
        className={
          full
            ? "min-h-0 flex-1 overflow-hidden border-x border-border-default bg-surface"
            : "h-[clamp(360px,62vh,780px)] resize-y overflow-hidden"
        }
      />

      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 border-border-default bg-surface-subtle px-2 py-1 text-2xs text-fg-secondary ${
          full ? "border" : "border-t"
        } ${full && !(listOpen && problems.length > 0) ? "rounded-b-md" : ""}`}
      >
        <button
          type="button"
          onClick={() => setListOpen((open) => !open)}
          className="flex items-center gap-2 rounded px-1 hover:bg-surface-hover hover:text-fg"
          aria-expanded={listOpen}
          title="Problems (F8: next)"
        >
          <span className={`flex items-center gap-1 ${errors ? "text-danger" : ""}`}>
            <CircleAlert size={12} /> {errors}
          </span>
          <span className={`flex items-center gap-1 ${warningCount ? "text-warning" : ""}`}>
            <TriangleAlert size={12} /> {warningCount}
          </span>
        </button>
        {readOnly && <span className="rounded bg-surface-hover px-1.5">Read only</span>}
        <span className="ml-auto tabular-nums">
          Ln {cursor.line}, Col {cursor.column}
          {cursor.selected > 0 ? ` (${cursor.selected} selected)` : ""}
          {cursor.cursors > 1 ? ` · ${cursor.cursors} cursors` : ""}
        </span>
        <span className="hidden sm:inline">Spaces: 2</span>
        <span className="hidden sm:inline">UTF-8</span>
        <span>YAML</span>
      </div>

      {listOpen && problems.length > 0 && (
        <ul
          aria-label="Problems"
          className={`max-h-40 overflow-y-auto border-border-default bg-surface text-xs ${
            full ? "rounded-b-md border border-t-0" : "border-t"
          }`}
        >
          {problems.map((problem, index) => (
            <li
              // Problems have no id; the list is rebuilt whole each time.
              // biome-ignore lint/suspicious/noArrayIndexKey: rebuilt whole, never reordered
              key={index}
              className="flex items-start gap-2 px-2 py-1 hover:bg-surface-hover"
            >
              <button
                type="button"
                onClick={() => jump(problem)}
                disabled={problem.from === null && problem.line === null}
                className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:cursor-default"
              >
                {problem.severity === "error" ? (
                  <CircleAlert size={13} className="mt-0.5 shrink-0 text-danger" />
                ) : (
                  <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" />
                )}
                <span className="min-w-0 flex-1 break-words text-fg">{problem.message}</span>
                {problem.line !== null && (
                  <span className="shrink-0 font-mono text-2xs text-fg-muted">
                    Ln {problem.line}
                  </span>
                )}
              </button>
              {problem.fix && !readOnly && (
                <button
                  type="button"
                  onClick={() => fix(problem)}
                  className="shrink-0 rounded border border-border-default px-1.5 text-2xs text-fg hover:bg-surface-active"
                >
                  {problem.fix.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tool({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`flex size-7 items-center justify-center rounded text-fg-secondary hover:bg-surface-hover hover:text-fg ${
        pressed ? "bg-surface-active text-fg" : ""
      }`}
    >
      {children}
    </button>
  );
}
