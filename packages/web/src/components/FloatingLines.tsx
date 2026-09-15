/**
 * FloatingLines — a direct port of the design reference's own shader
 * (vitalis-lines.js in the uploaded zip: three bands of glowing sine lines,
 * pointer-reactive bending, parallax), not a simplified SVG stand-in. Kept
 * as a WebGL/three.js effect on purpose — per instruction, the real
 * implementation was wanted here, isolated to wherever it's mounted (this
 * component owns exactly one WebGLRenderer + one requestAnimationFrame
 * loop, disposed on unmount) rather than a global animation system.
 *
 * THE PROP NAMES MATCH THE REQUESTED FloatingLines API
 * (`enabledWaves`/`lineCount`/`lineDistance`/`bendRadius`/`bendStrength`/
 * `interactive`/`parallax`) rather than vitalis-lines.js's own
 * `enableTop`/`topLineCount`/... uniform names — this component translates
 * between the two internally, so the call site reads exactly like the
 * brief's example.
 *
 * COLOR: the design's own default gradient is already VITALIS blue
 * (`['#1D4ED8', '#60A5FA', '#FFFFFF']` in vitalis-lines.js) — not React
 * Bits' purple/pink demo palette, so no re-theming was needed there; this
 * only exposes it as a prop so a call site COULD override it.
 *
 * `lightMode: true` (the shader's own flag, always on here) is what makes
 * this read as "ink on frosted glass" rather than "glow on black" — it mixes
 * toward white background with the line color as tinted "ink," which is the
 * correct rendering mode for VITALIS's light glass aesthetic, not the dark
 * canvas the React Bits demo and a naive port would default to.
 */

import { useEffect, useRef } from 'react';
// Type-only import: erased entirely at build time (verbatim module syntax),
// so this costs nothing in the bundle. The REAL `three` module is loaded
// with a dynamic `import('three')` inside the effect below instead of a
// static top-level import — three.js is a ~200KB (gzipped) dependency, and
// a static import would put that in EVERY page's bundle even though only
// Assistant ever mounts this component. Rollup puts a dynamic import in its
// own chunk, fetched only when this component actually mounts.
import type * as THREE_TYPES from 'three';

const vertexShader = `
precision highp float;
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const fragmentShader = `
precision highp float;
uniform float iTime;
uniform vec3 iResolution;
uniform float animationSpeed;
uniform bool enableTop, enableMiddle, enableBottom;
uniform int topLineCount, middleLineCount, bottomLineCount;
uniform float topLineDistance, middleLineDistance, bottomLineDistance;
uniform vec3 topWavePosition, middleWavePosition, bottomWavePosition;
uniform vec2 iMouse;
uniform bool interactive;
uniform float bendRadius, bendStrength, bendInfluence;
uniform bool parallax;
uniform vec2 parallaxOffset;
uniform vec3 lineGradient[8];
uniform int lineGradientCount;
uniform bool lightMode;
const vec3 BLACK = vec3(0.0);
mat2 rotate(float r) { return mat2(cos(r), sin(r), -sin(r), cos(r)); }
vec3 getLineColor(float t, vec3 baseColor) {
  if (lineGradientCount <= 0) return baseColor;
  if (lineGradientCount == 1) return lineGradient[0] * 0.5;
  float clampedT = clamp(t, 0.0, 0.9999);
  float scaled = clampedT * float(lineGradientCount - 1);
  int idx = int(floor(scaled));
  float f = fract(scaled);
  int idx2 = min(idx + 1, lineGradientCount - 1);
  return mix(lineGradient[idx], lineGradient[idx2], f) * 0.5;
}
float wave(vec2 uv, float offset, vec2 screenUv, vec2 mouseUv, bool shouldBend) {
  float time = iTime * animationSpeed;
  float amp = sin(offset + time * 0.2) * 0.3;
  float y = sin(uv.x + offset + time * 0.1) * amp;
  if (shouldBend) {
    vec2 d = screenUv - mouseUv;
    float influence = exp(-dot(d, d) * bendRadius);
    y += (mouseUv.y - screenUv.y) * influence * bendStrength * bendInfluence;
  }
  float m = uv.y - y;
  return 0.0175 / max(abs(m) + 0.01, 1e-3) + 0.01;
}
void main() {
  vec2 baseUv = (2.0 * gl_FragCoord.xy - iResolution.xy) / iResolution.y;
  baseUv.y *= -1.0;
  if (parallax) baseUv += parallaxOffset;
  vec3 col = vec3(0.0);
  vec3 b = BLACK;
  vec2 mouseUv = vec2(0.0);
  if (interactive) { mouseUv = (2.0 * iMouse - iResolution.xy) / iResolution.y; mouseUv.y *= -1.0; }
  if (enableBottom) {
    for (int i = 0; i < 40; i++) {
      if (i >= bottomLineCount) break;
      float fi = float(i);
      float t = fi / max(float(bottomLineCount - 1), 1.0);
      vec3 lineCol = getLineColor(t, b);
      float angle = bottomWavePosition.z * log(length(baseUv) + 1.0);
      vec2 ruv = baseUv * rotate(angle);
      col += lineCol * wave(ruv + vec2(bottomLineDistance * fi + bottomWavePosition.x, bottomWavePosition.y), 1.5 + 0.2 * fi, baseUv, mouseUv, interactive) * 0.2;
    }
  }
  if (enableMiddle) {
    for (int i = 0; i < 40; i++) {
      if (i >= middleLineCount) break;
      float fi = float(i);
      float t = fi / max(float(middleLineCount - 1), 1.0);
      vec3 lineCol = getLineColor(t, b);
      float angle = middleWavePosition.z * log(length(baseUv) + 1.0);
      vec2 ruv = baseUv * rotate(angle);
      col += lineCol * wave(ruv + vec2(middleLineDistance * fi + middleWavePosition.x, middleWavePosition.y), 2.0 + 0.15 * fi, baseUv, mouseUv, interactive);
    }
  }
  if (enableTop) {
    for (int i = 0; i < 40; i++) {
      if (i >= topLineCount) break;
      float fi = float(i);
      float t = fi / max(float(topLineCount - 1), 1.0);
      vec3 lineCol = getLineColor(t, b);
      float angle = topWavePosition.z * log(length(baseUv) + 1.0);
      vec2 ruv = baseUv * rotate(angle);
      ruv.x *= -1.0;
      col += lineCol * wave(ruv + vec2(topLineDistance * fi + topWavePosition.x, topWavePosition.y), 1.0 + 0.2 * fi, baseUv, mouseUv, interactive) * 0.1;
    }
  }
  if (lightMode) {
    vec3 energy = max(col, vec3(0.0));
    float peak = max(energy.r, max(energy.g, energy.b));
    float coverage = smoothstep(0.05, 0.85, peak);
    vec3 chroma = clamp(energy / max(peak, 0.0001), 0.0, 1.0);
    chroma = pow(chroma, vec3(1.35));
    float chromaPeak = max(chroma.r, max(chroma.g, chroma.b));
    chroma /= max(chromaPeak, 0.0001);
    vec3 ink = mix(chroma, clamp(chroma * 0.82, 0.0, 1.0), smoothstep(0.5, 1.0, coverage));
    gl_FragColor = vec4(mix(vec3(1.0), ink, coverage * 0.94), 1.0);
  } else {
    gl_FragColor = vec4(col, 1.0);
  }
}
`;

function hexToVec3(hex: string, THREE: typeof THREE_TYPES): THREE_TYPES.Vector3 {
  let v = hex.trim().replace('#', '');
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const bl = parseInt(v.slice(4, 6), 16);
  return new THREE.Vector3(r / 255, g / 255, bl / 255);
}

type WaveKey = 'top' | 'middle' | 'bottom';

export interface FloatingLinesProps {
  readonly enabledWaves?: readonly WaveKey[];
  /** Array = per-wave [top, middle, bottom]; number = same count for all three. */
  readonly lineCount?: readonly [number, number, number] | number;
  readonly lineDistance?: readonly [number, number, number] | number;
  readonly bendRadius?: number;
  readonly bendStrength?: number;
  readonly interactive?: boolean;
  readonly parallax?: boolean;
  readonly animationSpeed?: number;
  /** VITALIS blue by default — see the file header for why this needed no re-theming. */
  readonly linesGradient?: readonly string[];
}

function triplet(v: readonly [number, number, number] | number | undefined, fallback: readonly [number, number, number]): readonly [number, number, number] {
  if (v === undefined) return fallback;
  return typeof v === 'number' ? [v, v, v] : v;
}

export function FloatingLines({
  enabledWaves = ['top', 'middle', 'bottom'],
  lineCount,
  lineDistance,
  bendRadius = 5.0,
  bendStrength = -0.5,
  interactive = true,
  parallax = true,
  animationSpeed = 0.9,
  linesGradient = ['#1D4ED8', '#60A5FA', '#FFFFFF'],
}: FloatingLinesProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;

    // Respect the OS-level motion preference: no WebGL context, no render
    // loop at all — not just a paused one — when the user asked for less
    // motion. The glass/layout behind it is unaffected either way.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const counts = triplet(lineCount, [4, 5, 6]);
    const distances = triplet(lineDistance, [14, 11, 8]);
    const waves = new Set(enabledWaves);

    // `cancelled` guards the gap between kicking off the dynamic import and
    // it resolving — if this effect is torn down before `three` finishes
    // loading (a fast route change away from Assistant), setup must not
    // proceed and leak a renderer nothing will ever clean up.
    let cancelled = false;
    let teardown: (() => void) | undefined;

    void import('three').then((THREE) => {
      if (cancelled) return;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    camera.position.z = 1;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    el.appendChild(renderer.domElement);

    const gradient = linesGradient.map((hex) => hexToVec3(hex, THREE));
    const gradArr = Array.from({ length: 8 }, (_, i) => gradient[i] ?? new THREE.Vector3(1, 1, 1));

    const uniforms = {
      iTime: { value: 0 },
      iResolution: { value: new THREE.Vector3(1, 1, 1) },
      animationSpeed: { value: animationSpeed },
      enableTop: { value: waves.has('top') },
      enableMiddle: { value: waves.has('middle') },
      enableBottom: { value: waves.has('bottom') },
      topLineCount: { value: counts[0] },
      middleLineCount: { value: counts[1] },
      bottomLineCount: { value: counts[2] },
      topLineDistance: { value: distances[0] * 0.01 },
      middleLineDistance: { value: distances[1] * 0.01 },
      bottomLineDistance: { value: distances[2] * 0.01 },
      topWavePosition: { value: new THREE.Vector3(1.2, 0.6, -0.3) },
      middleWavePosition: { value: new THREE.Vector3(0.6, 0.0, 0.15) },
      bottomWavePosition: { value: new THREE.Vector3(2.0, -0.7, -1) },
      iMouse: { value: new THREE.Vector2(-1000, -1000) },
      interactive: { value: interactive },
      bendRadius: { value: bendRadius },
      bendStrength: { value: bendStrength },
      bendInfluence: { value: 0 },
      parallax: { value: parallax },
      parallaxOffset: { value: new THREE.Vector2(0, 0) },
      lineGradient: { value: gradArr },
      lineGradientCount: { value: gradient.length },
      lightMode: { value: true },
    };

    const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    const setSize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      uniforms.iResolution.value.set(renderer.domElement.width, renderer.domElement.height, 1);
    };
    setSize();
    const ro = new ResizeObserver(setSize);
    ro.observe(el);

    const targetMouse = new THREE.Vector2(-1000, -1000);
    const currentMouse = new THREE.Vector2(-1000, -1000);
    let targetInfl = 0;
    let currentInfl = 0;
    const targetPar = new THREE.Vector2(0, 0);
    const currentPar = new THREE.Vector2(0, 0);
    const clock = new THREE.Clock();

    const onMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dpr = renderer.getPixelRatio();
      targetMouse.set(x * dpr, (rect.height - y) * dpr);
      targetInfl = 1.0;
      targetPar.set(((x - rect.width / 2) / rect.width) * 0.2, -((y - rect.height / 2) / rect.height) * 0.2);
    };
    const onLeave = () => {
      targetInfl = 0.0;
    };
    if (interactive) {
      renderer.domElement.addEventListener('pointermove', onMove);
      renderer.domElement.addEventListener('pointerleave', onLeave);
    }

    // Pauses the render loop while the tab isn't visible — a WebGL loop
    // rendering into a background tab is pure wasted GPU/battery.
    let raf: number | undefined;
    let visible = true;
    const onVisibility = () => {
      visible = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onVisibility);

    const tick = () => {
      if (visible) {
        uniforms.iTime.value = clock.getElapsedTime();
        currentMouse.lerp(targetMouse, 0.05);
        uniforms.iMouse.value.copy(currentMouse);
        currentInfl += (targetInfl - currentInfl) * 0.05;
        uniforms.bendInfluence.value = currentInfl;
        currentPar.lerp(targetPar, 0.05);
        uniforms.parallaxOffset.value.copy(currentPar);
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

      teardown = () => {
        if (raf !== undefined) cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVisibility);
        ro.disconnect();
        if (interactive) {
          renderer.domElement.removeEventListener('pointermove', onMove);
          renderer.domElement.removeEventListener('pointerleave', onLeave);
        }
        if (renderer.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement);
        mesh.geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      };
    });

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [enabledWaves, lineCount, lineDistance, bendRadius, bendStrength, interactive, parallax, animationSpeed, linesGradient]);

  return <div ref={containerRef} className="floating-lines" aria-hidden="true" />;
}
