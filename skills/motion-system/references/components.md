# Motion Primitives, component by component

Generated from the vendored sources in `motion-primitives/components/`. Props are what the
component actually declares — read the file itself if you need more than the shape.

Install with `add_motion({ components: ["<name>"] })`; import from `@/components/motion/<name>`.

## `accordion` — Structure

Exports: —

```ts
children: ReactNode
variants?: { expanded: Variant; collapsed: Variant }
expandedValue?: React.Key | null
onValueChange?: (value: React.Key | null) => void
```

## `animated-background` — Effect

Exports: `AnimatedBackground`

```ts
children:
| ReactElement<{ 'data-id': string }>[]
| ReactElement<{ 'data-id': string }>
defaultValue?: string
onValueChange?: (newActiveId: string | null) => void
className?: string
transition?: Transition
enableHover?: boolean
```

## `animated-group` — Wrapper

Exports: —

```ts
children: ReactNode
className?: string
variants?: {
container?: Variants
item?: Variants
}
preset?: PresetType
as?: React.ElementType
asChild?: React.ElementType
```

## `animated-number` — Number

Exports: `AnimatedNumber`

```ts
value: number
className?: string
springOptions?: SpringOptions
as?: React.ElementType
```

## `border-trail` — Effect

Exports: `BorderTrail`

```ts
className?: string
size?: number
transition?: Transition
onAnimationComplete?: () => void
style?: React.CSSProperties
```

## `carousel` — Structure

Exports: —

```ts
children: ReactNode
initialIndex?: number
onIndexChange?: (newIndex: number) => void
disableDrag?: boolean
```

## `cursor` — Effect

Exports: `Cursor`

```ts
children: React.ReactNode
className?: string
springConfig?: SpringOptions
attachToParent?: boolean
transition?: Transition
variants?: {
initial: Variant
animate: Variant
exit: Variant
}
onPositionChange?: (x: number, y: number) => void
```

## `dialog` — Structure

Exports: —  ·  needs `usePreventScroll`

```ts
children: React.ReactNode
variants?: Variants
transition?: Transition
className?: string
defaultOpen?: boolean
onOpenChange?: (open: boolean) => void
open?: boolean
```

## `disclosure` — Structure

Exports: `Disclosure`, `DisclosureTrigger`, `DisclosureContent`

```ts
children: React.ReactNode
open: boolean
onOpenChange?: (open: boolean) => void
variants?: { expanded: Variant; collapsed: Variant }
```

## `dock` — Structure

Exports: —

```ts
children: React.ReactNode
className?: string
distance?: number
panelHeight?: number
magnification?: number
spring?: SpringOptions
```

## `glow-effect` — Effect

Exports: `GlowEffect`

```ts
className?: string
style?: React.CSSProperties
colors?: string[]
mode?:
| 'rotate'
| 'pulse'
| 'breathe'
| 'colorShift'
| 'flowHorizontal'
| 'static'
blur?:
| number
| 'softest'
| 'soft'
// …
```

## `image-comparison` — Structure

Exports: —

```ts
children: React.ReactNode
className?: string
enableHover?: boolean
springOptions?: SpringOptions
```

## `in-view` — Wrapper

Exports: `InView`

```ts
children: ReactNode
variants?: {
hidden: Variant
visible: Variant
}
transition?: Transition
viewOptions?: UseInViewOptions
as?: React.ElementType
once?: boolean
```

## `infinite-slider` — Structure

Exports: `InfiniteSlider`  ·  package `react-use-measure`

```ts
children: React.ReactNode
gap?: number
speed?: number
speedOnHover?: number
direction?: 'horizontal' | 'vertical'
reverse?: boolean
className?: string
```

## `magnetic` — Effect

Exports: `Magnetic`

```ts
children: React.ReactNode
intensity?: number
range?: number
actionArea?: 'self' | 'parent' | 'global'
springOptions?: SpringOptions
```

## `morphing-dialog` — Structure

Exports: —  ·  needs `useClickOutside`

```ts
children: React.ReactNode
transition?: Transition
```

## `morphing-popover` — Structure

Exports: —  ·  needs `useClickOutside`

## `progressive-blur` — Effect

Exports: `GRADIENT_ANGLES`, `ProgressiveBlur`

## `scroll-progress` — Effect

Exports: `ScrollProgress`

```ts
className?: string
springOptions?: SpringOptions
containerRef?: RefObject<HTMLDivElement>
```

## `sliding-number` — Number

Exports: `SlidingNumber`  ·  package `react-use-measure`

## `spinning-text` — Text

Exports: `SpinningText`

```ts
children: string
style?: CSSProperties
duration?: number
className?: string
reverse?: boolean
fontSize?: number
radius?: number
transition?: Transition
variants?: {
container?: Variants
item?: Variants
}
```

## `spotlight` — Effect

Exports: `Spotlight`

```ts
className?: string
size?: number
springOptions?: SpringOptions
```

## `text-effect` — Text

Exports: `TextEffect`

```ts
children: string
per?: PerType
as?: keyof React.JSX.IntrinsicElements
variants?: {
container?: Variants
item?: Variants
}
className?: string
preset?: PresetType
delay?: number
speedReveal?: number
speedSegment?: number
trigger?: boolean
onAnimationComplete?: () => void
// …
```

## `text-loop` — Text

Exports: `TextLoop`

```ts
children: React.ReactNode[]
className?: string
interval?: number
transition?: Transition
variants?: Variants
onIndexChange?: (index: number) => void
trigger?: boolean
mode?: AnimatePresenceProps['mode']
```

## `text-morph` — Text

Exports: `TextMorph`

```ts
children: string
as?: React.ElementType
className?: string
style?: React.CSSProperties
variants?: Variants
transition?: Transition
```

## `text-roll` — Text

Exports: `TextRoll`

```ts
children: string
duration?: number
getEnterDelay?: (index: number) => number
getExitDelay?: (index: number) => number
className?: string
transition?: Transition
variants?: {
enter: {
initial: Target | VariantLabels | boolean
animate: TargetAndTransition | VariantLabels
}
exit: {
initial: Target | VariantLabels | boolean
animate: TargetAndTransition | VariantLabels
// …
```

## `text-scramble` — Text

Exports: `TextScramble`

## `text-shimmer` — Text

Exports: `TextShimmer`

```ts
children: string
as?: React.ElementType
className?: string
duration?: number
spread?: number
```

## `text-shimmer-wave` — Text

Exports: `TextShimmerWave`

```ts
children: string
as?: React.ElementType
className?: string
duration?: number
zDistance?: number
xDistance?: number
yDistance?: number
spread?: number
scaleDistance?: number
rotateYDistance?: number
transition?: Transition
```

## `tilt` — Effect

Exports: `Tilt`

```ts
children: React.ReactNode
className?: string
style?: MotionStyle
rotationFactor?: number
isRevese?: boolean
springOptions?: SpringOptions
```

## `toolbar-dynamic` — Structure

Exports: —  ·  needs `useClickOutside`

## `toolbar-expandable` — Structure

Exports: —  ·  needs `useClickOutside`  ·  package `react-use-measure`

## `transition-panel` — Structure

Exports: `TransitionPanel`
