import { useSyncExternalStore } from "react";

/*
 * A tiny store so any button anywhere can open the palette or the shortcut
 * sheet without threading props through the tree. It lives apart from the
 * palette so the palette's code loads only when it is wanted.
 */
export type PaletteOpen = "none" | "palette" | "shortcuts";
let state: PaletteOpen = "none";
const listeners = new Set<() => void>();

export function setPaletteOpen(next: PaletteOpen) {
  state = next;
  for (const listener of listeners) listener();
}
export const openCommandPalette = () => setPaletteOpen("palette");
export const openShortcuts = () => setPaletteOpen("shortcuts");
export const paletteOpen = () => state;

export function usePaletteOpen(): PaletteOpen {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => "none" as PaletteOpen,
  );
}
