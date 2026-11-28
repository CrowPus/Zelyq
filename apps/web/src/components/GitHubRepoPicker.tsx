import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTeamGitHub } from "../hooks/useTeamGitHub";
import { api, type GitHubRepository } from "../lib/api";
import { t } from "../lib/i18n";
import { BrandIcon } from "./BrandIcon";
import { Button, Checkbox, Input, NativeSelect, Pressable, Spinner } from "./ui";

/**
 * The repositories the team's GitHub lets Zelyq reach, to pick one instead of pasting an
 * address and a token. With `allowCreate`, a new empty repository can be made on a connected
 * account too. Shows nothing when the team has no GitHub connected.
 */
export function GitHubRepoPicker({
  teamId,
  selected,
  onPick,
  allowCreate = false,
  suggestedName = "",
}: {
  teamId: string;
  selected?: string | null;
  onPick: (repository: GitHubRepository) => void;
  allowCreate?: boolean;
  suggestedName?: string;
}) {
  const qc = useQueryClient();
  const github = useTeamGitHub(teamId);
  const creatable = github.connections.filter((one) => one.canCreateRepositories);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(suggestedName);
  const [owner, setOwner] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);

  const repositories = useQuery({
    queryKey: ["github-repositories", teamId],
    queryFn: () => api.githubRepositories(teamId).then((r) => r.repositories),
    enabled: github.connections.length > 0,
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: () =>
      api.createGitHubRepository(teamId, {
        connectionId: owner || (creatable[0]?.id ?? ""),
        name: name.trim(),
        private: isPrivate,
      }),
    onSuccess: ({ repository }) => {
      qc.invalidateQueries({ queryKey: ["github-repositories", teamId] });
      setCreating(false);
      onPick(repository);
    },
  });

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (repositories.data ?? []).filter((repo) => repo.fullName.toLowerCase().includes(needle));
  }, [repositories.data, filter]);

  if (github.connections.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border-default p-2">
      <p className="flex items-center gap-1.5 text-2xs font-medium text-fg-secondary">
        <BrandIcon brand="github" size={12} className="text-fg-muted" />
        {t("From your GitHub")}
      </p>
      {creating ? (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          {creatable.length > 1 && (
            <NativeSelect
              aria-label={t("Account")}
              value={owner || creatable[0]?.id}
              onChange={(event) => setOwner(event.target.value)}
              className="w-full"
            >
              {creatable.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.account.login}
                </option>
              ))}
            </NativeSelect>
          )}
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("Repository name")}
            aria-label={t("Repository name")}
          />
          <div className="flex items-center gap-1.5 text-2xs text-fg-secondary">
            <Checkbox id="github-new-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
            <label htmlFor="github-new-private">{t("Private")}</label>
          </div>
          {create.isError && (
            <p className="text-2xs text-danger">{(create.error as Error).message}</p>
          )}
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" type="button" onClick={() => setCreating(false)}>
              {t("Back")}
            </Button>
            <Button size="sm" type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? <Spinner /> : null}
              {t("Create repository")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="relative">
            <Search
              size={12}
              className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-fg-muted"
              aria-hidden
            />
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t("Find a repository")}
              aria-label={t("Find a repository")}
              className="pl-6"
            />
          </div>
          {repositories.isLoading ? (
            <p className="flex items-center gap-1.5 text-2xs text-fg-secondary">
              <Spinner className="size-3" /> {t("Reading your repositories…")}
            </p>
          ) : repositories.isError ? (
            <p className="text-2xs text-danger">{(repositories.error as Error).message}</p>
          ) : (
            <ul className="max-h-44 overflow-y-auto" aria-label={t("Repositories")}>
              {shown.length === 0 && (
                <li className="px-1.5 py-1 text-2xs text-fg-muted">
                  {t("No repository here. Choose more on GitHub in Team settings → Integrations.")}
                </li>
              )}
              {shown.map((repo) => (
                <li key={repo.fullName}>
                  <Pressable
                    aria-pressed={selected === repo.cloneUrl}
                    onClick={() => onPick(repo)}
                    className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-surface-hover ${
                      selected === repo.cloneUrl
                        ? "bg-surface-hover font-medium text-fg"
                        : "text-fg-secondary"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{repo.fullName}</span>
                    {repo.private && (
                      <Lock
                        size={11}
                        className="shrink-0 text-fg-muted"
                        aria-label={t("Private")}
                      />
                    )}
                  </Pressable>
                </li>
              ))}
            </ul>
          )}
          {allowCreate && creatable.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => setCreating(true)}
              icon={<Plus size={11} aria-hidden />}
            >
              {t("New repository")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
