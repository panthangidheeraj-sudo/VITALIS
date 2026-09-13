import * as THREE from 'three';

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
uniform float parallaxStrength;
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

function hexToVec3(hex) {
  let v = hex.trim().replace('#', '');
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
  return new THREE.Vector3(r / 255, g / 255, b / 255);
}

let renderer, scene, camera, uniforms, mesh, raf = null, ro = null, container = null;
let targetMouse = new THREE.Vector2(-1000, -1000), currentMouse = new THREE.Vector2(-1000, -1000);
let targetInfl = 0, currentInfl = 0;
let targetPar = new THREE.Vector2(0, 0), currentPar = new THREE.Vector2(0, 0);
const clock = new THREE.Clock();

function build(el, opts) {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  camera.position.z = 1;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  el.appendChild(renderer.domElement);

  const gradient = (opts.linesGradient || ['#1D4ED8', '#60A5FA', '#FFFFFF']).map(hexToVec3);
  const gradArr = Array.from({ length: 8 }, (_, i) => gradient[i] || new THREE.Vector3(1, 1, 1));

  uniforms = {
    iTime: { value: 0 },
    iResolution: { value: new THREE.Vector3(1, 1, 1) },
    animationSpeed: { value: opts.animationSpeed ?? 0.6 },
    enableTop: { value: true }, enableMiddle: { value: true }, enableBottom: { value: true },
    topLineCount: { value: opts.lineCount?.[0] ?? 4 }, middleLineCount: { value: opts.lineCount?.[1] ?? 5 }, bottomLineCount: { value: opts.lineCount?.[2] ?? 6 },
    topLineDistance: { value: (opts.lineDistance?.[0] ?? 14) * 0.01 }, middleLineDistance: { value: (opts.lineDistance?.[1] ?? 11) * 0.01 }, bottomLineDistance: { value: (opts.lineDistance?.[2] ?? 8) * 0.01 },
    topWavePosition: { value: new THREE.Vector3(1.2, 0.6, -0.3) },
    middleWavePosition: { value: new THREE.Vector3(0.6, 0.0, 0.15) },
    bottomWavePosition: { value: new THREE.Vector3(2.0, -0.7, -1) },
    iMouse: { value: new THREE.Vector2(-1000, -1000) },
    interactive: { value: true }, bendRadius: { value: 5.0 }, bendStrength: { value: -0.5 }, bendInfluence: { value: 0 },
    parallax: { value: true }, parallaxStrength: { value: 0.2 }, parallaxOffset: { value: new THREE.Vector2(0, 0) },
    lineGradient: { value: gradArr }, lineGradientCount: { value: gradient.length },
    lightMode: { value: true }
  };

  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(mesh);

  const setSize = () => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    uniforms.iResolution.value.set(renderer.domElement.width, renderer.domElement.height, 1);
  };
  setSize();
  ro = new ResizeObserver(setSize);
  ro.observe(el);

  const onMove = (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const dpr = renderer.getPixelRatio();
    targetMouse.set(x * dpr, (rect.height - y) * dpr);
    targetInfl = 1.0;
    targetPar.set(((x - rect.width / 2) / rect.width) * 0.2, -((y - rect.height / 2) / rect.height) * 0.2);
  };
  const onLeave = () => { targetInfl = 0.0; };
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerleave', onLeave);
  container = { el, onMove, onLeave };
}

function tick() {
  uniforms.iTime.value = clock.getElapsedTime();
  currentMouse.lerp(targetMouse, 0.05);
  uniforms.iMouse.value.copy(currentMouse);
  currentInfl += (targetInfl - currentInfl) * 0.05;
  uniforms.bendInfluence.value = currentInfl;
  currentPar.lerp(targetPar, 0.05);
  uniforms.parallaxOffset.value.copy(currentPar);
  renderer.render(scene, camera);
  raf = requestAnimationFrame(tick);
}

export function start(el, opts = {}) {
  if (container && container.el === el && raf) return;
  stop();
  build(el, opts);
  tick();
}

export function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  if (ro) { ro.disconnect(); ro = null; }
  if (container) {
    renderer.domElement.removeEventListener('pointermove', container.onMove);
    renderer.domElement.removeEventListener('pointerleave', container.onLeave);
    if (renderer.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement);
  }
  if (mesh) { mesh.geometry.dispose(); mesh.material.dispose(); }
  if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
  renderer = null; scene = null; camera = null; container = null;
}

window.VitalisLines = { start, stop };
