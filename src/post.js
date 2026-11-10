import './post.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ═══════════════════════════════════════════════════════════════════════════
// Post-processing pipeline
//
// The renderer no longer draws straight to the canvas. Instead:
//   scene  ─►  RenderPass         (render scene → offscreen render target A)
//          ─►  UnrealBloomPass    (extract bright pixels, blur, add back  → B)
//          ─►  Chromatic-aberration ShaderPass  (custom GLSL, B → A)
//          ─►  Grain/vignette/scanlines ShaderPass (custom GLSL, A → B)
//          ─►  OutputPass         (sRGB + tone-map → screen)
//
// Each ShaderPass is a fullscreen quad shader (same trick as shaders2.html) that
// reads the previous pass's render target via the `tDiffuse` uniform — Three.js
// auto-wires that for you.
//
// Concepts to take away:
//   • EffectComposer = double-buffered render-target chain.
//   • RenderPass goes first, OutputPass goes last.
//   • UnrealBloomPass is THE go-to glow effect — threshold/strength/radius are the only knobs.
//   • Custom passes are just `{uniforms, vertexShader, fragmentShader}` objects passed to ShaderPass.
//   • `tDiffuse` is the previous pass's output. Sample it like any sampler2D.
// ═══════════════════════════════════════════════════════════════════════════

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05050a);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// ──────────────────── SCENE CONTENT ────────────────────
// Need bright/emissive elements for bloom to have something to grab onto.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

scene.add(new THREE.AmbientLight(0xffffff, 0.18));
const key = new THREE.DirectionalLight(0xffffff, 1.0);
key.position.set(3, 5, 4);
scene.add(key);

// Centerpiece — chromatic torus knot with strong emissive
const knot = new THREE.Mesh(
  new THREE.TorusKnotGeometry(0.85, 0.30, 220, 32),
  new THREE.MeshStandardMaterial({
    color: 0xeeeeff,
    metalness: 0.85,
    roughness: 0.15,
    emissive: 0x6df2c9,
    emissiveIntensity: 1.4,
  })
);
scene.add(knot);

// Ring of bright pink orbs — bloom targets at well-defined positions
const orbMat = new THREE.MeshBasicMaterial({ color: 0xff6db6 });
const orbs = [];
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), orbMat);
  orb.position.set(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0);
  orb.userData.angle = a;
  orbs.push(orb);
  scene.add(orb);
}

// ──────────────────── EFFECT COMPOSER + PASSES ────────────────────
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
composer.setSize(window.innerWidth, window.innerHeight);

// 1. Base render
composer.addPass(new RenderPass(scene, camera));

// 2. Bloom — extract brights, gaussian-blur them, add back over the image
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.7,    // strength — how intense the glow
  0.4,    // radius   — how far the glow spreads
  0.85,   // threshold — only pixels brighter than this contribute
);
composer.addPass(bloomPass);

// 3. Chromatic aberration — split RGB channels by distance from screen center
const chromaPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },   // EffectComposer auto-fills this with previous pass output
    uOffset:  { value: 0.003 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uOffset;
    varying vec2 vUv;

    void main() {
      // Direction from screen center → bigger offset toward the edges
      vec2 dir = vUv - 0.5;
      float r = texture2D(tDiffuse, vUv + dir * uOffset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir * uOffset).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
});
// composer.addPass(chromaPass);

// 4. Combined grain + vignette + scanlines pass — three small effects in one shader
const grainPass = new ShaderPass({
  uniforms: {
    tDiffuse:   { value: null },
    uTime:      { value: 0 },
    uVignette:  { value: 1.2 },
    uGrain:     { value: 0.04 },
    uScanlines: { value: 0.05 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uScanlines;
    varying vec2 vUv;

    // Cheap pseudo-random hash — fine for grain, do not use for crypto :)
    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;

      // Vignette — darker at the corners
      float dist = distance(vUv, vec2(0.5));
      col *= 1.0 - dist * uVignette;

      // Animated grain — different seed each frame keeps it lively
      float n = rand(vUv + fract(uTime)) - 0.5;
      col += n * uGrain;

      // Scanlines — fast vertical sine. 800 = ~scanline density.
      col -= sin(vUv.y * 800.0) * uScanlines;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
composer.addPass(grainPass);

// 5. Output — handles sRGB conversion + tonemap. Always last.
composer.addPass(new OutputPass());

// ──────────────────── UI BINDINGS ────────────────────
function bindSlider(id, valId, fn) {
  const el = document.getElementById(id);
  const valEl = document.getElementById(valId);
  el.addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    fn(v);
    valEl.textContent = v.toFixed(v < 0.01 ? 4 : v < 1 ? 2 : 2);
  });
}
bindSlider('bloomStrength',  'v-bloomStrength',  v => bloomPass.strength = v);
bindSlider('bloomThreshold', 'v-bloomThreshold', v => bloomPass.threshold = v);
bindSlider('bloomRadius',    'v-bloomRadius',    v => bloomPass.radius = v);
bindSlider('chroma',         'v-chroma',         v => chromaPass.uniforms.uOffset.value = v);
bindSlider('vig',            'v-vig',            v => grainPass.uniforms.uVignette.value = v);
bindSlider('grain',          'v-grain',          v => grainPass.uniforms.uGrain.value = v);
bindSlider('scan',           'v-scan',           v => grainPass.uniforms.uScanlines.value = v);

// ──────────────────── ANIMATION LOOP ────────────────────
const clock = new THREE.Clock();

function tick() {
  const dt = clock.getDelta();
  const t  = clock.elapsedTime;

  knot.rotation.x += dt * 0.3;
  knot.rotation.y += dt * 0.5;

  // Pulse the orb ring so bloom flickers visibly
  orbs.forEach((o, i) => {
    o.position.set(
      Math.cos(o.userData.angle + t * 0.4) * 2.2,
      Math.sin(o.userData.angle + t * 0.4) * 2.2,
      Math.sin(t + i) * 0.3,
    );
  });

  grainPass.uniforms.uTime.value += dt;
  controls.update();
  composer.render();   // <-- not renderer.render(): the composer drives the pipeline
  requestAnimationFrame(tick);
}
tick();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
