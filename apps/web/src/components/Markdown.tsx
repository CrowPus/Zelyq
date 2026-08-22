import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown for agent messages.
 *
 * Every element is styled explicitly rather than through a typography plugin:
 * chat messages need tight, dense spacing, and article defaults leave far too
 * much air between paragraphs and list items.
 *
 * Raw HTML is not enabled. Message text is model output, and there is no reason
 * for it to inject markup.
 */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,

  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-info underline decoration-info/40 underline-offset-2 hover:decoration-info"
    >
      {children}
    </a>
  ),

  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,

  h1: ({ children }) => (
    <h3 className="mt-3 mb-1.5 text-sm font-semibold text-fg first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h4 className="mt-3 mb-1.5 text-sm font-semibold text-fg first:mt-0">{children}</h4>
  ),
  h3: ({ children }) => (
    <h5 className="mt-3 mb-1 text-xs font-semibold text-fg first:mt-0">{children}</h5>
  ),
  h4: ({ children }) => (
    <h6 className="mt-3 mb-1 text-xs font-semibold text-fg first:mt-0">{children}</h6>
  ),

  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,

  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-border-strong pl-3 text-fg-muted last:mb-0">
      {children}
    </blockquote>
  ),

  hr: () => <hr className="my-3 border-border-default" />,

  // `code` covers both inline spans and the contents of a fenced block. Only
  // the inline case is styled here; the block case is handled by `pre`, which
  // wraps it and owns the surface.
  code: ({ className, children }) => {
    const isBlock = typeof className === "string" && className.startsWith("language-");
    if (isBlock) return <code className="font-mono">{children}</code>;
    return (
      <code className="rounded-sm border border-border-default bg-surface-subtle px-1 py-px font-mono text-[0.95em] text-fg">
        {children}
      </code>
    );
  },

  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md border border-border-default bg-surface-subtle px-2.5 py-2 font-mono text-2xs leading-relaxed last:mb-0">
      {children}
    </pre>
  ),

  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border-default bg-surface-subtle px-2 py-1 text-left font-medium text-fg">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border-default px-2 py-1 align-top">{children}</td>
  ),

  // GitHub task lists arrive as checkbox inputs; they are a rendering, not a
  // control, so they must not be operable.
  input: ({ checked, type }) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        readOnly
        disabled
        className="mr-1.5 translate-y-px accent-fg-muted"
      />
    ) : null,
};

/**
 * Memoised on the text: a streaming turn re-renders on every delta, and
 * re-parsing unchanged prose on each one is wasted work.
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm break-words text-fg-secondary">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
