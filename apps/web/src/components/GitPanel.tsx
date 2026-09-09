import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GitStatus } from "@zelyq/core";
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  GitBranch,
  GitPullRequest,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { ApiError, api } from "../lib/api";
import { Badge, Button, Input, Spinner } from "./ui";

/**
 * Everything a project's git can do, in one place, showing the real state
 * rather than making someone infer it from whether the last button worked.
 *
 * The shape of this panel follows one rule: **never let an action be a
 * surprise.** Every destructive or externally-visible thing here says what it
 * is about to do before it does it — the remote is shown before a push, a
 * divergence is spelled out with both counts before it offers a way to combine
 * them, and changing where a project points asks a second time, naming both
 * addresses. The mistakes this is designed against are the quiet ones: pushing
 * to the wrong repository, or a pull that silently swallows a collaborator's
 * work.
 *
 * Tokens are typed here, used for one request, and never stored — the same
 * promise the server keeps.
 */
export function GitPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);

  const status = useQuery({
    queryKey: ["git", projectId],
    queryFn: () => api.gitStatus(projectId).then((response) => response.status),
    // Only while someone is looking at it. The request costs no network on the
    // server either, but a closed panel has no reason to ask.
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  });

  const state = status.data;
  const attention = state
    ? state.conflicts.length > 0 || state.inProgress !== null
      ? "danger"
      : state.behind > 0
        ? "warning"
        : null
    : null;

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        icon={<GitBranch size={13} strokeWidth={1.75} />}
        onClick={() => setOpen((current) => !current)}
        className="max-md:px-1.5"
      >
        <span className="max-md:hidden">Git</span>
        {attention && (
          <span
            aria-hidden
            className={`ml-1 size-1.5 rounded-full ${
              attention === "danger" ? "bg-danger" : "bg-warning"
            }`}
          />
        )}
      </Button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-full right-0 z-20 mt-1.5 w-[22rem] rounded-lg border border-border-default bg-overlay p-3 shadow-overlay">
            {status.isPending && (
              <p className="flex items-center gap-1.5 text-2xs text-fg-secondary">
                <Spinner className="size-3" /> Reading this project's git…
              </p>
            )}
            {status.isError && (
              <Message tone="danger">
                {status.error instanceof ApiError
                  ? status.error.message
                  : "Could not read this project's git."}
              </Message>
            )}
            {state && <GitBody projectId={projectId} state={state} />}
          </div>
        </>
      )}
    </div>
  );
}

function GitBody({ projectId, state }: { projectId: string; state: GitStatus }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [pane, setPane] = useState<"main" | "remote" | "pr">("main");
  const [note, setNote] = useState<{ tone: Tone; text: string } | null>(null);
  /** Set when the server refused to repoint an existing remote without confirmation. */
  const [confirmReplace, setConfirmReplace] = useState<string | null>(null);
  /** Set when the histories have diverged and the user has to choose how to combine them. */
  const [diverged, setDiverged] = useState<{ ahead: number; behind: number } | null>(null);

  const refresh = (next: GitStatus) => {
    queryClient.setQueryData(["git", projectId], next);
  };
  const fail = (error: unknown) => {
    setNote({
      tone: "danger",
      text: error instanceof ApiError ? error.message : "That did not work.",
    });
  };

  const fetchRemote = useMutation({
    mutationFn: () => api.gitFetch(projectId, token.trim() ? { gitToken: token.trim() } : {}),
    onSuccess: ({ status }) => {
      refresh(status);
      setNote({
        tone: status.behind > 0 ? "warning" : "success",
        text:
          status.behind > 0
            ? `The remote has ${status.behind} commit(s) this project does not.`
            : "Up to date with the remote.",
      });
    },
    onError: fail,
  });

  const pull = useMutation({
    mutationFn: (strategy: "ff-only" | "rebase" | "merge") =>
      api.gitPull(projectId, {
        strategy,
        onConflict: "abort",
        ...(token.trim() ? { gitToken: token.trim() } : {}),
      }),
    onSuccess: ({ status }) => {
      refresh(status);
      setDiverged(null);
      setNote({
        tone: "success",
        text: status.pulled ? "Pulled the remote's changes in." : "Already up to date.",
      });
    },
    onError: (error) => {
      // The server sends both counts back with this one, which is what turns
      // "it failed" into a choice the user can actually make.
      const details = error instanceof ApiError ? error.details : undefined;
      if (details && typeof details.ahead === "number" && Array.isArray(details.strategies)) {
        setDiverged({ ahead: details.ahead as number, behind: details.behind as number });
      }
      fail(error);
    },
  });

  const push = useMutation({
    mutationFn: () =>
      api.pushToRemote(projectId, {
        ...(remoteUrl.trim() ? { gitUrl: remoteUrl.trim() } : {}),
        ...(token.trim() ? { gitToken: token.trim() } : {}),
      }),
    onSuccess: ({ status, branch }) => {
      refresh(status);
      setRemoteUrl("");
      setNote({ tone: "success", text: `Pushed ${branch}.` });
    },
    onError: fail,
  });

  const setRemote = useMutation({
    mutationFn: (replace: boolean) =>
      api.setGitRemote(projectId, { gitUrl: remoteUrl.trim(), replace }),
    onSuccess: ({ status }) => {
      refresh(status);
      setRemoteUrl("");
      setConfirmReplace(null);
      setPane("main");
      setNote({ tone: "success", text: "This project now pushes to the new address." });
    },
    onError: (error) => {
      const current =
        error instanceof ApiError
          ? (error.details?.currentRemote as string | undefined)
          : undefined;
      if (current) {
        setConfirmReplace(current);
        return;
      }
      fail(error);
    },
  });

  const pullRequest = useMutation({
    mutationFn: () =>
      api.createPullRequest(projectId, { title: prTitle.trim(), gitToken: token.trim() }),
    onSuccess: ({ pullRequest: result, status }) => {
      refresh(status);
      setPrTitle("");
      setPane("main");
      if (result.url) {
        setNote({
          tone: "success",
          text: `${result.existing ? "Updated the open" : "Opened a"} pull request for ${result.branch}.`,
        });
        window.open(result.url, "_blank", "noopener");
      } else if (result.compareUrl) {
        setNote({
          tone: "warning",
          text: `Pushed ${result.branch}, but the pull request could not be opened for you. Opening the compare page instead.`,
        });
        window.open(result.compareUrl, "_blank", "noopener");
      } else {
        setNote({
          tone: "warning",
          text: `Pushed ${result.branch}. This host is not GitHub, so open the pull request there yourself.`,
        });
      }
    },
    onError: fail,
  });

  const busy =
    fetchRemote.isPending ||
    pull.isPending ||
    push.isPending ||
    setRemote.isPending ||
    pullRequest.isPending;

  const blocked = state.inProgress !== null || state.conflicts.length > 0;

  return (
    <div className="flex flex-col gap-2.5">
      <Summary state={state} />

      {blocked && (
        <Message tone="danger">
          {state.inProgress
            ? `A ${state.inProgress} was started here and never finished.`
            : `${state.conflicts.length} file(s) still have conflicts.`}{" "}
          Turns are paused until it is resolved, so the agent cannot commit half-merged files.
        </Message>
      )}

      {pane === "main" && (
        <>
          <TokenField value={token} onChange={setToken} />

          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshCw size={12} strokeWidth={1.75} />}
              disabled={busy || !state.remote}
              onClick={() => {
                setNote(null);
                fetchRemote.mutate();
              }}
            >
              {fetchRemote.isPending ? "Checking…" : "Check remote"}
            </Button>

            <Button
              size="sm"
              variant="secondary"
              icon={<ArrowDown size={12} strokeWidth={1.75} />}
              disabled={busy || !state.remote || blocked}
              onClick={() => {
                setNote(null);
                setDiverged(null);
                pull.mutate("ff-only");
              }}
            >
              {pull.isPending ? "Pulling…" : "Pull"}
            </Button>

            <Button
              size="sm"
              variant="primary"
              icon={<ArrowUp size={12} strokeWidth={1.75} />}
              disabled={busy || blocked}
              onClick={() => {
                setNote(null);
                push.mutate();
              }}
            >
              {push.isPending ? "Pushing…" : "Push"}
            </Button>
          </div>

          {!state.remote && (
            <RemoteField
              value={remoteUrl}
              onChange={setRemoteUrl}
              label="This project has no remote yet. Paste the repository address to push to."
            />
          )}

          {diverged && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-2">
              <p className="text-2xs leading-relaxed text-fg-secondary">
                Both sides have moved on — {diverged.ahead} commit(s) here, {diverged.behind} on the
                remote. Combining them is a choice:
              </p>
              <div className="mt-2 flex gap-1.5">
                <Button size="sm" disabled={busy} onClick={() => pull.mutate("rebase")}>
                  Replay mine on top
                </Button>
                <Button size="sm" disabled={busy} onClick={() => pull.mutate("merge")}>
                  Keep both, merge
                </Button>
              </div>
              <p className="mt-1.5 text-2xs text-fg-muted">
                Either way, if the same lines were changed on both sides nothing is applied and this
                project is left exactly as it is now.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border-subtle pt-2">
            <button
              type="button"
              className="text-2xs text-fg-secondary underline-offset-2 hover:underline"
              onClick={() => {
                setNote(null);
                setPane("pr");
              }}
            >
              Open a pull request
            </button>
            <button
              type="button"
              className="text-2xs text-fg-secondary underline-offset-2 hover:underline"
              onClick={() => {
                setNote(null);
                setRemoteUrl(state.remote ?? "");
                setPane("remote");
              }}
            >
              {state.remote ? "Change remote" : "Set remote"}
            </button>
          </div>
        </>
      )}

      {pane === "remote" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setNote(null);
            setRemote.mutate(false);
          }}
          className="flex flex-col gap-2"
        >
          <RemoteField
            value={remoteUrl}
            onChange={(next) => {
              setRemoteUrl(next);
              setConfirmReplace(null);
            }}
            label="Where this project pushes to. There is only ever one."
          />

          {confirmReplace && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-2">
              <p className="text-2xs leading-relaxed text-fg-secondary">
                This project currently pushes to <Mono>{confirmReplace}</Mono>. Point it at{" "}
                <Mono>{remoteUrl.trim()}</Mono> instead? Commits already made stay in this project —
                they simply will not go to the old address any more.
              </p>
              <div className="mt-2 flex gap-1.5">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => setRemote.mutate(true)}
                >
                  Yes, repoint it
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmReplace(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {!confirmReplace && (
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setPane("main")} type="button">
                Back
              </Button>
              <Button
                size="sm"
                variant="primary"
                type="submit"
                disabled={busy || !remoteUrl.trim()}
              >
                Save
              </Button>
            </div>
          )}
        </form>
      )}

      {pane === "pr" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setNote(null);
            pullRequest.mutate();
          }}
          className="flex flex-col gap-2"
        >
          <p className="text-2xs leading-relaxed text-fg-secondary">
            Puts this work on its own branch and proposes it, instead of pushing straight at the
            shared one. GitHub repositories get a real pull request; anywhere else the branch is
            pushed for you to open one yourself.
          </p>
          <Input
            value={prTitle}
            onChange={(event) => setPrTitle(event.target.value)}
            placeholder="What does this change?"
            aria-label="Pull request title"
          />
          <TokenField value={token} onChange={setToken} required />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setPane("main")} type="button">
              Back
            </Button>
            <Button
              size="sm"
              variant="primary"
              type="submit"
              icon={<GitPullRequest size={12} strokeWidth={1.75} />}
              disabled={busy || !prTitle.trim() || !token.trim()}
            >
              {pullRequest.isPending ? "Opening…" : "Open"}
            </Button>
          </div>
        </form>
      )}

      {note && <Message tone={note.tone}>{note.text}</Message>}
    </div>
  );
}

/** The facts, stated plainly, above every action that depends on them. */
function Summary({ state }: { state: GitStatus }) {
  if (!state.repository) {
    return (
      <p className="text-2xs leading-relaxed text-fg-secondary">
        This project does not have a git history yet. Sending a turn starts one, and so does the
        first push.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{state.branch ?? "detached"}</Badge>
        {state.ahead > 0 && <Badge tone="info">{state.ahead} to push</Badge>}
        {state.behind > 0 && <Badge tone="warning">{state.behind} to pull</Badge>}
        {state.dirty && <Badge tone="neutral">uncommitted</Badge>}
        {state.commits === 0 && <Badge tone="neutral">no commits</Badge>}
      </div>
      <p className="truncate text-2xs text-fg-secondary" title={state.remote ?? undefined}>
        {state.remote ? <Mono>{state.remote}</Mono> : "No remote set"}
      </p>
      {state.remote && (
        <p className="text-2xs text-fg-muted">
          {state.fetchedAt
            ? `Last checked ${relative(state.fetchedAt)}. Counts are from then.`
            : "Never checked the remote — the counts above cannot be known yet."}
        </p>
      )}
    </div>
  );
}

function RemoteField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-2xs leading-relaxed text-fg-secondary">{label}</p>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://github.com/owner/repository.git"
        aria-label="Repository URL"
      />
    </div>
  );
}

function TokenField({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
}) {
  return (
    <Input
      type="password"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={
        required
          ? "Access token — needed to open a pull request"
          : "Access token — if it is private"
      }
      aria-label="Repository access token"
      autoComplete="new-password"
    />
  );
}

type Tone = "danger" | "warning" | "success";

function Message({ tone, children }: { tone: Tone; children: ReactNode }) {
  const colour =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-success";
  const Icon = tone === "danger" ? CircleAlert : tone === "warning" ? TriangleAlert : null;
  return (
    <p className={`flex items-start gap-1.5 text-2xs leading-relaxed ${colour}`}>
      {Icon && <Icon size={12} strokeWidth={1.75} className="mt-px shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[0.95em]">{children}</span>;
}

/** "4 minutes ago" — enough to judge whether a count is still worth trusting. */
function relative(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
