# Component Architecture

## Principle

A component boundary is an engineering boundary, not a line-count rule.

Extract a component when it creates a useful unit of responsibility, reuse, state ownership, testing, or design-system consistency.

## Prefer native platform + primitives

Before building a component:
1. check native HTML;
2. check existing project primitives;
3. check the design system;
4. build a new abstraction only when necessary.

## Composition vs configuration

Composition works well when consumers must provide structure:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Tasks</CardTitle>
  </CardHeader>
  <CardBody><TaskList /></CardBody>
</Card>
```

Configuration works well when a design-system primitive intentionally exposes a small controlled API.

Do not turn every component into either an unbounded slot system or a 40-prop configuration object.

## Ownership

A component should have clear answers to:
- what does it render?
- what state does it own?
- which behaviors does it own?
- what comes from parent/data layer?
- what must consumers customize?

## Colocation

Colocate files when that improves discoverability:
- component;
- tests;
- stories;
- component-specific hooks;
- styles/types.

Do not force a folder-per-component convention onto a repository that uses a different clear convention.

## Presentation and data

Separate remote-data orchestration from visual rendering when it improves testing/reuse, but do not create “container/presentational” layers mechanically.

A useful boundary exists when the presentation can be rendered independently with explicit inputs and states.

## Props

Prefer:
- explicit domain language;
- narrow responsibilities;
- callback names that communicate events (`onSubmit`, `onDismiss`);
- discriminated unions for mutually exclusive modes where TypeScript is used.

Avoid boolean soup such as:

```ts
isCompact
isEditable
isReadOnly
isAdmin
isInline
isModal
```

when a smaller set of explicit variants would prevent impossible combinations.

## Reuse test

Do not abstract after seeing the same markup twice if the semantics differ.

Reuse stable concepts, not accidental visual similarity.
