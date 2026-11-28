import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GitStatus } from "@zelyq/core";
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  GitPullRequest,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { useTeamGitHub } from "../hooks/useTeamGitHub";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import { teamHref } from "../lib/routes";
import { BrandIcon } from "./BrandIcon";
import { GitHubRepoPicker } from "./GitHubRepoPicker";
import { Badge, Button, Drawer, Input, NativeSelect, Spinner } from "./ui";

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
 * A token is either typed here, used for one request and never stored — the
 * same promise the server keeps — or named from the team's Vault, which the
 * server reads itself, so the value never reaches this page at all.
 */
export function GitPanel({
  projectId,
  teamId,
  open,
  onOpenChange,
}: {
  projectId: string;
  teamId: string;
  /** Opened from the app's sidebar (the address says `?panel=git`). */
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
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
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t("Git")}
      description={t("Commit, push and pull this app’s code, and switch branches.")}
      actions={
        attention && (
          <span
            className={`mr-1 inline-flex h-5 items-center rounded-sm px-1.5 text-xs font-medium ${
              attention === "danger"
                ? "bg-danger-subtle text-danger"
                : "bg-warning-subtle text-warning"
            }`}
          >
            {attention === "danger" ? t("Needs attention") : t("Behind remote")}
          </span>
        )
      }
    >
      <div className="px-5 py-4">
        {status.isPending && (
          <p className="flex items-center gap-1.5 text-sm text-fg-secondary">
            <Spinner className="size-3" /> {t("Reading this app’s git…")}
          </p>
        )}
        {status.isError && (
          <Message tone="danger">
            {status.error instanceof ApiError
              ? status.error.message
              : t("Could not read this app’s git.")}
          </Message>
        )}
        {state && <GitBody projectId={projectId} teamId={teamId} state={state} />}
      </div>
    </Drawer>
  );
}

function GitBody({
  projectId,
  teamId,
  state,
}: {
  projectId: string;
  teamId: string;
  state: GitStatus;
}) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  // Only the secret's name is remembered, per app, so the next push needs no
  // choosing. The name is not the credential; the value stays on the server.
  const [vaultName, setVaultNameState] = useState(() => readVaultChoice(projectId));
  const [source, setSource] = useState<"paste" | "vault">(vaultName ? "vault" : "paste");
  const setVaultName = (name: string) => {
    setVaultNameState(name);
    writeVaultChoice(projectId, name);
  };
  /** What every git request carries: a pasted token, a Vault name, or nothing. */
  const credential = (): { gitToken?: string; gitTokenVault?: string } =>
    covered
      ? {}
      : source === "vault"
        ? vaultName
          ? { gitTokenVault: vaultName }
          : {}
        : token.trim()
          ? { gitToken: token.trim() }
          : {};
  const [remoteUrl, setRemoteUrl] = useState("");
  const github = useTeamGitHub(teamId);
  /** The team's GitHub reaches this app's repository: no token to give. */
  const covered = github.covers(state.remote ?? remoteUrl);
  const hasCredential =
    covered || (source === "vault" ? Boolean(vaultName) : Boolean(token.trim()));
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
      text: error instanceof ApiError ? error.message : t("That did not work."),
    });
  };

  const fetchRemote = useMutation({
    mutationFn: () => api.gitFetch(projectId, credential()),
    onSuccess: ({ status }) => {
      refresh(status);
      setNote({
        tone: status.behind > 0 ? "warning" : "success",
        text:
          status.behind > 0
            ? t("The remote has {behind} commit(s) this project does not.", {
                behind: status.behind,
              })
            : t("Up to date with the remote."),
      });
    },
    onError: fail,
  });

  const pull = useMutation({
    mutationFn: (strategy: "ff-only" | "rebase" | "merge") =>
      api.gitPull(projectId, {
        strategy,
        onConflict: "abort",
        ...credential(),
      }),
    onSuccess: ({ status }) => {
      refresh(status);
      setDiverged(null);
      setNote({
        tone: "success",
        text: status.pulled ? t("Pulled the remote’s changes in.") : t("Already up to date."),
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
        ...credential(),
      }),
    onSuccess: ({ status, branch, committed, commits, pulled }) => {
      refresh(status);
      setRemoteUrl("");
      // "Pushed." on a push that sent nothing is how a stale remote goes
      // unnoticed: say what actually travelled, including when that is nothing.
      const sent =
        commits === 0
          ? t("{branch} was already up to date — nothing new to send.", { branch })
          : t("Pushed {commits, plural, one {# commit} other {# commits}} to {branch}.", {
              commits,
              branch,
            });
      const before =
        committed && pulled
          ? t("Committed your uncommitted changes and brought in the remote’s work first.")
          : committed
            ? t("Committed your uncommitted changes first.")
            : pulled
              ? t("Brought in the remote’s work first.")
              : "";
      setNote({
        tone: "success",
        text: before ? `${before} ${sent}` : sent,
      });
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
      setNote({ tone: "success", text: t("This app now pushes to the new address.") });
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
    mutationFn: () => api.createPullRequest(projectId, { title: prTitle.trim(), ...credential() }),
    onSuccess: ({ pullRequest: result, status }) => {
      refresh(status);
      setPrTitle("");
      setPane("main");
      if (result.url) {
        setNote({
          tone: "success",
          text: result.existing
            ? t("Updated the open pull request for {branch}.", { branch: result.branch })
            : t("Opened a pull request for {branch}.", { branch: result.branch }),
        });
        window.open(result.url, "_blank", "noopener");
      } else if (result.compareUrl) {
        setNote({
          tone: "warning",
          text: t(
            "Pushed {branch}, but the pull request could not be opened for you. Opening the compare page instead.",
            { branch: result.branch },
          ),
        });
        window.open(result.compareUrl, "_blank", "noopener");
      } else {
        setNote({
          tone: "warning",
          text: t(
            "Pushed {branch}. This host is not GitHub, so open the pull request there yourself.",
            { branch: result.branch },
          ),
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
            ? t(
                "A {inProgress} was started here and never finished. Turns are paused until it is resolved, so the agent cannot commit half-merged files.",
                { inProgress: state.inProgress },
              )
            : t(
                "{conflictCount} file(s) still have conflicts. Turns are paused until it is resolved, so the agent cannot commit half-merged files.",
                { conflictCount: state.conflicts.length },
              )}
        </Message>
      )}

      {pane === "main" && (
        <>
          {covered ? (
            <ConnectedNote />
          ) : (
            <TokenField
              value={token}
              onChange={setToken}
              teamId={teamId}
              source={source}
              onSource={setSource}
              vaultName={vaultName}
              onVaultName={setVaultName}
            />
          )}

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
              {fetchRemote.isPending ? t("Checking…") : t("Check remote")}
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
              {pull.isPending ? t("Pulling…") : t("Pull")}
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
              {push.isPending ? t("Pushing…") : t("Push")}
            </Button>
          </div>

          {!state.remote && (
            <>
              <GitHubRepoPicker
                teamId={teamId}
                selected={remoteUrl.trim()}
                onPick={(repo) => setRemoteUrl(repo.cloneUrl)}
                allowCreate
              />
              <RemoteField
                value={remoteUrl}
                onChange={setRemoteUrl}
                label={t("This app has no remote yet. Paste the repository address to push to.")}
              />
            </>
          )}

          {diverged && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-2">
              <p className="text-2xs leading-relaxed text-fg-secondary">
                {t(
                  "Both sides have moved on — {ahead} commit(s) here, {behind} on the remote. Combining them is a choice:",
                  { ahead: diverged.ahead, behind: diverged.behind },
                )}
              </p>
              <div className="mt-2 flex gap-1.5">
                <Button size="sm" disabled={busy} onClick={() => pull.mutate("rebase")}>
                  {t("Replay mine on top")}
                </Button>
                <Button size="sm" disabled={busy} onClick={() => pull.mutate("merge")}>
                  {t("Keep both, merge")}
                </Button>
              </div>
              <p className="mt-1.5 text-2xs text-fg-muted">
                {t(
                  "Either way, if the same lines were changed on both sides nothing is applied and this project is left exactly as it is now.",
                )}
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
              {t("Open a pull request")}
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
              {state.remote ? t("Change remote") : t("Set remote")}
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
          <GitHubRepoPicker
            teamId={teamId}
            selected={remoteUrl.trim()}
            onPick={(repo) => {
              setRemoteUrl(repo.cloneUrl);
              setConfirmReplace(null);
            }}
            allowCreate
          />
          <RemoteField
            value={remoteUrl}
            onChange={(next) => {
              setRemoteUrl(next);
              setConfirmReplace(null);
            }}
            label={t("Where this app pushes to. There is only ever one.")}
          />

          {confirmReplace && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-2">
              <p className="text-2xs leading-relaxed text-fg-secondary">
                {t("This project currently pushes to")} <Mono>{confirmReplace}</Mono>
                {t(". Point it at ")}
                <Mono>{remoteUrl.trim()}</Mono>{" "}
                {t(
                  "instead? Commits already made stay in this app — they simply will not go to the old address any more.",
                )}
              </p>
              <div className="mt-2 flex gap-1.5">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => setRemote.mutate(true)}
                >
                  {t("Yes, repoint it")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmReplace(null)}>
                  {t("Cancel")}
                </Button>
              </div>
            </div>
          )}

          {!confirmReplace && (
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setPane("main")} type="button">
                {t("Back")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                type="submit"
                disabled={busy || !remoteUrl.trim()}
              >
                {t("Save")}
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
            {t(
              "Puts this work on its own branch and proposes it, instead of pushing straight at the shared one. GitHub repositories get a real pull request; anywhere else the branch is pushed for you to open one yourself.",
            )}
          </p>
          <Input
            value={prTitle}
            onChange={(event) => setPrTitle(event.target.value)}
            placeholder={t("What does this change?")}
            aria-label={t("Pull request title")}
          />
          {covered ? (
            <ConnectedNote />
          ) : (
            <TokenField
              value={token}
              onChange={setToken}
              teamId={teamId}
              source={source}
              onSource={setSource}
              vaultName={vaultName}
              onVaultName={setVaultName}
              required
            />
          )}
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setPane("main")} type="button">
              {t("Back")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              type="submit"
              icon={<GitPullRequest size={12} strokeWidth={1.75} />}
              disabled={busy || !prTitle.trim() || !hasCredential}
            >
              {pullRequest.isPending ? t("Opening…") : t("Open")}
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
        {t(
          "This project does not have a git history yet. Sending a turn starts one, and so does the first push.",
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{state.branch ?? t("detached")}</Badge>
        {state.ahead > 0 && (
          <Badge tone="info">{t("{ahead} to push", { ahead: state.ahead })}</Badge>
        )}
        {state.behind > 0 && (
          <Badge tone="warning">{t("{behind} to pull", { behind: state.behind })}</Badge>
        )}
        {state.dirty && <Badge tone="neutral">{t("uncommitted")}</Badge>}
        {state.commits === 0 && <Badge tone="neutral">{t("no commits")}</Badge>}
      </div>
      <p className="truncate text-2xs text-fg-secondary" title={state.remote ?? undefined}>
        {state.remote ? <Mono>{state.remote}</Mono> : t("No remote set")}
      </p>
      {state.remote && (
        <p className="text-2xs text-fg-muted">
          {state.fetchedAt
            ? t("Last checked {fetchedAt}. Counts are from then.", {
                fetchedAt: relative(state.fetchedAt),
              })
            : t("Never checked the remote — the counts above cannot be known yet.")}
        </p>
      )}
    </div>
  );
}

/** In place of the token field when the team's GitHub reaches the repository. */
function ConnectedNote() {
  return (
    <p className="flex items-center gap-1.5 text-2xs text-fg-secondary">
      <BrandIcon brand="github" size={12} className="text-fg-muted" />
      {t("Connected through the team’s GitHub: no token needed.")}
    </p>
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
        aria-label={t("Repository URL")}
      />
    </div>
  );
}

export function TokenField({
  value,
  onChange,
  teamId,
  source,
  onSource,
  vaultName,
  onVaultName,
  required,
}: {
  value: string;
  onChange: (next: string) => void;
  teamId: string;
  source: "paste" | "vault";
  onSource: (next: "paste" | "vault") => void;
  vaultName: string;
  onVaultName: (next: string) => void;
  required?: boolean;
}) {
  const choices = useQuery({
    queryKey: ["vault-choices", teamId],
    queryFn: () => api.vault.choices({ kind: "team", teamId }).then((r) => r.choices),
    enabled: source === "vault",
  });
  const usable = choices.data?.filter((choice) => choice.selectable) ?? [];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1 rounded-md bg-canvas p-0.5 text-2xs">
        {(
          [
            ["paste", t("Paste token")],
            ["vault", t("From Vault")],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={source === value}
            onClick={() => onSource(value)}
            className={`flex-1 rounded px-2 py-1 font-medium ${
              source === value ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {source === "paste" ? (
        <Input
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={
            required
              ? t("Access token — needed to open a pull request")
              : t("Access token — if it is private")
          }
          aria-label={t("Repository access token")}
          autoComplete="new-password"
        />
      ) : choices.isPending ? (
        <p className="flex items-center gap-1.5 text-2xs text-fg-secondary">
          <Spinner className="size-3" /> {t("Reading your team’s Vault…")}
        </p>
      ) : choices.isError ? (
        <Message tone="danger">
          {choices.error instanceof ApiError
            ? choices.error.message
            : t("Could not read your team’s Vault.")}
        </Message>
      ) : usable.length === 0 ? (
        <p className="text-2xs leading-relaxed text-fg-secondary">
          {t("Your team’s Vault has no secret you can use here yet. {link}, then choose it here.", {
            link: (
              <Link
                to={teamHref(`/vault?scope=${teamId}`)}
                className="underline underline-offset-2"
              >
                {t("Add your git token to Vault")}
              </Link>
            ),
          })}
        </p>
      ) : (
        <NativeSelect
          aria-label={t("Repository access token from Vault")}
          value={usable.some((choice) => choice.name === vaultName) ? vaultName : ""}
          onChange={(event) => onVaultName(event.target.value)}
          className="w-full"
        >
          <option value="">{t("Choose the secret holding your token…")}</option>
          {usable.map((choice) => (
            <option key={choice.name} value={choice.name}>
              {choice.name}
              {choice.protected ? t(" · Protected") : ""}
            </option>
          ))}
        </NativeSelect>
      )}
    </div>
  );
}

/** The Vault secret this app last pushed with — its name only, in this browser. */
function readVaultChoice(projectId: string): string {
  try {
    return localStorage.getItem(`zelyq.git.vault.${projectId}`) ?? "";
  } catch {
    return "";
  }
}

function writeVaultChoice(projectId: string, name: string): void {
  try {
    if (name) localStorage.setItem(`zelyq.git.vault.${projectId}`, name);
    else localStorage.removeItem(`zelyq.git.vault.${projectId}`);
  } catch {
    /* Remembering is a convenience; private browsing simply asks again. */
  }
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
  if (seconds < 60) return t("just now");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60)
    return t("{minutes, plural, one {# minute} other {# minutes}} ago", { minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("{hours, plural, one {# hour} other {# hours}} ago", { hours });
  const days = Math.round(hours / 24);
  return t("{days, plural, one {# day} other {# days}} ago", { days });
}
