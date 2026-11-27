import assert from "node:assert/strict";
import { test } from "node:test";
import { morphAt, sphereAndCube } from "../src/components/ParticleField.js";

test("the loop holds the sphere, morphs, holds the cube, and morphs back", () => {
  assert.equal(morphAt(0), 0);
  assert.equal(morphAt(1), 0, "holding the sphere");
  const going = [3, 4, 5].map(morphAt);
  assert.ok(
    going[0]! > 0 && going[0]! < going[1]! && going[1]! < going[2]!,
    "moving toward the cube",
  );
  assert.equal(morphAt(6.5), 1, "holding the cube");
  const back = [9, 10].map(morphAt);
  assert.ok(back[0]! < 1 && back[1]! < back[0]!, "moving back to the sphere");
  assert.equal(morphAt(11), 0, "a loop is 11 seconds");
  assert.equal(morphAt(12), morphAt(1));
});

test("every dot has a place on the sphere and on the cube, in the same direction", () => {
  const { sphere, cube, seed, count } = sphereAndCube(4800);
  assert.ok(count >= 4000 && count <= 6000, `${count} dots`);
  assert.equal(sphere.length, count * 3);
  for (let i = 0; i < count; i++) {
    const [sx, sy, sz] = [sphere[i * 3]!, sphere[i * 3 + 1]!, sphere[i * 3 + 2]!];
    const [cx, cy, cz] = [cube[i * 3]!, cube[i * 3 + 1]!, cube[i * 3 + 2]!];
    assert.ok(Math.abs(Math.hypot(sx, sy, sz) - 1) < 1e-5, "on the unit sphere");
    assert.ok(
      Math.abs(Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz)) - 0.78) < 1e-5,
      "on the cube",
    );
    const cl = Math.hypot(cx, cy, cz);
    assert.ok(
      Math.abs(sx - cx / cl) + Math.abs(sy - cy / cl) + Math.abs(sz - cz / cl) < 1e-5,
      "same direction",
    );
    assert.ok(seed[i]! >= 0 && seed[i]! < 1);
  }
  assert.ok(sphereAndCube(2800).count < count, "fewer on a small or slow device");
});
