import { useSyncExternalStore } from "react";
import type { ArticleId } from "../../help/articles";

/* The panel is opened from anywhere (the help menu, a link in a page), so its
 * state lives outside React. It is kept apart from the panel so the panel's
 * code (and the Markdown it shows) loads only once help is first opened.
 * `opened` counts openings, so asking again while open still picks the article. */
export type HelpState = { open: boolean; article: ArticleId | null; opened: number };
let state: HelpState = { open: false, article: null, opened: 0 };
const listeners = new Set<() => void>();

export function setHelpState(next: Partial<HelpState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}
/** Opens help on an article, or on the one for the page being viewed. */
export function openHelp(article: ArticleId | null = null) {
  setHelpState({ open: true, article, opened: state.opened + 1 });
}
export function useHelpState(): HelpState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}
