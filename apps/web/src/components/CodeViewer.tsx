import { useMutation } from "@tanstack/react-query";
import type { FileContent } from "@zelyq/core";
import { CircleAlert, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button, EmptyState, Spinner } from "./ui";

interface Props {
  projectId: string;
  path: string | null;
  file: FileContent | null;
  loading: boolean;
  /** Editors and above. The server decides again; this only shapes the UI. */
  canEdit: boolean;
  onSaved(path: string): void;
}

export function CodeViewer({ projectId, path, file, loading, canEdit, onSaved }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  /** What the draft was started from, so a change underneath is detectable. */
  const [base, setBase] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const gutterRef = useRef<HTMLDivElement>(null);

  const content = file?.encoding === "utf8" ? file.content : null;
  const dirty = draft !== null && base !== null && draft !== base;

  // A file the agent rewrote under an unsaved edit must not silently replace
  // it — that is somebody's work. Adopt it only when there is nothing to lose.
  useEffect(() => {
    if (content === null) {
      setDraft(null);
      setBase(null);
      setConflict(false);
      return;
    }
    setDraft((current) => {
      if (current === null || base === null || current === base) {
        setBase(content);
        setConflict(false);
        return content;
      }
      if (content !== base) setConflict(true);
      return current;
    });
    // `base` is read inside the updater; including it would re-run on every save.
    // biome-ignore lint/correctness/useExhaustiveDependencies: content is the trigger
  }, [content, path]);

  const save = useMutation({
    mutationFn: (next: string) => api.writeFile(projectId, path as string, next),
    onSuccess: (_result, next) => {
      setBase(next);
      setConflict(false);
      onSaved(path as string);
    },
  });

  // Editing a file the API only sent part of would delete the rest of it.
  const editable = canEdit && file?.encoding === "utf8" && !file.truncated;

  function commit(): void {
    if (!editable || !dirty || draft === null || save.isPending) return;
    save.mutate(draft);
  }

  if (!path) {
    return (
      <div className="h-full bg-canvas">
        <EmptyState
          title="No file open"
          description="Pick a file from the tree to read or edit what the agent wrote."
        />
      </div>
    );
  }

  const lines = (draft ?? content ?? "").split("\n").length;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-canvas">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-default bg-surface px-3">
        <span className="truncate font-mono text-xs text-fg-secondary">{path}</span>
        {dirty && <span className="shrink-0 text-2xs text-warning">unsaved</span>}

        <span className="ml-auto flex shrink-0 items-center gap-2">
          {file && !file.truncated && file.encoding === "utf8" && (
            <span className="font-mono text-2xs text-fg-muted tabular-nums">{lines} lines</span>
          )}
          {editable && (
            <Button
              size="sm"
              variant={dirty ? "primary" : "ghost"}
              disabled={!dirty || save.isPending}
              onClick={commit}
              icon={<Save size={12} strokeWidth={2} />}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </span>
      </div>

      {conflict && (
        <div className="flex items-center gap-2 border-b border-warning/25 bg-warning-subtle px-3 py-2 text-2xs text-warning">
          <CircleAlert size={13} strokeWidth={1.75} className="shrink-0" />
          <span className="min-w-0 flex-1">
            The agent changed this file while you were editing. Saving replaces its version.
          </span>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2"
            onClick={() => {
              if (content !== null) {
                setDraft(content);
                setBase(content);
              }
              setConflict(false);
            }}
          >
            Discard mine
          </button>
        </div>
      )}

      {save.isError && (
        <p className="flex items-center gap-2 border-b border-danger/25 bg-danger-subtle px-3 py-2 text-2xs text-danger">
          <CircleAlert size={13} strokeWidth={1.75} className="shrink-0" />
          {(save.error as Error).message}
        </p>
      )}

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
      ) : editable ? (
        // The gutter is a separate scroller kept in step with the textarea.
        // `wrap="off"` is what makes that sound: one line is always one row.
        <div className="flex min-h-0 flex-1">
          <div
            ref={gutterRef}
            aria-hidden="true"
            className="w-11 shrink-0 overflow-hidden border-r border-border-default py-2 font-mono text-xs leading-[1.6] text-fg-muted select-none"
          >
            {Array.from({ length: lines }, (_, index) => (
              <div key={index + 1} className="px-2 text-right tabular-nums">
                {index + 1}
              </div>
            ))}
          </div>
          <textarea
            value={draft ?? ""}
            onChange={(event) => setDraft(event.target.value)}
            onScroll={(event) => {
              if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                commit();
              }
            }}
            wrap="off"
            spellCheck={false}
            aria-label={`Edit ${path}`}
            // Fills the pane to the window edge, so the focus ring has to be
            // drawn inside it — see [data-inset-focus] in index.css. Removing
            // the ring instead would cost keyboard users their only cue.
            data-inset-focus=""
            className="min-h-0 min-w-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-2 font-mono text-xs leading-[1.6] text-fg-secondary"
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <table className="w-full border-collapse font-mono text-xs leading-[1.6]">
            <tbody>
              {(content ?? "").split("\n").map((line, index) => (
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
              This file is too large to display in full, so it cannot be edited here — saving would
              discard the part that was not sent.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
