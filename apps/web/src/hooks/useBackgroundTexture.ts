import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "zelyq.texture";

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // Private windows and blocked site data throw on access; the texture stays on.
    return true;
  }
}

let current = typeof window === "undefined" ? true : read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether the quiet moving texture behind the pages is shown. On unless the
 * person switches it off; kept on this device only, like the theme.
 */
export function useBackgroundTexture() {
  const on = useSyncExternalStore(
    subscribe,
    () => current,
    () => true,
  );
  const setOn = useCallback((next: boolean) => {
    current = next;
    try {
      if (next) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, "off");
    } catch {
      // The choice still applies for this visit.
    }
    for (const listener of listeners) listener();
  }, []);
  return { on, setOn };
}
