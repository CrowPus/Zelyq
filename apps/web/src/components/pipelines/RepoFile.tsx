import { useMutation } from "@tanstack/react-query";
import { defaultRepoPath, parsePipelineFile } from "@zelyq/core";
import { Download, GitBranch, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { vaultErrorMessage } from "../../lib/vault";
import { Button, Input } from "../ui";

/**
 * Where a pipeline's file lives: only in Zelyq, or in its repository, where
 * every run reads it at its own branch or commit. Shown above the editor.
 */
export function RepoFileBar({
  teamId,
  pipelineId,
  name,
  source,
  repoPath,
  canWrite,
  onChanged,
}: {
  teamId: string;
  pipelineId: string;
  name: string;
  /** The saved file, as shown: what goes into the repository. */
  source: string;
  repoPath: string | null;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [linking, setLinking] = useState(false);
  const [path, setPath] = useState(() => repoPath ?? defaultRepoPath(name));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const repo = useMemo(() => {
    const parsed = parsePipelineFile(source);
    return parsed.ok ? (parsed.file.source?.repo ?? null) : null;
  }, [source]);

  const done = (message: string | null) => () => {
    setError(null);
    setNote(message);
    setLinking(false);
    onChanged();
  };
  const failed = (caught: unknown) => {
    setNote(null);
    setError(vaultErrorMessage(caught));
  };
  const link = useMutation({
    mutationFn: () => api.pipelines.linkRepo(teamId, pipelineId, path.trim()),
    onSuccess: done(null),
    onError: failed,
  });
  const pull = useMutation({
    mutationFn: () => api.pipelines.pullRepo(teamId, pipelineId),
    onSuccess: done("Up to date with the default branch."),
    onError: failed,
  });
  const unlink = useMutation({
    mutationFn: () => api.pipelines.unlinkRepo(teamId, pipelineId),
    onSuccess: done(null),
    onError: failed,
  });
  const busy = link.isPending || pull.isPending || unlink.isPending;

  const download = () => {
    const url = URL.createObjectURL(new Blob([source], { type: "text/yaml" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = path.split("/").pop() || "pipeline.yml";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (repoPath) {
    return (
      <section className="grid gap-2 rounded-md border border-border-default bg-surface p-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <GitBranch size={15} className="shrink-0 text-fg-secondary" aria-hidden />
          <p className="min-w-0 flex-1">
            Kept in the repository at{" "}
            <code className="rounded bg-surface-hover px-1 py-0.5 text-xs break-all">
              {repoPath}
            </code>
          </p>
          {canWrite && (
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={<RefreshCw size={12} />}
                disabled={busy}
                onClick={() => pull.mutate()}
              >
                Update from the repository
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Keep the file only in Zelyq again? Runs will use this copy, not the repository's.",
                    )
                  )
                    unlink.mutate();
                }}
              >
                Stop keeping it there
              </Button>
            </span>
          )}
        </div>
        <p className="text-xs text-fg-secondary">
          Each branch and pull request runs its own copy of this file. Below is the copy from the
          default branch: change the file in the repository, and it updates here when the default
          branch runs.
        </p>
        {note && <p className="text-xs text-success">{note}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </section>
    );
  }

  return (
    <section className="grid gap-2 rounded-md border border-border-default bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <GitBranch size={15} className="shrink-0 text-fg-muted" aria-hidden />
        <p className="min-w-0 flex-1 text-fg-secondary">This file is kept in Zelyq.</p>
        {canWrite && !linking && (
          <Button size="sm" onClick={() => setLinking(true)}>
            Keep it in the repository
          </Button>
        )}
      </div>
      {linking && (
        <div className="grid gap-3 border-t border-border-default pt-3">
          {!repo ? (
            <p className="text-xs text-warning">
              First add <code>source:</code> with <code>repo:</code> (your repository's https://
              address) to the file and save it. That is where Zelyq will read the file.
            </p>
          ) : (
            <>
              <ol className="grid list-decimal gap-1 pl-5 text-xs text-fg-secondary">
                <li>
                  Download this file and add it to <span className="break-all text-fg">{repo}</span>{" "}
                  at the path below, on the default branch.
                </li>
                <li>
                  Press <span className="text-fg">Link</span>. From then on, every run reads the
                  file from the repository, at its own branch or commit.
                </li>
              </ol>
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  link.mutate();
                }}
              >
                <label className="sr-only" htmlFor="repo-path">
                  Path in the repository
                </label>
                <Input
                  id="repo-path"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  className="min-w-0 flex-1 basis-56 font-mono text-xs"
                  spellCheck={false}
                />
                <Button size="sm" icon={<Download size={12} />} onClick={download}>
                  Download the file
                </Button>
                <Button size="sm" variant="primary" type="submit" disabled={busy || !path.trim()}>
                  Link
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setLinking(false);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </form>
            </>
          )}
          {!repo && (
            <span>
              <Button size="sm" variant="ghost" onClick={() => setLinking(false)}>
                Close
              </Button>
            </span>
          )}
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </section>
  );
}
