import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { Badge, Button, PasswordInput, Spinner } from "./ui";

/**
 * The team's own AI keys. Each team brings its own: they are used first for
 * everything the team does (its apps' chat, Ops, voice, Studio), kept
 * encrypted in the team's Vault, and never shown again.
 */
export function TeamKeys({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const keys = useQuery({ queryKey: ["team-keys", teamId], queryFn: () => api.teamKeys(teamId) });

  const done = (data: Awaited<ReturnType<typeof api.teamKeys>>) => {
    queryClient.setQueryData(["team-keys", teamId], data);
    // What the team can use changed: the model list and Studio ask again.
    for (const key of ["providers", "image-capabilities", "video-capabilities"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    setEditing(null);
    setValue("");
    setError(null);
  };
  const save = useMutation({
    mutationFn: (provider: string) => api.setTeamKey(teamId, provider, value),
    onSuccess: done,
    onError: (caught) => setError((caught as Error).message),
  });
  const remove = useMutation({
    mutationFn: (provider: string) => api.removeTeamKey(teamId, provider),
    onSuccess: done,
    onError: (caught) => setError((caught as Error).message),
  });

  if (keys.isLoading) return <Spinner />;
  const data = keys.data;
  if (!data) return null;
  const none = data.keys.every((key) => key.source === "none");

  return (
    <section className="mt-8" aria-label="AI keys">
      <h2 className="text-xs font-medium tracking-[0.06em] text-fg-muted uppercase">AI keys</h2>
      <p className="mt-1 text-xs text-fg-secondary">
        {data.usesServerKeys
          ? "This team may use the server's keys. A key of its own is used first, and paid by the team."
          : "This team pays for its own AI. Add at least one key (Claude or Gemini) to build apps; Gemini also powers Ops and voice."}{" "}
        Keys are kept encrypted in the team's Vault and never shown again.
      </p>
      {none && (
        <p className="mt-2 rounded-md border border-warning/25 bg-warning-subtle px-2.5 py-2 text-xs text-fg">
          No AI key yet: the team's apps cannot be built until{" "}
          {canManage ? "you add one below." : "a team admin adds one here."}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <ul className="mt-2 overflow-hidden rounded-lg border border-border-default bg-surface">
        {data.keys.map((key) => (
          <li
            key={key.provider}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-default px-4 py-2.5 last:border-b-0"
          >
            <KeyRound size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
            <span className="w-28 shrink-0 text-sm text-fg">{key.label}</span>
            <span className="min-w-0 flex-1">
              {key.source === "team" ? (
                <Badge tone="success">Team's own key</Badge>
              ) : key.source === "server" ? (
                <Badge tone="neutral">Server's key</Badge>
              ) : (
                <span className="text-xs text-fg-muted">No key</span>
              )}
            </span>
            {canManage && editing !== key.provider && (
              <span className="flex shrink-0 gap-1.5">
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(key.provider);
                    setValue("");
                    setError(null);
                  }}
                >
                  {key.source === "team" ? "Replace" : "Add key"}
                </Button>
                {key.source === "team" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(`Remove the team's ${key.label} key?`))
                        remove.mutate(key.provider);
                    }}
                  >
                    Remove
                  </Button>
                )}
              </span>
            )}
            {editing === key.provider && (
              <form
                className="flex w-full flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (value.trim()) save.mutate(key.provider);
                }}
              >
                <PasswordInput
                  aria-label={`${key.label} API key`}
                  placeholder="Paste the key"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  autoComplete="off"
                  className="min-w-0 flex-1"
                />
                <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <span className="w-full text-2xs text-fg-muted">Get one at {key.hint}.</span>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
