---
name: expo-react-native
description: Build and change a React Native app on Expo (managed workflow) with Expo Router and NativeWind. Use for any project on the "Expo — React Native" stack — screens, navigation, styling, state, lists, platform APIs. It is NOT a web project; the rules below are what keep that true.
---

# React Native on Expo — how this project works

This project renders with **React Native**, not the DOM. It previews in a
browser through Expo web (react-native-web), but the code is native RN: the
same files run on iOS and Android. Writing it like a web app produces
something that renders nothing on device and usually nothing on web either.

## Primitives — MUST

- Build UI from `react-native`: `View`, `Text`, `Pressable`, `ScrollView`,
  `Image`, `TextInput`, `FlatList`, `SectionList`, `Modal`, `Switch`,
  `ActivityIndicator`, `KeyboardAvoidingView`.
- **NEVER** `div`, `span`, `p`, `button`, `a`, `img`, `ul`/`li`, `input`,
  `<form>`, or any HTML element. There is no `onClick` (`onPress`), no `href`
  (`<Link href>` from `expo-router`), no `className`-less DOM.
- **All text lives inside `<Text>`.** A bare string in a `<View>` throws
  "Text strings must be rendered within a <Text> component".
- No `window`, `document`, `localStorage`, `navigator`, `alert`, DOM events,
  `URL`/`fetch`-to-same-origin assumptions, or web-only npm packages
  (`react-router-dom`, `framer-motion`, `@mui/*`, anything importing `react-dom`
  directly). `fetch` itself is fine.

## Navigation — MUST

- Routes are files under `app/`. `app/index.tsx` is `/`, `app/settings.tsx`
  is `/settings`, `app/item/[id].tsx` is a dynamic route.
- Layouts are `app/_layout.tsx` (and nested `_layout.tsx`) exporting a `<Stack>`,
  `<Tabs>`, or `<Drawer>` from `expo-router`.
- Navigate with `<Link href="/settings">` or
  `import { router } from "expo-router"; router.push("/item/42")`. Read params
  with `useLocalSearchParams()`.
- Do not hand-roll a router, a history stack, or conditional screen rendering
  in one component.

## Styling — MUST

- Prefer NativeWind: `className="flex-1 items-center gap-4 bg-white"`. It is
  wired (`global.css`, `metro.config.js`, `tailwind.config.js`, the babel
  preset). `StyleSheet.create({...})` is the alternative; both are fine, do
  not mix three systems.
- No `.css` files beyond `global.css`. No cascading, no `:hover`, no
  descendant selectors, no `@media` — use `Pressable`'s state
  (`className="active:opacity-80"` or the `({ pressed }) =>` style prop) and
  `useWindowDimensions()` / `Platform` for conditionals.
- Layout is **Flexbox only**, and `flexDirection` defaults to **`column`**,
  not `row`. `gap` works. There is no `display: grid`, no `float`, no
  `position: sticky`.
- Respect notches: wrap screens in `SafeAreaView` from
  `react-native-safe-area-context` (the template already sets up the
  provider), or use `useSafeAreaInsets()`.

## Lists, images, input — MUST

- Long or data-driven lists: `FlatList` / `SectionList` / `FlashList`, not
  `.map()` inside a `ScrollView`. Give `keyExtractor`.
- Local images: `<Image source={require("../assets/x.png")} />`. Remote images
  need an explicit `width`/`height` (or a sized parent) or they render 0×0.
  For anything real, prefer `expo-image`'s `<Image>` (better caching).
- Text input is `<TextInput>` with `value` + `onChangeText`. There is no
  `<form>` and no native submit — wire a `Pressable` that calls your handler.

## Platform APIs — reach for an Expo module

`expo-image`, `expo-haptics`, `expo-linking`, `expo-constants`,
`expo-clipboard`, `expo-file-system`, `expo-image-picker`, `expo-location`,
`expo-notifications`, `expo-secure-store`, `expo-av`. Install with
`npx expo install <name>` (not plain `npm install` — `expo install` picks the
version that matches the SDK). **`expo-secure-store` is a no-op stub on web
preview** — build against it, but do not tell the user their secret is stored
securely until it runs on a device. Anything that needs a config plugin +
native prebuild (most Bluetooth, some camera/ML modules) is out of scope for
the web preview — say so rather than adding it.

## Definition of done

- `npm run typecheck` is clean (`tsc --noEmit`).
- The Expo web preview renders the real screen on **every** route you added or
  changed — not a blank page, not a red Metro error overlay. Start the
  preview and look.
- No HTML elements, no `document`/`window`, in any `.tsx` under `app/` or
  `components/`.
- New screens are reachable through `expo-router` (a `<Link>`, a tab, or a
  `router.push`), not mounted conditionally inside another screen.
