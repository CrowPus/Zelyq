import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionResponse } from "@zelyq/core";
import { useCallback } from "react";
import { ApiError, api } from "../lib/api";

/**
 * Ends the local session and drops everything cached for the previous user.
 *
 * Order matters. `queryClient.clear()` removes the session query that mounted
 * components are subscribed to, so nothing is notified and the interface keeps
 * rendering the old user — signed out on the server, still signed in on screen.
 * Writing the session to null first notifies those observers; only then is the
 * rest of the cache dropped, and the session entry is preserved so it is not
 * torn out from under them again.
 */
export function clearSessionCache(queryClient: QueryClient): void {
  queryClient.setQueryData(["session"], null);
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== "session",
  });
  queryClient.cancelQueries({
    predicate: (query) => query.queryKey[0] !== "session",
  });
}

/**
 * The signed-in user, or null. A 401 is a normal answer here, not an error —
 * it is how the server says "nobody is signed in".
 */
export function useSession() {
  const queryClient = useQueryClient();

  const query = useQuery<SessionResponse | null>({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 30_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["session"] });
  }, [queryClient]);

  const signOut = useCallback(async () => {
    // Even if the request fails, the local session must end — otherwise a
    // network blip leaves someone looking at a signed-in interface they can no
    // longer use.
    await api.logout().catch(() => undefined);
    clearSessionCache(queryClient);
  }, [queryClient]);

  return {
    session: query.data ?? null,
    user: query.data?.user ?? null,
    teams: query.data?.teams ?? [],
    loading: query.isLoading,
    refresh,
    signOut,
  };
}
