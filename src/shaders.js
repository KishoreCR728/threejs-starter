import './shaders.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ═══════════════════════════════════════════════════════════════════════════
// First custom shader project
//
// Two-shader pipeline runs on the GPU for every vertex (vertex shader)
// and every pixel (fragment shader) of the rendered mesh:
//
//   1. VERTEX SHADER   — runs once per vertex
//      Input:   attribute position, normal, uv  +  uniforms (time, intensity)
//      Job:     compute the final clip-space position of this vertex
//      Here:    we displace each vertex outward along its normal by an amount
//               sampled from animated 3D simplex noise
//
//   2. FRAGMENT SHADER — runs once per pixel covered by the mesh
//      Input:   varyings interpolated from the 3 vertices of the triangle
//      Job:     output gl_FragColor (rgba) for this pixel
//      Here:    a gradient from "deep purple" (valleys) to "hot pink" (peaks)
//               plus a fresnel rim glow that brightens silhouette edges
//
// Uniforms are JS-controlled values (time, slider readings).
// Varyings carry data from the vertex shader to the fragment shader.
// ═══════════════════════════════════════════════════════════════════════════

const scene = new THREE.Scene();
scene.background = new THREE.Color('#08080d');

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// ──────────────────────── VERTEX SHADER ────────────────────────
// `position`, `normal`, `uv`, `modelMatrix`, `viewMatrix`, `projectionMatrix`,
// `modelViewMatrix`, `normalMatrix`, `cameraPosition` are all auto-injected by Three.js.
const vertexShader = /* glsl */`
  uniform float uTime;
  uniform float uIntensity;
  uniform float uFrequency;

  varying float vDisplacement;
  varying vec3  vNormal;
  varying vec3  vViewDir;

  // ────── 3D simplex noise — Ian McEwan / Ashima Arts (canonical GLSL noise) ──────
  // Returns a smooth pseudo-random value in roughly [-1, 1] for any 3D point.
  // Sampling at slightly different points gives smoothly-varying values.
  vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xyzw + s0.xyzw * sh.xxyy;
    vec4 a1 = b1.xyzw + s1.xyzw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    // Sample the noise at this vertex's position. Multiplying position by uFrequency
    // controls the "scale" of the noise pattern (higher = tighter ripples).
    // Adding uTime to the third coord makes the pattern flow over time.
    float noise = snoise(position * uFrequency + vec3(0.0, 0.0, uTime));

    // Push the vertex outward (or inward, where noise is negative) along its normal.
    float displacement = noise * uIntensity;
    vec3 newPosition = position + normal * displacement;

    // Hand off displacement and view info to the fragment shader.
    vDisplacement = displacement;
    vNormal = normalize(normalMatrix * normal);
    vec3 worldPos = (modelMatrix * vec4(newPosition, 1.0)).xyz;
    vViewDir = normalize(cameraPosition - worldPos);

    // Standard transform → clip space. This is what every Three.js vertex shader does last.
    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  }
`;

// ──────────────────────── FRAGMENT SHADER ────────────────────────
// Runs once per visible pixel. `varying` values are smoothly interpolated
// across the triangle from the 3 vertex-shader outputs.
const fragmentShader = /* glsl */`
  uniform float uTime;

  varying float vDisplacement;
  varying vec3  vNormal;
  varying vec3  vViewDir;

  void main() {
    // Map displacement (~ -intensity..+intensity) to a 0..1 gradient lookup.
    float t = smoothstep(-0.3, 0.3, vDisplacement);

    vec3 deepColor = vec3(0.10, 0.05, 0.45);  // valleys — deep purple-blue
    vec3 highColor = vec3(1.00, 0.45, 0.75);  // peaks  — hot pink
    vec3 baseColor = mix(deepColor, highColor, t);

    // Fresnel: edges of silhouette face away from view → big rim term, glowing.
    // Surfaces facing the camera → small rim term, untouched.
    float fresnel = pow(1.0 - max(0.0, dot(vNormal, vViewDir)), 2.5);
    vec3 rimColor = vec3(0.4, 0.85, 1.0);

    vec3 finalColor = baseColor + rimColor * fresnel * 0.8;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// ──────────────────────── MATERIAL + GEOMETRY ────────────────────────
// Uniforms are the live "wires" between JS and the GPU shader.
// Updating the .value here updates the shader on the next frame.
const uniforms = {
  uTime:      { value: 0 },
  uIntensity: { value: 0.3 },
  uFrequency: { value: 1.5 },
};

const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader,
  fragmentShader,
});

// SphereGeometry stays perfectly round at any segment count and gives clean UVs.
// IcosahedronGeometry with very high `detail` (e.g. >128) breaks down — its UV stitching
// and vertex-normalization code accumulates float-precision errors and the sphere ends up
// looking lumpy even with displacement off. 256 × 128 = ~65k tris, plenty for smooth noise.
const geometry = new THREE.SphereGeometry(1.2, 256, 400);
const sphere = new THREE.Mesh(geometry, material);
scene.add(sphere);

// Soft point of light just so the dark background isn't pure black at the edges.
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

// ──────────────────────── UI BINDINGS ────────────────────────
const intensityEl = document.getElementById('intensity');
const frequencyEl = document.getElementById('frequency');
const speedEl     = document.getElementById('speed');
const intensityVal = document.getElementById('v-intensity');
const frequencyVal = document.getElementById('v-frequency');
const speedVal     = document.getElementById('v-speed');

let speed = parseFloat(speedEl.value);

intensityEl.addEventListener('input', e => {
  uniforms.uIntensity.value = parseFloat(e.target.value);
  intensityVal.textContent = uniforms.uIntensity.value.toFixed(2);
});
frequencyEl.addEventListener('input', e => {
  uniforms.uFrequency.value = parseFloat(e.target.value);
  frequencyVal.textContent = uniforms.uFrequency.value.toFixed(1);
});
speedEl.addEventListener('input', e => {
  speed = parseFloat(e.target.value);
  speedVal.textContent = speed.toFixed(2);
});

// ──────────────────────── ANIMATION LOOP ────────────────────────
const clock = new THREE.Clock();

function tick() {
  uniforms.uTime.value += clock.getDelta() * speed;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
