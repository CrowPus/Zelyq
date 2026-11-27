import "../global.css";

import { PortalHost } from "@rn-primitives/portal";
import { Stack } from "expo-router";
import { ThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useWebColorScheme } from "@/hooks/use-web-color-scheme";
import { NAV_THEME } from "@/lib/theme";

export default function RootLayout() {
  useWebColorScheme();
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme === "dark" ? "dark" : "light";

  return (
    <SafeAreaProvider>
      <ThemeProvider value={NAV_THEME[scheme]}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <Stack screenOptions={{ headerShown: false }} />
        {/* Where dialogs, menus, popovers and tooltips appear: keep it last. */}
        <PortalHost />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
