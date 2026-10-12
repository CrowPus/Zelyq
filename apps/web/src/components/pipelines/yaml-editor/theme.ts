import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * The editor in the app's own tokens, so it follows light and dark with the
 * rest of the page and needs no theme of its own.
 */
export const editorTheme = EditorView.theme({
  "&": {
    color: "var(--text)",
    backgroundColor: "var(--surface)",
    fontSize: "12px",
    height: "100%",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "20px",
    overflow: "auto",
  },
  ".cm-content": { padding: "8px 0", caretColor: "var(--text)" },
  ".cm-line": { padding: "0 12px 0 6px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--editor-selection)" },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--surface-hover) 70%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface-subtle)",
    color: "var(--text-muted)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px", minWidth: "32px" },
  ".cm-activeLineGutter": { backgroundColor: "var(--surface-hover)", color: "var(--text)" },
  ".cm-foldGutter .cm-gutterElement": {
    padding: "0 4px",
    cursor: "pointer",
    color: "var(--text-muted)",
  },
  ".cm-foldGutter .cm-gutterElement:hover": { color: "var(--text)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--surface-hover)",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
    borderRadius: "3px",
    padding: "0 4px",
    margin: "0 2px",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--surface-active)",
    outline: "1px solid var(--border-strong)",
  },
  ".cm-nonmatchingBracket": { color: "var(--danger)" },
  ".cm-selectionMatch": { backgroundColor: "var(--editor-match)" },
  ".cm-searchMatch": {
    backgroundColor: "var(--editor-match)",
    outline: "1px solid var(--warning)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--warning-subtle)" },
  // Indentation guides: one hairline per level, the structure at a glance.
  ".cm-indent-guide": {
    backgroundImage:
      "linear-gradient(to right, var(--border) 0, var(--border) 1px, transparent 1px)",
    backgroundSize: "2ch 100%",
    backgroundRepeat: "repeat-x",
  },

  // Panels: find and replace, go to line.
  ".cm-panels": {
    backgroundColor: "var(--surface-subtle)",
    color: "var(--text)",
    fontFamily: "var(--font-sans)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel.cm-search": { padding: "6px 8px", fontSize: "12px" },
  ".cm-panel.cm-search label": { fontSize: "12px", color: "var(--text-secondary)" },
  ".cm-panel input, .cm-panel button": { fontSize: "12px" },
  ".cm-textfield": {
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border-strong)",
    borderRadius: "3px",
    padding: "2px 6px",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border-strong)",
    borderRadius: "3px",
    padding: "2px 8px",
  },
  ".cm-button:hover": { backgroundColor: "var(--surface-hover)" },
  ".cm-panel.cm-search [name=close]": { color: "var(--text-muted)", fontSize: "16px" },

  // Suggestions.
  ".cm-tooltip": {
    backgroundColor: "var(--overlay)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "5px",
    boxShadow: "var(--shadow-overlay)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
    maxHeight: "16em",
    minWidth: "260px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "2px 8px", lineHeight: "20px" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--surface-active)",
    color: "var(--text)",
  },
  ".cm-completionLabel": { color: "var(--text)" },
  ".cm-completionMatchedText": {
    textDecoration: "none",
    fontWeight: "600",
    color: "var(--syntax-key)",
  },
  ".cm-completionDetail": {
    marginLeft: "12px",
    fontStyle: "normal",
    fontFamily: "var(--font-sans)",
    color: "var(--text-muted)",
    fontSize: "11px",
  },
  ".cm-completionIcon": { opacity: "0.7", width: "1.2em", paddingRight: "4px" },
  ".cm-completionInfo": {
    padding: "6px 10px",
    maxWidth: "360px",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    lineHeight: "18px",
  },

  // Hover help and problems.
  ".cm-tooltip-hover": { maxWidth: "420px" },
  ".cm-zelyq-doc": { padding: "8px 10px", fontSize: "12px", lineHeight: "18px" },
  ".cm-zelyq-doc-key": { fontFamily: "var(--font-mono)", fontWeight: "600" },
  ".cm-zelyq-doc-required": {
    marginLeft: "6px",
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
  },
  ".cm-zelyq-doc p": { margin: "4px 0 0", color: "var(--text-secondary)" },
  ".cm-zelyq-doc pre": {
    margin: "6px 0 0",
    padding: "6px 8px",
    borderRadius: "3px",
    backgroundColor: "var(--surface-subtle)",
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    lineHeight: "16px",
    whiteSpace: "pre",
    overflowX: "auto",
  },
  ".cm-diagnostic": {
    padding: "6px 10px",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    borderLeftWidth: "3px",
  },
  ".cm-diagnostic-error": { borderLeftColor: "var(--danger)" },
  ".cm-diagnostic-warning": { borderLeftColor: "var(--warning)" },
  ".cm-diagnosticAction": {
    backgroundColor: "var(--primary)",
    color: "var(--primary-text)",
    borderRadius: "3px",
    padding: "1px 8px",
    marginLeft: "8px",
    fontSize: "11px",
  },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--danger)",
    textUnderlineOffset: "3px",
    textDecorationSkipInk: "none",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--warning)",
    textUnderlineOffset: "3px",
    textDecorationSkipInk: "none",
  },
  ".cm-lint-marker": { width: "10px", height: "10px" },
  ".cm-gutter-lint": { width: "14px" },
  ".cm-gutter-lint .cm-gutterElement": { padding: "0 0 0 4px" },
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.definition(tags.propertyName), color: "var(--syntax-key)" },
  { tag: tags.string, color: "var(--syntax-string)" },
  { tag: tags.special(tags.string), color: "var(--syntax-keyword)" },
  { tag: tags.lineComment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [tags.labelName, tags.typeName], color: "var(--syntax-keyword)" },
  { tag: [tags.keyword, tags.meta], color: "var(--syntax-keyword)" },
  {
    tag: [tags.separator, tags.punctuation, tags.squareBracket, tags.brace],
    color: "var(--text-muted)",
  },
]);

const valueMarks = {
  number: Decoration.mark({ attributes: { style: "color: var(--syntax-number)" } }),
  keyword: Decoration.mark({ attributes: { style: "color: var(--syntax-keyword)" } }),
  meta: Decoration.mark({
    attributes: { style: "color: var(--syntax-meta)" },
    class: "cm-zelyq-reference",
  }),
};

const NUMBER = /^[-+]?(\d[\d_]*(\.\d+)?([eE][-+]?\d+)?|0x[\da-fA-F]+|\.inf|\.nan)$/;
const KEYWORD = /^(true|false|yes|no|on|off|null|~)$/i;
const DURATION = /^\d+(ms|s|m|h|d)$/;
const REFERENCE = /vault:\/\/[A-Za-z][\w.-]*|\$\{\{[^}]*\}\}|\$[A-Z_][A-Z0-9_]*/g;

function valueDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (
          node.name !== "Literal" &&
          node.name !== "QuotedLiteral" &&
          node.name !== "BlockLiteralContent"
        ) {
          return;
        }
        if (node.node.parent?.name === "Key") return;
        const text = view.state.doc.sliceString(node.from, node.to);
        if (node.name === "Literal" && (NUMBER.test(text) || DURATION.test(text))) {
          builder.add(node.from, node.to, valueMarks.number);
          return;
        }
        if (node.name === "Literal" && KEYWORD.test(text)) {
          builder.add(node.from, node.to, valueMarks.keyword);
          return;
        }
        for (const match of text.matchAll(REFERENCE)) {
          const start = node.from + (match.index ?? 0);
          builder.add(start, start + match[0].length, valueMarks.meta);
        }
      },
    });
  }
  return builder.finish();
}

/** Numbers, true/false, vault:// and ${{ … }} told apart from plain text. */
const values = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = valueDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = valueDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const guideMark = Decoration.mark({ class: "cm-indent-guide" });

/** A hairline at each indentation level, drawn on the leading spaces. */
const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          const indent = /^ */.exec(line.text)?.[0].length ?? 0;
          if (indent >= 2 && line.text.trim() !== "") {
            builder.add(line.from, line.from + indent - (indent % 2), guideMark);
          }
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export const editorLook: Extension = [
  editorTheme,
  syntaxHighlighting(highlightStyle),
  values,
  indentGuides,
];
