import { useQuery } from "@tanstack/react-query";
import { api, type GitHubConnection } from "../lib/api";

/** The GitHub account a repository address belongs to, when it is on github.com. */
export function githubOwnerOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^https:\/\/github\.com\/([^/\s]+)\/[^/\s]+?(?:\.git)?\/?$/i.exec(url.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * The team's GitHub, as far as a screen needs it: whether the server offers it, what is
 * connected, and whether an address is one Zelyq can reach without a token.
 */
export function useTeamGitHub(teamId: string | null | undefined) {
  const query = useQuery({
    queryKey: ["team-github", teamId],
    queryFn: () => api.teamGitHub(teamId as string),
    enabled: Boolean(teamId),
    staleTime: 60_000,
  });
  const connections: GitHubConnection[] = query.data?.connections ?? [];
  const oauth = query.data?.status.mode === "oauth";
  return {
    loading: query.isLoading,
    configured: query.data?.status.configured ?? false,
    /** GitHub can reach this server, so pushes arrive by themselves. */
    webhooks: query.data?.status.webhooks ?? false,
    connections,
    /** Zelyq adds a push trigger's webhook on GitHub itself. */
    hooks: query.data?.status.hooks ?? false,
    /**
     * True when the team's GitHub reaches this address: the account it is on (a GitHub App), or
     * any github.com repository once someone connected (their sign-in, which GitHub checks).
     */
    covers(url: string | null | undefined): boolean {
      const owner = githubOwnerOf(url);
      if (!owner) return false;
      if (oauth) return connections.length > 0;
      return connections.some((one) => one.account.login.toLowerCase() === owner);
    },
  };
}
