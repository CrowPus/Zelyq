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
      <EmptyState
        title="No file open"
        description="Pick a file from the tree to read what the agent wrote."
      />
    );
  }

  if (loading) {
    return (
      <div className="p-4">
        <Spinner label={`Opening ${path}…`} />
      </div>
    );
  }

  if (!file) return <EmptyState title="Could not open file" description={path} />;

  if (file.encoding === "base64") {
    return (
      <EmptyState
        title="Binary file"
        description={`${path} is not text, so there is nothing to show.`}
      />
    );
  }

  const lines = file.content.split("\n");

  return (
    <div className="h-full min-w-0 overflow-auto overscroll-contain bg-slate-950">
      <table className="w-full border-collapse font-mono text-[13px] leading-6">
        <tbody>
          {lines.map((line, index) => (
            // Lines have no stable identity; the index is the identity here.
            // biome-ignore lint/suspicious/noArrayIndexKey: line number is the key
            <tr key={index} className="hover:bg-slate-900/60">
              <td className="w-12 select-none border-r border-slate-900 px-2 text-right align-top text-slate-700">
                {index + 1}
              </td>
              <td className="whitespace-pre px-3 text-slate-300">{line || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {file.truncated && (
        <p className="border-t border-slate-800 px-3 py-2 text-xs text-amber-500">
          This file is too large to display in full.
        </p>
      )}
    </div>
  );
}
