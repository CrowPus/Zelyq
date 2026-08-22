import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionResponse } from "@zelyq/core";
import { useCallback } from "react";
import { ApiError, api } from "../lib/api";

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
    await api.logout();
    // Drop every cached answer: the next user must not see the last one's data.
    queryClient.clear();
    queryClient.setQueryData(["session"], null);
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
