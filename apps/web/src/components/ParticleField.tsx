import { useEffect, useRef } from "react";

/**
 * Thousands of tiny dots that keep rebuilding themselves, sphere into cube and
 * back: what the preview shows while the agent is building and there is no app
 * to show yet. Each dot is one particle with a sphere home and a cube home; the
 * vertex shader moves it between them, so nothing fades between two shapes, and
 * all the motion runs on the GPU (the CPU only updates a few numbers a frame).
 *
 * Plain WebGL rather than Three.js: one shape, one shader, and none of a 3D
 * engine's weight on the editor's first load.
 */

/** One loop, in seconds: sphere, morph, cube, morph back. */
const HOLD = 2.4;
const MORPH = 3.1;
const LOOP = 2 * (HOLD + MORPH);

const VERTEX = `
attribute vec3 aSphere;
attribute vec3 aCube;
attribute float aSeed;
uniform float uMix;
uniform float uTime;
uniform mat4 uProjection;
uniform mat4 uRotation;
uniform float uPointSize;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;

float easeInOut(float x) {
  return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0;
}

// A soft cosine palette through blue, cyan, green, orange, pink and purple.
vec3 palette(float t) {
  return vec3(0.52, 0.46, 0.64) + vec3(0.46, 0.44, 0.36) *
    cos(6.28318 * (vec3(1.0, 1.0, 1.0) * t + vec3(0.62, 0.30, 0.04)));
}

void main() {
  // Each particle starts a little later than the one before it, so the shape
  // is rebuilt in a wave rather than all at once.
  float local = clamp(uMix * 1.45 - aSeed * 0.45, 0.0, 1.0);
  float k = easeInOut(local);
  vec3 position = mix(aSphere, aCube, k);
  // On the way, each particle swings out along its own curve and settles.
  float swing = sin(3.14159 * k);
  vec3 drift = normalize(vec3(sin(aSeed * 91.7), cos(aSeed * 47.3), sin(aSeed * 13.1 + 1.7)));
  position += drift * swing * 0.16;

  vec4 world = uRotation * vec4(position * uScale, 1.0);
  world.z -= 3.2;
  gl_Position = uProjection * world;

  // Nearer dots a touch larger and stronger, the way the reference reads as 3D.
  float depth = clamp((world.z + 4.4) / 2.4, 0.0, 1.0);
  gl_PointSize = uPointSize * (0.7 + 0.6 * depth);
  vAlpha = 0.38 + 0.62 * depth;

  // The colour flows across the shape on its own clock, not the morph's.
  float flow = dot(normalize(aSphere), normalize(vec3(0.8, 0.5, 0.35))) * 0.35 + uTime * 0.045;
  vColor = palette(flow);
}
`;

const FRAGMENT = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float edge = smoothstep(0.5, 0.32, d);
  gl_FragColor = vec4(vColor, vAlpha * edge);
}
`;

/**
 * A grid of dots on each face of a cube, and the same dots pushed out onto a
 * sphere. Both shapes come out as tidy rows rather than swirls, and every dot
 * has an obvious place in each: the same direction from the centre.
 */
export function sphereAndCube(target: number) {
  const n = Math.max(8, Math.round(Math.sqrt(target / 6)));
  const count = n * n * 6;
  const sphere = new Float32Array(count * 3);
  const cube = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const size = 0.78;
  let i = 0;
  for (let face = 0; face < 6; face++) {
    const axis = face >> 1;
    const sign = face % 2 === 0 ? 1 : -1;
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const u = ((a + 0.5) / n) * 2 - 1;
        const v = ((b + 0.5) / n) * 2 - 1;
        const p = axis === 0 ? [sign, u, v] : axis === 1 ? [u, sign, v] : [u, v, sign];
        const [x, y, z] = p as [number, number, number];
        cube.set([x * size, y * size, z * size], i * 3);
        const length = Math.hypot(x, y, z);
        sphere.set([x / length, y / length, z / length], i * 3);
        // A fixed pseudo-random 0..1 per dot: when it starts moving, and its curve.
        const r = Math.sin(i * 12.9898) * 43758.5453;
        seed[i] = r - Math.floor(r);
        i++;
      }
    }
  }
  return { sphere, cube, seed, count };
}

/** 0 = sphere, 1 = cube, for a time in the loop (holds, then eased morphs). */
export function morphAt(seconds: number): number {
  const t = ((seconds % LOOP) + LOOP) % LOOP;
  if (t < HOLD) return 0;
  if (t < HOLD + MORPH) return (t - HOLD) / MORPH;
  if (t < 2 * HOLD + MORPH) return 1;
  return 1 - (t - 2 * HOLD - MORPH) / MORPH;
}

function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) * nf,
    -1,
    0,
    0,
    2 * far * near * nf,
    0,
  ]);
}

function rotation(yaw: number, pitch: number): Float32Array {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Ry(yaw) then Rx(pitch), column-major.
  return new Float32Array([
    cy,
    sp * sy,
    -cp * sy,
    0,
    0,
    cp,
    sp,
    0,
    sy,
    -sp * cy,
    cp * cy,
    0,
    0,
    0,
    0,
    1,
  ]);
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function ParticleField({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const cores = navigator.hardwareConcurrency ?? 8;
    const small = Math.min(canvas.clientWidth, canvas.clientHeight) < 360;
    const target = cores <= 4 || small ? 2800 : 4800;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
    gl.useProgram(program);

    const { sphere, cube, seed, count } = sphereAndCube(target);
    const buffers: WebGLBuffer[] = [];
    function attribute(name: string, data: Float32Array, size: number) {
      const buffer = gl!.createBuffer();
      if (!buffer) return;
      buffers.push(buffer);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
      gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW);
      const location = gl!.getAttribLocation(program!, name);
      gl!.enableVertexAttribArray(location);
      gl!.vertexAttribPointer(location, size, gl!.FLOAT, false, 0, 0);
    }
    attribute("aSphere", sphere, 3);
    attribute("aCube", cube, 3);
    attribute("aSeed", seed, 1);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const uMix = uniform("uMix");
    const uTime = uniform("uTime");
    const uProjection = uniform("uProjection");
    const uRotation = uniform("uRotation");
    const uPointSize = uniform("uPointSize");
    const uScale = uniform("uScale");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      const w = Math.max(1, Math.round(canvas!.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas!.clientHeight * dpr));
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas!.width = w;
      canvas!.height = h;
      gl!.viewport(0, 0, w, h);
      gl!.uniformMatrix4fv(uProjection, false, perspective(Math.PI / 4, w / h, 0.1, 20));
      // Keep the shape about the same share of the panel, whatever its shape.
      // About half the panel's height, with room around it; narrower when the
      // panel is taller than it is wide.
      gl!.uniform1f(uScale, 0.66 * Math.min(1, (w / h) * 0.95));
      gl!.uniform1f(uPointSize, 1.9 * dpr);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    function draw(seconds: number) {
      resize();
      gl!.uniform1f(uMix, reduceMotion ? 0 : morphAt(seconds));
      gl!.uniform1f(uTime, seconds);
      gl!.uniformMatrix4fv(
        uRotation,
        false,
        rotation(seconds * 0.22, 0.38 + Math.sin(seconds * 0.17) * 0.12),
      );
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.drawArrays(gl!.POINTS, 0, count);
    }

    let frame = 0;
    const start = performance.now();
    if (reduceMotion) {
      draw(1.5);
    } else {
      const loop = (now: number) => {
        draw((now - start) / 1000);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
