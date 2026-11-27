import { useEffect, useRef } from "react";
import { useBackgroundTexture } from "../hooks/useBackgroundTexture";
import { useTheme } from "../hooks/useTheme";

/*
 * The texture behind the pages: two ribbons of fine dots, like silk, drifting
 * across the screen and slowly turning over as they go. Where a ribbon turns
 * edge-on its dots crowd into a bright fold; the colour moves along it through
 * Zelyq's blues, violets and a soft rose. A cousin of the sign-in page's dot
 * landscape, not a copy: flat, faint, and meant to read as the surface of the
 * page.
 *
 * Decoration only: hidden from screen readers, never takes the pointer, draws
 * nothing where WebGL is missing, stops while the tab is hidden, holds still
 * for reduced motion and where there is no graphics card, and runs at 30
 * frames a second at most.
 */

const VERTEX = `
attribute vec3 aDot; // u along the ribbon 0..1, v across it -1..1, which ribbon 0 or 1
uniform float uTime;
uniform vec2 uRes;
uniform float uDark;
uniform float uSize;
uniform vec3 uPointer; // x, y in 0..1 of the canvas, z = presence 0..1
varying vec3 vColor;
varying float vAlpha;

vec3 palette(float k, float dark) {
  vec3 blue = dark > 0.5 ? vec3(0.40, 0.62, 1.00) : vec3(0.16, 0.42, 0.86);
  vec3 cyan = dark > 0.5 ? vec3(0.36, 0.84, 0.98) : vec3(0.08, 0.60, 0.82);
  vec3 violet = dark > 0.5 ? vec3(0.66, 0.55, 1.00) : vec3(0.47, 0.34, 0.90);
  vec3 rose = dark > 0.5 ? vec3(0.94, 0.56, 0.88) : vec3(0.78, 0.34, 0.70);
  k = fract(k);
  if (k < 0.25) return mix(blue, cyan, k * 4.0);
  if (k < 0.5) return mix(cyan, violet, (k - 0.25) * 4.0);
  if (k < 0.75) return mix(violet, rose, (k - 0.5) * 4.0);
  return mix(rose, blue, (k - 0.75) * 4.0);
}

void main() {
  float u = aDot.x;
  float v = aDot.y;
  float second = aDot.z;
  float t = uTime;
  // The ribbon's path: a slow wave across the screen, the second one higher and calmer.
  float x = mix(-0.08, 1.08, u);
  float mid = mix(0.66, 0.34, second)
    + (0.10 - 0.03 * second) * sin(u * (2.3 + second) + t * 0.09 + second * 2.0)
    + 0.04 * sin(u * 5.2 - t * 0.13 + second);
  // It turns over as it goes: its width swings through zero where it is edge-on.
  float turn = u * (3.4 - 0.8 * second) + t * (0.12 + 0.03 * second) + second * 1.7;
  float width = (0.13 - 0.04 * second) * (0.55 + 0.45 * sin(u * 1.7 - t * 0.05));
  float y = mid + v * width * cos(turn);
  // Seen a little from the side: across the ribbon the dots lean with its turn, so it reads as cloth.
  x += v * width * 0.55 * sin(turn) * (uRes.y / uRes.x);
  // A ripple through the cloth, so the rows of dots never sit quite straight.
  y += 0.006 * sin(u * 40.0 + v * 3.0 - t * 0.8);

  // The pointer parts the dots near it a little.
  vec2 p = vec2(x, y);
  vec2 away = p - uPointer.xy;
  float aspect = uRes.x / uRes.y;
  float d = length(vec2(away.x * aspect, away.y));
  p += uPointer.z * normalize(away + 1e-5) * 0.018 * exp(-d * d / 0.012);

  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
  // The face towards us is lit, the far face is in shade; the edges of the ribbon fade.
  float facing = 0.5 + 0.5 * v * sin(turn);
  float edge = 1.0 - smoothstep(0.75, 1.0, abs(v));
  float ends = smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.88, u);
  vAlpha = (uDark > 0.5 ? 0.85 : 0.8) * (0.45 + 0.55 * facing) * edge * ends * (1.0 - 0.4 * second);
  gl_PointSize = uSize * (0.85 + 0.55 * facing);
  vColor = palette(u * 0.55 + second * 0.35 + t * 0.012, uDark);
}`;

const FRAGMENT = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.2, d));
}`;

/** Whether WebGL is drawn by the processor (SwiftShader, llvmpipe and the like), not a graphics card. */
function drawsInSoftware(gl: WebGLRenderingContext): boolean {
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "",
    );
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
}

/** The dots of both ribbons: along, across, and which ribbon. */
function ribbonDots(along: number, across: number): Float32Array {
  const dots = new Float32Array(2 * along * across * 3);
  let i = 0;
  for (let ribbon = 0; ribbon < 2; ribbon++) {
    for (let a = 0; a < along; a++) {
      for (let b = 0; b < across; b++) {
        dots[i++] = a / (along - 1);
        dots[i++] = (b / (across - 1)) * 2 - 1;
        dots[i++] = ribbon;
      }
    }
  }
  return dots;
}

/** The palette of the shader, for the plain canvas: blue, cyan, violet, rose, back to blue. */
const PLAIN_COLORS = {
  light: [
    [41, 107, 219],
    [20, 153, 209],
    [120, 87, 230],
    [199, 87, 179],
  ],
  dark: [
    [102, 158, 255],
    [92, 214, 250],
    [168, 140, 255],
    [240, 143, 224],
  ],
} as const;

function plainColor(k: number, dark: boolean): [number, number, number] {
  const stops = dark ? PLAIN_COLORS.dark : PLAIN_COLORS.light;
  const at = (((k % 1) + 1) % 1) * 4;
  const i = Math.floor(at) % 4;
  const f = at - Math.floor(at);
  const a = stops[i] as readonly number[];
  const b = stops[(i + 1) % 4] as readonly number[];
  return [0, 1, 2].map((c) => Math.round((a[c] ?? 0) + ((b[c] ?? 0) - (a[c] ?? 0)) * f)) as [
    number,
    number,
    number,
  ];
}

/**
 * The ribbons without WebGL: the vertex shader's sums in JavaScript on a 2D canvas, with fewer
 * dots and fewer frames (a dozen a second) so it stays light on the processor. Returns its cleanup.
 */
function drawPlain(
  canvas: HTMLCanvasElement,
  darkRef: { current: boolean },
  redrawRef: { current: () => void },
): (() => void) | undefined {
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ALONG = 220;
  const ACROSS = 22;
  const start = performance.now();
  let frame = 0;
  let last = 0;

  function draw(now: number) {
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const t = reduce.matches ? 14 : (now - start) / 1000;
    const dark = darkRef.current;
    const size = 2 * dpr;
    ctx!.clearRect(0, 0, w, h);
    for (let second = 0; second < 2; second++) {
      for (let a = 0; a < ALONG; a++) {
        const u = a / (ALONG - 1);
        const ends = Math.min(1, u / 0.12, (1 - u) / 0.12);
        if (ends <= 0) continue;
        const mid =
          (second ? 0.34 : 0.66) +
          (0.1 - 0.03 * second) * Math.sin(u * (2.3 + second) + t * 0.09 + second * 2) +
          0.04 * Math.sin(u * 5.2 - t * 0.13 + second);
        const turn = u * (3.4 - 0.8 * second) + t * (0.12 + 0.03 * second) + second * 1.7;
        const width = (0.13 - 0.04 * second) * (0.55 + 0.45 * Math.sin(u * 1.7 - t * 0.05));
        const [r, g, b] = plainColor(u * 0.55 + second * 0.35 + t * 0.012, dark);
        for (let c = 0; c < ACROSS; c++) {
          const v = (c / (ACROSS - 1)) * 2 - 1;
          const x = -0.08 + 1.16 * u + v * width * 0.55 * Math.sin(turn) * (h / w);
          const y = mid + v * width * Math.cos(turn) + 0.006 * Math.sin(u * 40 + v * 3 - t * 0.8);
          const facing = 0.5 + 0.5 * v * Math.sin(turn);
          const edge = Math.abs(v) < 0.75 ? 1 : Math.max(0, (1 - Math.abs(v)) / 0.25);
          const alpha =
            (dark ? 0.85 : 0.8) * (0.45 + 0.55 * facing) * edge * ends * (1 - 0.4 * second);
          if (alpha < 0.02) continue;
          ctx!.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
          ctx!.fillRect(x * w, y * h, size, size);
        }
      }
    }
    canvas.dataset.on = "true";
  }
  function loop(now: number) {
    frame = requestAnimationFrame(loop);
    if (now - last < 80) return;
    last = now;
    draw(now);
  }
  function run() {
    cancelAnimationFrame(frame);
    if (document.hidden) return;
    if (reduce.matches) draw(performance.now());
    else frame = requestAnimationFrame(loop);
  }
  redrawRef.current = () => draw(performance.now());
  const onResize = () => reduce.matches && draw(performance.now());
  document.addEventListener("visibilitychange", run);
  reduce.addEventListener("change", run);
  window.addEventListener("resize", onResize);
  run();
  return () => {
    cancelAnimationFrame(frame);
    redrawRef.current = () => {};
    document.removeEventListener("visibilitychange", run);
    reduce.removeEventListener("change", run);
    window.removeEventListener("resize", onResize);
    delete canvas.dataset.on;
  };
}

export function BackgroundField() {
  const { on } = useBackgroundTexture();
  const { resolved } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const darkRef = useRef(resolved === "dark");
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    darkRef.current = resolved === "dark";
    redrawRef.current();
  }, [resolved]);

  useEffect(() => {
    if (!on) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    });
    // No WebGL at all (switched off, a blocked graphics driver, some privacy settings): the same
    // ribbons, drawn with the plain 2D canvas instead.
    if (!gl) return drawPlain(canvas, darkRef, redrawRef);
    // No graphics card (a browser drawing WebGL on the processor, as in a VM or a test machine):
    // one still frame, so a moving page never costs the machine its speed.
    const still = drawsInSoftware(gl);

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
    gl.useProgram(program);

    // Fewer dots on a small or slow device; still fine-grained.
    const small =
      Math.min(window.innerWidth, window.innerHeight) < 700 ||
      (navigator.hardwareConcurrency || 8) <= 4;
    const dots = ribbonDots(small ? 260 : 420, small ? 24 : 34);
    const count = dots.length / 3;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, dots, gl.STATIC_DRAW);
    const aDot = gl.getAttribLocation(program, "aDot");
    gl.enableVertexAttribArray(aDot);
    gl.vertexAttribPointer(aDot, 3, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uDark = gl.getUniformLocation(program, "uDark");
    const uSize = gl.getUniformLocation(program, "uSize");
    const uPointer = gl.getUniformLocation(program, "uPointer");
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      const w = Math.max(1, Math.round(canvas!.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas!.clientHeight * dpr));
      if (canvas!.width === w && canvas!.height === h) return;
      canvas!.width = w;
      canvas!.height = h;
      gl!.viewport(0, 0, w, h);
    }

    // The pointer, in 0..1 of the canvas, eased so the dots glide rather than jump.
    const target = { x: -1, y: -1, z: 0 };
    const pointer = { x: -1, y: -1, z: 0 };
    function onMove(event: PointerEvent) {
      const box = canvas!.getBoundingClientRect();
      const x = (event.clientX - box.left) / Math.max(1, box.width);
      const y = (event.clientY - box.top) / Math.max(1, box.height);
      if (pointer.z < 0.01) {
        pointer.x = x;
        pointer.y = y;
      }
      target.x = x;
      target.y = y;
      target.z = 1;
    }
    function onLeave() {
      target.z = 0;
    }

    const start = performance.now();
    let frame = 0;
    let last = 0;
    let shown = false;
    function draw(now: number) {
      resize();
      pointer.x += (target.x - pointer.x) * 0.08;
      pointer.y += (target.y - pointer.y) * 0.08;
      pointer.z += (target.z - pointer.z) * 0.05;
      const calm = reduce.matches || still;
      gl!.uniform2f(uRes, canvas!.width, canvas!.height);
      gl!.uniform1f(uTime, calm ? 14 : (now - start) / 1000);
      gl!.uniform1f(uDark, darkRef.current ? 1 : 0);
      gl!.uniform1f(uSize, 2.2 * dpr);
      gl!.uniform3f(uPointer, pointer.x, pointer.y, calm ? 0 : pointer.z);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.drawArrays(gl!.POINTS, 0, count);
      if (!shown) {
        shown = true;
        canvas!.dataset.on = "true";
      }
    }
    function loop(now: number) {
      frame = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      draw(now);
    }
    function run() {
      cancelAnimationFrame(frame);
      if (document.hidden) return;
      if (reduce.matches || still) draw(performance.now());
      else frame = requestAnimationFrame(loop);
    }
    redrawRef.current = () => draw(performance.now());
    const onResize = () => (reduce.matches || still) && draw(performance.now());

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", run);
    reduce.addEventListener("change", run);
    window.addEventListener("resize", onResize);
    run();

    return () => {
      cancelAnimationFrame(frame);
      redrawRef.current = () => {};
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", run);
      reduce.removeEventListener("change", run);
      window.removeEventListener("resize", onResize);
      delete canvas.dataset.on;
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [on]);

  if (!on) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 size-full opacity-0 transition-opacity duration-1000 data-[on=true]:opacity-100 motion-reduce:transition-none"
    />
  );
}
