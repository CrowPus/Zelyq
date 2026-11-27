import { colorScheme } from "nativewind";
import { useEffect } from "react";
import { Platform } from "react-native";

/**
 * Web preview only: follow the computer's light or dark setting, as a phone
 * follows its own. (On iOS and Android NativeWind already does.)
 */
export function useWebColorScheme() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const apply = () => colorScheme.set(media.matches ? "dark" : "light");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
}
