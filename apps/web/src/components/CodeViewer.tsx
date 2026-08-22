import type { FileContent } from "@zelyq/core";
import { EmptyState, Spinner } from "./ui";

interface Props {
  path: string | null;
  file: FileContent | null;
  loading: boolean;
}

export function CodeViewer({ path, file, loading }: Props) {
  if (!path) {
    return (
      <div className="h-full bg-canvas">
        <EmptyState
          title="No file open"
          description="Pick a file from the tree to read what the agent wrote."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-canvas">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-default bg-surface px-3">
        <span className="truncate font-mono text-xs text-fg-secondary">{path}</span>
        {file && !file.truncated && file.encoding === "utf8" && (
          <span className="ml-auto shrink-0 font-mono text-2xs text-fg-muted tabular-nums">
            {file.content.split("\n").length} lines
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-fg-muted">
          <Spinner /> Opening {path}…
        </div>
      ) : !file ? (
        <EmptyState title="Could not open file" description={path} />
      ) : file.encoding === "base64" ? (
        <EmptyState
          title="Binary file"
          description={`${path} is not text, so there is nothing to show.`}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <table className="w-full border-collapse font-mono text-xs leading-[1.6]">
            <tbody>
              {file.content.split("\n").map((line, index) => (
                // Lines have no stable identity; the line number is the identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: line number is the key
                <tr key={index} className="hover:bg-surface-hover">
                  <td className="w-11 shrink-0 border-r border-border-default px-2 text-right align-top text-fg-muted select-none tabular-nums">
                    {index + 1}
                  </td>
                  <td className="px-3 whitespace-pre text-fg-secondary">{line || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {file.truncated && (
            <p className="border-t border-border-default px-3 py-2 text-2xs text-warning">
              This file is too large to display in full.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
