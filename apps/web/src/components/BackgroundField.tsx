import { useEffect, useRef } from "react";
import { useBackgroundTexture } from "../hooks/useBackgroundTexture";
import { useTheme } from "../hooks/useTheme";

/*
 * The texture behind the pages: a fine halftone of dots laid on a slightly
 * offset grid. Each dot's size follows a slow field of silk-like bands that
 * drift across the screen, and the colour wanders through Zelyq's blues,
 * cyans and violets. It is kept faint on purpose: it should read as the
 * surface of the page, never as a picture behind it.
 *
 * Decoration only: hidden from screen readers, never takes the pointer,
 * draws nothing where WebGL is missing, stops while the tab is hidden, holds
 * still for reduced motion, and runs at 30 frames a second at most.
 */

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform float uDark;
uniform float uCell;
uniform vec3 uPointer; // x, y in pixels, z = presence 0..1

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}

vec3 palette(float k, float dark) {
  vec3 blue = dark > 0.5 ? vec3(0.36, 0.58, 1.00) : vec3(0.12, 0.37, 0.82);
  vec3 cyan = dark > 0.5 ? vec3(0.30, 0.82, 0.96) : vec3(0.05, 0.56, 0.78);
  vec3 violet = dark > 0.5 ? vec3(0.64, 0.52, 1.00) : vec3(0.43, 0.30, 0.88);
  vec3 rose = dark > 0.5 ? vec3(0.92, 0.52, 0.86) : vec3(0.72, 0.28, 0.66);
  k = fract(k);
  if (k < 0.25) return mix(blue, cyan, k * 4.0);
  if (k < 0.5) return mix(cyan, violet, (k - 0.25) * 4.0);
  if (k < 0.75) return mix(violet, rose, (k - 0.5) * 4.0);
  return mix(rose, blue, (k - 0.75) * 4.0);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  // Offset every other row by half a cell: a softer weave than a square grid.
  float row = floor(px.y / uCell);
  vec2 shifted = px + vec2(mod(row, 2.0) * 0.5 * uCell, 0.0);
  vec2 cell = floor(shifted / uCell);
  vec2 centre = (cell + 0.5) * uCell - vec2(mod(row, 2.0) * 0.5 * uCell, 0.0);
  vec2 local = px - centre;

  // The field, sampled once per dot so each dot is one clean size.
  vec2 p = centre / max(uRes.x, uRes.y) * 3.2;
  float t = uTime;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.035)), fbm(p + vec2(5.2, 1.3) - t * 0.028));
  float v = fbm(p + 1.7 * q + vec2(t * 0.018, -t * 0.012));
  // Silk: fine bands that follow the warped field, so the dots line up into soft folds.
  float bands = pow(0.5 + 0.5 * sin(v * 18.0 - t * 0.22), 2.4);
  float level = clamp(0.25 * v + 0.75 * bands * smoothstep(0.25, 0.7, v), 0.0, 1.0);

  vec2 uv = centre / uRes;
  // Now and then a soft band of light crosses the screen on the diagonal.
  float sweep = fract(t / 16.0) * 2.8 - 0.6;
  float shine = exp(-pow((uv.x * 0.8 + uv.y * 0.5 - sweep) * 5.0, 2.0));
  level = clamp(level + shine * 0.3 * (0.4 + bands), 0.0, 1.0);

  // The pointer lifts the dots near it a little, eased in and out.
  float d = length(centre - uPointer.xy) / (uCell * 14.0);
  float lift = uPointer.z * exp(-d * d);
  level = clamp(level + lift * 0.45, 0.0, 1.0);

  // The dot itself.
  float radius = uCell * mix(0.1, 0.4, level);
  float dist = length(local);
  float edge = 1.0 - smoothstep(radius - 0.75, radius + 0.75, dist);
  vec3 dotCol = palette(v * 0.9 + uv.x * 0.22 - uv.y * 0.12 + t * 0.012, uDark);
  // Faint at rest, clearer on the folds; quieter at the top, under the headings.
  float calm = mix(0.5, 1.0, smoothstep(0.0, 0.45, uv.y));
  float dotA = edge * (uDark > 0.5 ? 0.7 : 0.6) * (0.12 + 0.88 * pow(level, 1.4)) * calm;

  // Under the dots, a wash of colour so faint it reads as light on the page.
  vec2 fuv = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes;
  float glow = 0.5 + 0.5 * sin(fuv.x * 3.1 + t * 0.07) * cos(fuv.y * 2.3 - t * 0.05);
  glow *= smoothstep(0.05, 0.6, fuv.y + 0.25 * fuv.x);
  vec3 washCol = palette(fuv.x * 0.45 + fuv.y * 0.3 + t * 0.015 + 0.35, uDark);
  float washA = (uDark > 0.5 ? 0.075 : 0.06) * glow;

  float a = dotA + washA * (1.0 - dotA);
  if (a <= 0.001) discard;
  vec3 col = (dotCol * dotA + washCol * washA * (1.0 - dotA)) / a;
  gl_FragColor = vec4(col, a);
}`;

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
      antialias: false,
    });
    if (!gl) return;

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

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uDark = gl.getUniformLocation(program, "uDark");
    const uCell = gl.getUniformLocation(program, "uCell");
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

    // The pointer, in canvas pixels, eased so the lift glides rather than jumps.
    const target = { x: -9999, y: -9999, z: 0 };
    const pointer = { x: -9999, y: -9999, z: 0 };
    function onMove(event: PointerEvent) {
      const box = canvas!.getBoundingClientRect();
      const x = (event.clientX - box.left) * dpr;
      const y = (event.clientY - box.top) * dpr;
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
      gl!.uniform2f(uRes, canvas!.width, canvas!.height);
      gl!.uniform1f(uTime, reduce.matches ? 12 : (now - start) / 1000);
      gl!.uniform1f(uDark, darkRef.current ? 1 : 0);
      gl!.uniform1f(uCell, 10 * dpr);
      gl!.uniform3f(uPointer, pointer.x, pointer.y, reduce.matches ? 0 : pointer.z);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
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
      if (reduce.matches) draw(performance.now());
      else frame = requestAnimationFrame(loop);
    }
    redrawRef.current = () => draw(performance.now());
    const onResize = () => reduce.matches && draw(performance.now());

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
