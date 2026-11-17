import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "zelyq.theme";

function read(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Private windows and blocked site data throw on access.
    return "system";
  }
}

/*
 * One store for the whole page, so every control that shows or changes the
 * theme (the account menu, the command palette, the toasts) agrees.
 */
let current: Theme = typeof window === "undefined" ? "system" : read();
const listeners = new Set<() => void>();

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Persistence is a convenience; the theme still applies this session.
  }
}

function set(theme: Theme) {
  current = theme;
  apply(theme);
  for (const listener of listeners) listener();
}

const media =
  typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  media?.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener("change", listener);
  };
}

/**
 * Theme selection with three states, because "follow the system" is a real
 * choice and not the absence of one. `system` leaves the attribute off so the
 * media query in the stylesheet decides. `resolved` is what is on screen.
 */
export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => "system" as Theme,
  );
  const systemDark = useSyncExternalStore(
    subscribe,
    () => media?.matches ?? false,
    () => false,
  );
  const resolved: "light" | "dark" = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const setTheme = useCallback((next: Theme) => set(next), []);
  const cycle = useCallback(() => {
    set(current === "light" ? "dark" : current === "dark" ? "system" : "light");
  }, []);
  return { theme, resolved, setTheme, cycle };
}

/** Applied before React mounts so the first paint is never the wrong colour. */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
