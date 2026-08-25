# 3D Asset Pipeline

## Runtime format

Prefer glTF 2.0 / GLB for normal web-delivered 3D assets unless the project has a strong reason otherwise.

## Inspect first

Run:

```bash
scripts/inspect-glb path/to/model.glb
```

Inspect:
- transfer size;
- mesh/primitive count;
- vertices/triangles;
- material count;
- texture dimensions and formats;
- animation clips;
- unused data;
- compression extensions.

Optimization is diagnostic, not ritual.

## Geometry compression

### Meshopt
Useful general-purpose compression for glTF geometry and related data.

### Draco
Can significantly reduce geometry transfer size but introduces decode cost on the client.

Smaller bytes do not automatically mean faster user experience.

## Textures

Textures often dominate runtime GPU memory.

Check:
- unjustified 4K/8K maps;
- duplicate maps;
- oversized alpha textures;
- unnecessarily large normal/roughness maps;
- lack of GPU-friendly compression.

KTX2/Basis Universal can reduce texture memory/transfer pressure and is supported in Three.js via `KTX2Loader`.

## Suggested pipeline

1. Preserve the untouched source.
2. Export a web GLB.
3. Inspect.
4. Prune unused data.
5. Deduplicate.
6. Resize oversized textures.
7. Choose geometry compression if beneficial.
8. Choose texture compression if beneficial.
9. Inspect again.
10. visually compare.
11. test target devices.

`gltf-transform optimize` is a useful baseline, but high-value assets may need a custom pipeline.

## Animation

Remove unused clips and unnecessary keyframes when possible. Verify skeletons, morphs, and clips after optimization.

## Loading

- preload only high-priority hero assets;
- lazy-load later scenes;
- preserve meaningful HTML fallback;
- never block all page content on decorative 3D.

## Disposal

Three.js GPU resources are not automatically freed just because JavaScript references disappear.

When a resource truly becomes obsolete, consider disposing:
- geometry;
- material;
- texture;
- render target;
- skeleton where appropriate.

Do not dispose shared resources still in use.

## Commands

```bash
scripts/inspect-glb public/models/product.glb
scripts/optimize-glb public/models/product.glb public/models/product.optimized.glb
```

## Sources

- https://www.khronos.org/gltf/
- https://gltf-transform.dev/
- https://threejs.org/docs/pages/GLTFLoader.html
- https://threejs.org/docs/pages/DRACOLoader.html
- https://threejs.org/docs/pages/KTX2Loader.html
- https://threejs.org/manual/en/how-to-dispose-of-objects.html
