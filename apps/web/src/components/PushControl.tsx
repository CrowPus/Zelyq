import { useMutation } from "@tanstack/react-query";
import { CircleAlert, GitBranch } from "lucide-react";
import { useState } from "react";
import { ApiError, api } from "../lib/api";
import { Button, Input, Spinner } from "./ui";

/**
 * Push to a remote — manual, on-demand.
 * "Zelyq never pushes without being asked, and still never stores what you
 * give it" — nothing here is submitted until this button is clicked, and
 * neither field is kept once the request finishes, success or not.
 */
export function PushControl({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [gitUrl, setGitUrl] = useState("");
  const [gitToken, setGitToken] = useState("");

  const push = useMutation({
    mutationFn: () =>
      api.pushToRemote(projectId, {
        ...(gitUrl.trim() ? { gitUrl: gitUrl.trim() } : {}),
        ...(gitToken.trim() ? { gitToken: gitToken.trim() } : {}),
      }),
    onSuccess: () => {
      setGitUrl("");
      setGitToken("");
      setTimeout(() => {
        setOpen(false);
        push.reset();
      }, 1500);
    },
  });

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        icon={<GitBranch size={13} strokeWidth={1.75} />}
        onClick={() => setOpen((current) => !current)}
        className="max-md:px-1.5"
      >
        <span className="max-md:hidden">Push</span>
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
          <form
            onSubmit={(event) => {
              event.preventDefault();
              push.mutate();
            }}
            className="absolute top-full right-0 z-20 mt-1.5 w-80 rounded-lg border border-border-default bg-overlay p-3 shadow-overlay"
          >
            <p className="text-xs font-medium text-fg">Push to a remote</p>
            <p className="mt-0.5 text-2xs leading-relaxed text-fg-secondary">
              Only if this project already has a remote configured. Pushing for the first time needs
              the repository's address below; neither field is stored.
            </p>

            <div className="mt-2.5 flex flex-col gap-2">
              <Input
                value={gitUrl}
                onChange={(event) => setGitUrl(event.target.value)}
                placeholder="Repository URL — only needed the first time"
                aria-label="Repository URL"
              />
              <Input
                type="password"
                value={gitToken}
                onChange={(event) => setGitToken(event.target.value)}
                placeholder="Access token — only if the repository is private"
                aria-label="Repository access token"
                autoComplete="new-password"
              />
            </div>

            {push.isError && (
              <p className="mt-2 flex items-start gap-1.5 text-2xs text-danger">
                <CircleAlert size={12} strokeWidth={1.75} className="mt-px shrink-0" />
                {push.error instanceof ApiError ? push.error.message : "Could not push."}
              </p>
            )}
            {push.isSuccess && <p className="mt-2 text-2xs text-success">Pushed.</p>}

            <div className="mt-2.5 flex justify-end">
              <Button size="sm" variant="primary" type="submit" disabled={push.isPending}>
                {push.isPending ? (
                  <span className="flex items-center gap-1.5">
                    <Spinner className="size-3" /> Pushing…
                  </span>
                ) : (
                  "Push"
                )}
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
