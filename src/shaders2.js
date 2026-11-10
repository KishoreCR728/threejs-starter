import './shaders2.css';
import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════════════════
// Fragment shader patterns on a fullscreen quad
//
// The trick: an OrthographicCamera + a 2x2 plane that exactly fills the screen.
// The vertex shader is trivial (just maps positions to clip space, passes UVs).
// All the work is in the FRAGMENT shader — every pixel decides its own color
// from UV coords, time, and a mouse-position uniform.
//
// Concepts introduced here:
//   • UV coordinates (0..1 across the quad) as the basic input
//   • FBM (fractal brownian motion) — layered noise for organic patterns
//   • Voronoi cells — a different procedural primitive ("nearest seed point")
//   • Inigo Quilez cosine palettes — a 4-vec compact way to define color ramps
//   • Cursor-driven UV warp — interactive distortion using the mouse uniform
// ═══════════════════════════════════════════════════════════════════════════

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 1;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// ─────────────────────── VERTEX SHADER (trivial fullscreen pass) ───────────────────────
// Just hand the UV through and place the quad at clip-space corners.
const vertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// ─────────────────────── FRAGMENT SHADER ───────────────────────
const fragmentShader = /* glsl */`
  uniform float uTime;
  uniform vec2  uResolution;   // canvas pixel size — used to keep aspect right
  uniform vec2  uMouse;        // cursor in 0..1 UV space
  uniform float uScale;
  uniform float uSpeed;
  uniform float uWarp;
  uniform int   uMode;         // 0=FBM, 1=Voronoi, 2=Stripes, 3=Polar

  varying vec2 vUv;

  // ───── 2D simplex noise (Ashima) ─────
  vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // ───── FBM = sum of noise octaves at doubling frequencies, halving amplitudes ─────
  // Result: smooth-but-detailed cloudy patterns. The bread-and-butter of procedural texture.
  float fbm(vec2 p) {
    float total = 0.0;
    float amp   = 0.5;
    float freq  = 1.0;
    for (int i = 0; i < 5; i++) {
      total += snoise(p * freq) * amp;
      freq  *= 2.0;
      amp   *= 0.5;
    }
    return total;
  }

  // ───── Voronoi: "what's the distance to the nearest seed point in this grid?" ─────
  // We split space into a grid, jitter each cell's seed by a hash, then for each pixel
  // check the 9 surrounding cells to find the nearest seed. Returns a 2-vec where
  // .x = distance to nearest seed, .y = a per-cell ID for coloring.
  vec2 hash22(vec2 p){
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  vec2 voronoi(vec2 uv) {
    vec2 g = floor(uv);
    vec2 f = fract(uv);
    float minDist = 1.0;
    float cellId  = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = vec2(float(x), float(y));
        vec2 seed = neighbor + hash22(g + neighbor);
        // animate the seed inside its cell
        seed += 0.5 + 0.5 * sin(uTime + 6.2831 * hash22(g + neighbor));
        float d = length(neighbor + seed - f);
        if (d < minDist) { minDist = d; cellId = hash22(g + neighbor).x; }
      }
    }
    return vec2(minDist, cellId);
  }

  // ───── Inigo Quilez cosine palette: 4 vec3s define a smooth gradient ─────
  // https://iquilezles.org/articles/palettes/  — one of the most useful tricks in shader work.
  vec3 palette(float t) {
    vec3 a = vec3(0.50, 0.50, 0.50);
    vec3 b = vec3(0.50, 0.50, 0.50);
    vec3 c = vec3(1.00, 1.00, 1.00);
    vec3 d = vec3(0.00, 0.20, 0.45);
    return a + b * cos(6.28318 * (c * t + d));
  }

  void main() {
    // Aspect-corrected UV — square units regardless of window shape.
    vec2 uv = vUv;
    uv.x *= uResolution.x / uResolution.y;

    // Cursor warp: pull the field toward the mouse based on distance.
    vec2 mouse = uMouse;
    mouse.x *= uResolution.x / uResolution.y;
    float dM = distance(uv, mouse);
    vec2 warp = (uv - mouse) * smoothstep(0.5, 0.0, dM) * uWarp;
    uv -= warp;

    float t = uTime * uSpeed;
    vec3 color = vec3(0.0);

    if (uMode == 0) {
      // FBM gradient — flowing cloud pattern colored by cosine palette.
      vec2 p = uv * uScale;
      p.x += t * 0.3;
      float n = fbm(p + fbm(p + t * 0.2));   // domain-warped FBM (FBM of FBM) = swirly
      color = palette(n + t * 0.15);
    }
    else if (uMode == 1) {
      // Voronoi cells — animated, colored by cell ID.
      vec2 v = voronoi(uv * uScale);
      float cellGlow = smoothstep(0.4, 0.0, v.x);   // glow at cell edges
      color = palette(v.y) * cellGlow;
      color += smoothstep(0.05, 0.0, v.x) * 0.6;    // bright core at each seed
    }
    else if (uMode == 2) {
      // Animated stripes that bend with FBM noise.
      float stripe = sin((uv.x + fbm(uv * uScale + t) * 0.4) * uScale * 3.14159 + t * 2.0);
      stripe = smoothstep(0.0, 0.3, stripe);
      color = palette(stripe * 0.5 + uv.y);
    }
    else {
      // Polar rays — 2D coordinate from cartesian to (radius, angle), then patterned.
      vec2 c = uv - vec2(uResolution.x / uResolution.y * 0.5, 0.5);
      float r = length(c);
      float a = atan(c.y, c.x);
      float rays = sin(a * 12.0 + t * 1.5 + r * uScale);
      color = palette(rays * 0.3 + r + t * 0.1);
      color *= smoothstep(0.0, 0.4, 0.7 - r);   // vignette
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

const uniforms = {
  uTime:       { value: 0 },
  uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  uMouse:      { value: new THREE.Vector2(0.5, 0.5) },
  uScale:      { value: 3.0 },
  uSpeed:      { value: 0.4 },
  uWarp:       { value: 0.05 },
  uMode:       { value: 0 },
};

const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
scene.add(quad);

// ─────────────────────── INPUT ───────────────────────
window.addEventListener('mousemove', (e) => {
  uniforms.uMouse.value.set(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
});

const modeEl  = document.getElementById('mode');
const scaleEl = document.getElementById('scale');
const speedEl = document.getElementById('speed');
const warpEl  = document.getElementById('warp');
const scaleVal = document.getElementById('v-scale');
const speedVal = document.getElementById('v-speed');
const warpVal  = document.getElementById('v-warp');

modeEl.addEventListener('change', e => { uniforms.uMode.value = parseInt(e.target.value); });
scaleEl.addEventListener('input', e => {
  uniforms.uScale.value = parseFloat(e.target.value);
  scaleVal.textContent = uniforms.uScale.value.toFixed(1);
});
speedEl.addEventListener('input', e => {
  uniforms.uSpeed.value = parseFloat(e.target.value);
  speedVal.textContent = uniforms.uSpeed.value.toFixed(2);
});
warpEl.addEventListener('input', e => {
  uniforms.uWarp.value = parseFloat(e.target.value);
  warpVal.textContent = uniforms.uWarp.value.toFixed(3);
});

// ─────────────────────── ANIMATION LOOP ───────────────────────
const clock = new THREE.Clock();

function tick() {
  uniforms.uTime.value += clock.getDelta();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
});
