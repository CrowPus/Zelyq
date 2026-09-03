# Motion Primitives, vendored

These 33 components are **not ours**. They are
[Motion Primitives](https://motion-primitives.com) by ibelick, MIT licensed, copied in and patched.

| | |
|---|---|
| Upstream | https://github.com/ibelick/motion-primitives |
| Commit | `92586e62a951eb9b6bfd1cc7c8a4e6e2ab6ba17d` |
| Dated | 2026-03-19T14:09:01Z |
| Licence | MIT — see `LICENCE-UPSTREAM.md` |
| Refreshed by | `node motion-primitives/refresh.mjs` |

## Why vendored rather than fetched

Measured in `docs/motion-command.md`: the whole set is 159 KB, upstream changes roughly twice a
year, and fetching at run time would pipe unreviewed third-party code into a user's project at
generation time. Vendored, an upstream change is a diff somebody reads.

The decisive evidence arrived while proving it: **none of these components typecheck under React 19
with `strict` and `noUnusedLocals`**, which is what every Zelyq project runs on every turn. Upstream
targets React 18 and a looser config. Fetched at run time, that breaks inside a user's project with
no fix available; vendored, it is a patch we own and test.

## What was changed, and why

`refresh.mjs` applies every change as a named transform, so re-running reproduces this directory
exactly. Nothing is hand-edited.

| Transform | Files | Reason |
|---|---|---|
| `react-19-jsx-namespace` | 5 | React 19 removed the global `JSX` namespace; it is `React.JSX` now |
| `react-19-motion-create-loses-props` | 1 | once the cast is right, `motion.create` loses the element's props and `className` fails |
| `react-19-clone-element-props` | 4 | `cloneElement` on `ReactElement<unknown>` no longer matches an overload |
| `react-19-cloneelement-props` | 2 | spreading `child.props` is a spread of `unknown` |
| `react-19-type-only-jsx-import` | 3 | the `JSX` type import is unused once the namespace patch lands |
| `react-19-unused-type-imports` | 2 | React 19's JSX transform means `React` need not be in scope |
| `react-19-nullable-refs` | hooks | `useRef<T>(null)` is `RefObject<T \| null>` in React 19 |
| `spring-type-widening` | 7 | `type: 'spring'` infers as `string` and will not narrow under `strict` |
| `motion-13-use-scroll-options` | 1 | `layoutEffect` was removed from `UseScrollOptions` after v11 |
| `drop-use-client` | 33 | a Next.js directive; these projects are Vite |

Two components additionally need a fix that is genuinely about them, recorded as an explicit
override in `refresh.mjs`: `glow-effect` and `spinning-text`. **An override that stops matching
fails the refresh**, so upstream changing underneath us is loud rather than silent.

## Verified

Against a project generated from `templates/vite-react` — React 19.2.8, `motion` 13.2.0, Tailwind 4 —
importing all 33: `tsc --noEmit` clean, `vite build` clean.

## The components

| Component | Lines | Runtime deps |
|---|---:|---|
| `accordion` | 197 | motion |
| `animated-background` | 89 | motion |
| `animated-group` | 143 | motion |
| `animated-number` | 35 | motion |
| `border-trail` | 43 | motion |
| `carousel` | 351 | motion |
| `cursor` | 134 | motion |
| `dialog` | 335 | motion |
| `disclosure` | 191 | motion |
| `dock` | 226 | motion |
| `glow-effect` | 151 | motion |
| `image-comparison` | 147 | motion |
| `in-view` | 58 | motion |
| `infinite-slider` | 112 | motion, react-use-measure |
| `magnetic` | 112 | motion |
| `morphing-dialog` | 422 | motion |
| `morphing-popover` | 224 | motion |
| `progressive-blur` | 63 | motion |
| `scroll-progress` | 41 | motion |
| `sliding-number` | 122 | motion, react-use-measure |
| `spinning-text` | 104 | motion |
| `spotlight` | 85 | motion |
| `text-effect` | 294 | motion |
| `text-loop` | 72 | motion |
| `text-morph` | 73 | motion |
| `text-roll` | 102 | motion |
| `text-scramble` | 85 | motion |
| `text-shimmer` | 57 | motion |
| `text-shimmer-wave` | 88 | motion |
| `tilt` | 92 | motion |
| `toolbar-dynamic` | 90 | motion |
| `toolbar-expandable` | 186 | motion, react-use-measure |
| `transition-panel` | 48 | motion |
