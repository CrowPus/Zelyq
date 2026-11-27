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
  _layout.tsx    root layout — theme, the <Stack> navigator, the PortalHost
  index.tsx      the "/" screen
  +html.tsx      web-only HTML shell (native builds ignore it)
components/ui/   ready components (React Native Reusables): button, text, input,
                 card, dialog, select, tabs, switch, checkbox, …
lib/theme.ts     the colours again, for the navigation bar
global.css       the design system: colour roles, light and dark
public/
  zelyq-inspector.js  Zelyq's element-inspector bridge (safe to delete)
```

## Design system

Every colour is a role (`background`, `foreground`, `card`, `primary`, `muted`,
`accent`, `destructive`, `border`, `ring`) in `global.css`, light and dark; use
the role in classes (`bg-primary`, `text-muted-foreground`), never a raw colour,
and give the app its identity by changing the values there (and in
`lib/theme.ts`). Build screens from `components/ui/` — `Button`, `Text`,
`Input`, `Card`, `Dialog`, `Select`, `Tabs`, `Switch`, `Checkbox`, `Badge`,
`Progress`, `Alert`, `Avatar`, `Popover`, `DropdownMenu`, `Tooltip` — rather
than hand-styled `Pressable`s. Text inside a `Button` is a `<Text>` from
`components/ui/text`, which picks up the button's style.

## This is React Native, not the DOM

Use `View` / `Text` / `Pressable` / `ScrollView` / `Image` from `react-native`
— not `div` / `span` / `button` / `a` / `img`. Text only lives inside `<Text>`.
Navigation is files under `app/` with `<Link>` / `router.push()`. Layout is
Flexbox only and `flexDirection` defaults to `column`. There is no `window`,
`document`, or `localStorage` — reach for an Expo module (`expo-image`,
`expo-haptics`, `expo-secure-store`, …) instead. `expo-secure-store` is a stub
on web preview; treat it as real storage only on a device.
