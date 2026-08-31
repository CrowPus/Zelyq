# {{projectName}}

A React Native app built with [Expo](https://docs.expo.dev/) (managed workflow),
[Expo Router](https://docs.expo.dev/router/introduction/) for navigation, and
[NativeWind](https://www.nativewind.dev/) for styling.

## Run it

```bash
npm install
npm run dev        # Expo web — a dev server you can view in a browser
npm run typecheck  # tsc --noEmit
```

`npm run dev` runs `expo start --web`. Zelyq's preview panel embeds that page
directly. To run it on a device or a simulator, use the Expo CLI outside Zelyq
(`npx expo start`, then Expo Go or a dev build) — Zelyq's v1 covers the web
preview only.

The first `npm run dev` is slow: Metro builds every route once (a minute or
two on a cold machine). After that it is fast and incremental.

## Structure

```
app/
  _layout.tsx    root layout — the <Stack> navigator, imports global.css
  index.tsx      the "/" screen
  +html.tsx      web-only HTML shell (native builds ignore it)
components/
  ThemedText.tsx small example component
global.css       Tailwind entry (NativeWind reads it via metro.config.js)
public/
  zelyq-inspector.js  Zelyq's element-inspector bridge (safe to delete)
```

## This is React Native, not the DOM

Use `View` / `Text` / `Pressable` / `ScrollView` / `Image` from `react-native`
— not `div` / `span` / `button` / `a` / `img`. Text only lives inside `<Text>`.
Navigation is files under `app/` with `<Link>` / `router.push()`. Layout is
Flexbox only and `flexDirection` defaults to `column`. There is no `window`,
`document`, or `localStorage` — reach for an Expo module (`expo-image`,
`expo-haptics`, `expo-secure-store`, …) instead. `expo-secure-store` is a stub
on web preview; treat it as real storage only on a device.
