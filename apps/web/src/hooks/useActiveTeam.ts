import type { TeamMembership } from "@zelyq/core";
import { useCallback, useSyncExternalStore } from "react";
import { useSession } from "./useSession";

const KEY = "zelyq.activeTeam";
const EVENT = "zelyq:active-team";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The team you are working in — chosen once, at the top of the sidebar, and
 * used everywhere: which apps are listed, where a new app goes, which Vault
 * opens. Remembered per browser; a stored team you no longer belong to falls
 * back to your first one, so it can never point at nothing.
 */
export function useActiveTeam(): {
  team: TeamMembership | undefined;
  teams: TeamMembership[];
  setTeam: (teamId: string) => void;
} {
  const { teams } = useSession();
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const team = teams.find((t) => t.id === stored) ?? teams[0];
  const setTeam = useCallback((teamId: string) => {
    try {
      localStorage.setItem(KEY, teamId);
    } catch {
      // Without storage the choice cannot be kept; the first team stays.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { team, teams, setTeam };
}
