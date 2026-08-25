# Recipe: Orbit Sequence

## Use when
The subject must be understood from multiple sides.

## Safer default
Keep camera mostly stable and rotate the product around a correct pivot. Use a true camera orbit when environment/spatial relationships matter.

## Object rotation

```js
tl.to(product.rotation, {
  y: Math.PI * 0.65,
  duration: 2
})
```

## True orbit

```js
camera.position.set(
  target.x + Math.cos(angle) * radius,
  height,
  target.z + Math.sin(angle) * radius
)
camera.lookAt(target)
```

Interpolate angle/target deterministically.

## Failures
- off-center pivot;
- clipping through geometry;
- unstable reflections;
- copy safe-area violation;
- reverse scroll creates a discontinuity.

Review quarter-turn frames, not only endpoints.
