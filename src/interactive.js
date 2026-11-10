import './interactive.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import gsap from 'gsap';

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO — file-based engine. Drop curated sound files into /public/sounds/
// at these paths and they'll be loaded + decoded once the AudioContext is
// unlocked. Missing files fail silently so the page still works.
//
//   /sounds/ambient.mp3  — atmospheric pad, looping (the bed)
//   /sounds/swim.mp3     — wind / water loop, gain driven by scroll velocity
//   /sounds/boom.mp3     — explosion impact one-shot
//   /sounds/whoosh.mp3   — camera fly transition one-shot
//   /sounds/swoosh.mp3   — panel open/close one-shot
//   /sounds/tick.mp3     — Solo-Leveling-style stat-up bell
//
// State persists in localStorage. Browser autoplay policy still requires the
// first user gesture; the page handles that automatically.
// ═══════════════════════════════════════════════════════════════════════════
const SOUND_FILES = {
  ambient: '/sounds/ambient.mp3',
  swim:    '/sounds/swim.mp3',
  boom:    '/sounds/boom.mp3',
  whoosh:  '/sounds/whoosh.mp3',
  swoosh:  '/sounds/swoosh.mp3',
  tick:    '/sounds/tick.mp3',
  charge:  '/sounds/charge.mp3',  // 3s riser into the intro explosion
};

// Per-sound default gain (relative to master). Tuned so the bed sits low,
// transients sit punchy.
const SOUND_GAIN = {
  ambient: 0.55,
  swim:    0.7,    // ceiling — the actual gain is intensity-driven
  boom:    1.0,
  whoosh:  0.85,
  swoosh:  0.75,
  tick:    0.95,   // single hit per reveal, so it can sit forward
  charge:  0.9,    // riser builds tension, then boom takes over
};

class AudioEngine {
  constructor() {
    this.ctx           = null;
    this.master        = null;
    this.enabled       = false;
    this.buffers       = {};
    this.ambientHandle = null;
    this.swimHandle    = null;
    this.pendingBoom   = false;
    this.loadPromise   = null;
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Relaxed compressor — earlier settings (-10 / ratio 4) were aggressive
      // enough to duck transient sounds (the magic-bell tick) when ambient +
      // swim were already running. Now it only kicks in near clipping.
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -3;
      compressor.knee.value      = 4;
      compressor.ratio.value     = 2;
      compressor.attack.value    = 0.003;
      compressor.release.value   = 0.25;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);
      this.loadPromise = this._loadAll();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  async _loadAll() {
    await Promise.all(Object.entries(SOUND_FILES).map(async ([name, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;          // file missing → skip silently
        const ab = await res.arrayBuffer();
        this.buffers[name] = await this.ctx.decodeAudioData(ab);
      } catch {
        /* network or decode error → skip silently */
      }
    }));
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.linearRampToValueAtTime(on ? 1.0 : 0, t + 0.3);
    if (on) {
      this._waitAndStartLoops();
      if (this.pendingBoom) {
        this.pendingBoom = false;
        setTimeout(() => this.boom(), 250);
      }
    } else {
      this._stopAmbient();
      if (this.swimHandle) this.swimHandle.gain.gain.setTargetAtTime(0, t, 0.06);
    }
  }

  async _waitAndStartLoops() {
    if (this.loadPromise) await this.loadPromise;
    this._startAmbient();
    this._ensureSwim();
  }

  // Internal one-shot / loop player. Returns a handle so callers can adjust
  // the per-instance gain (used by the swim loop). Defensively resumes the
  // AudioContext — Chrome auto-suspends it after periods of inactivity, which
  // makes new BufferSources start silently.
  _play(name, { gain = 1, loop = false } = {}) {
    if (!this.ctx || !this.enabled || !this.buffers[name]) return null;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.loop   = loop;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
    return { src, gain: g };
  }

  _startAmbient() {
    if (this.ambientHandle || !this.buffers.ambient) return;
    const handle = this._play('ambient', { gain: 0, loop: true });
    if (!handle) return;
    const t = this.ctx.currentTime;
    handle.gain.gain.linearRampToValueAtTime(SOUND_GAIN.ambient, t + 1.4);
    this.ambientHandle = handle;
  }

  _stopAmbient() {
    if (!this.ambientHandle) return;
    const handle = this.ambientHandle;
    this.ambientHandle = null;
    const t = this.ctx.currentTime;
    handle.gain.gain.linearRampToValueAtTime(0, t + 0.4);
    setTimeout(() => { try { handle.src.stop(); } catch {} }, 500);
  }

  // Looping swim noise — gain driven by setSwimIntensity each frame.
  _ensureSwim() {
    if (this.swimHandle || !this.buffers.swim) return;
    this.swimHandle = this._play('swim', { gain: 0, loop: true });
  }

  setSwimIntensity(level) {
    if (!this.swimHandle || !this.ctx || !this.enabled) return;
    const v = Math.min(1, Math.abs(level));
    this.swimHandle.gain.gain.setTargetAtTime(v * SOUND_GAIN.swim, this.ctx.currentTime, 0.06);
  }

  // boom() can be queued before the AudioContext unlocks — replays on
  // setEnabled(true) so the intro explosion sound never gets dropped.
  boom() {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running' || !this.buffers.boom) {
      this.pendingBoom = true;
      return;
    }
    this._play('boom', { gain: SOUND_GAIN.boom });
  }

  whoosh()              { this._play('whoosh', { gain: SOUND_GAIN.whoosh }); }
  swoosh(/*opening*/)   { this._play('swoosh', { gain: SOUND_GAIN.swoosh }); }
  // charge() can fire before the buffer finishes decoding (gate-click is the
  // very first gesture, fetch + decode is still in flight). Await the load
  // promise so the riser actually plays.
  async charge() {
    if (this.loadPromise) await this.loadPromise;
    this._play('charge', { gain: SOUND_GAIN.charge });
  }
  tick()                {
    const handle = this._play('tick', { gain: SOUND_GAIN.tick });
    // Visible diagnostic: lets you confirm in devtools that the bell actually
    // fires on every panel reveal + nav. Logs the AudioContext state too —
    // if it's "suspended" the sound won't be audible.
    console.log('[audio] tick() →', handle ? 'played' : 'SKIPPED',
      '| ctx:', this.ctx?.state, '| enabled:', this.enabled,
      '| buffer:', !!this.buffers.tick);
  }
}
const audio = new AudioEngine();
window.__audio = audio;     // expose for devtools poking

// ═══════════════════════════════════════════════════════════════════════════
// Drift — first-person swim through a sphere of scattered PBR objects.
//
//  • Intro:   12 shapes start at origin, scale 0, then explode outward to their
//             scattered Fibonacci-sphere positions with a staggered tween.
//  • Look:    drag the mouse to yaw / pitch the camera in place (first-person).
//  • Swim:    mouse wheel pushes the camera along its current view direction
//             (with velocity decay — feels like drifting through water).
//  • Click:   if a shape is under the cursor → fly the camera to a framing pose
//             in front of it. If empty space → lunge 5 units along the click ray.
// ═══════════════════════════════════════════════════════════════════════════

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02030a);   // deep night

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 400);
// Start third-person so the explosion is visible. Looking down -Z toward origin.
camera.position.set(0, 1, 24);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ──────────────────── ENV + LIGHTS ────────────────────
// HDRI is both the visible background AND the source of reflections / IBL.
// While the .hdr is downloading, the deep-navy background stays in place.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
new RGBELoader().load(
  '/hdri/blue-sky.hdr',
  (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(tex).texture;
    scene.background           = tex;
    scene.backgroundBlurriness = 0.0;     // 0 = sharp, raise toward 0.5 to defocus
    scene.backgroundIntensity  = 1.0;
  },
  undefined,
  () => { /* HDR missing — keep navy + RoomEnvironment fallback */ },
);

scene.add(new THREE.AmbientLight(0xffffff, 0.18));

const key = new THREE.DirectionalLight(0xfff1d6, 1.4);
key.position.set(6, 8, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near   = 0.5;
key.shadow.camera.far    = 50;
key.shadow.camera.left   = -20;
key.shadow.camera.right  = 20;
key.shadow.camera.top    = 20;
key.shadow.camera.bottom = -20;
key.shadow.bias          = -0.0005;
scene.add(key);

const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
fill.position.set(-6, 4, -3);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffaa55, 0.4);
rim.position.set(0, -3, -8);
scene.add(rim);

// ──────────────────── HELPER GEOMETRIES (Lathe / Tube / Extrude) ────────────────────
function makeVaseGeometry() {
  const points = [];
  const segments = 22;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const r = 0.16 + Math.sin(t * Math.PI * 1.05) * 0.32;
    const y = (t - 0.5) * 1.2;
    points.push(new THREE.Vector2(r, y));
  }
  return new THREE.LatheGeometry(points, 64);
}
function makeRibbonGeometry() {
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.55, -0.45, -0.25),
    new THREE.Vector3(-0.25, -0.15,  0.25),
    new THREE.Vector3( 0.0,   0.30, -0.25),
    new THREE.Vector3( 0.25,  0.15,  0.25),
    new THREE.Vector3( 0.55, -0.40, -0.15),
  ], false);
  const geo = new THREE.TubeGeometry(path, 80, 0.10, 16, false);
  geo.center();
  return geo;
}
function makeStarGeometry() {
  const shape = new THREE.Shape();
  const points = 5, inner = 0.22, outer = 0.55;
  for (let i = 0; i <= points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.3, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 4,
  });
  geo.center();
  return geo;
}

// ──────────────────── SHAPE DEFINITIONS — 12 PBR profiles ────────────────────
const shapeDefs = [
  { geo: new THREE.SphereGeometry(0.85, 96, 64),                 hex: 0xeeeeff, name: 'chrome sphere',
    props: { metalness: 1.0, roughness: 0.08, clearcoat: 0.4, clearcoatRoughness: 0.08,
             iridescence: 0.6, iridescenceIOR: 1.5, iridescenceThicknessRange: [200, 600] } },
  { geo: new THREE.BoxGeometry(1.2, 1.2, 1.2),                   hex: 0xffffff, name: 'clear glass cube',
    props: { metalness: 0, roughness: 0.04, transmission: 1.0, thickness: 1.2, ior: 1.5,
             attenuationColor: new THREE.Color(0xff6db6), attenuationDistance: 1.2,
             clearcoat: 0.7, clearcoatRoughness: 0.06 } },
  { geo: new THREE.TorusKnotGeometry(0.55, 0.18, 200, 32),       hex: 0xffd66d, name: 'brushed gold knot',
    props: { metalness: 1.0, roughness: 0.38, envMapIntensity: 0.9,
             anisotropy: 0.8, anisotropyRotation: 0 } },
  { geo: new THREE.CylinderGeometry(0.6, 0.6, 1.4, 64),          hex: 0xffffff, name: 'frosted glass',
    props: { metalness: 0, roughness: 0.45, envMapIntensity: 0.8,
             transmission: 0.95, thickness: 1.5, ior: 1.45,
             attenuationColor: new THREE.Color(0xa0e0ff), attenuationDistance: 2.0 } },
  { geo: new THREE.CapsuleGeometry(0.45, 0.7, 16, 32),           hex: 0xfff5e0, name: 'wax / soap',
    props: { metalness: 0, roughness: 0.55, envMapIntensity: 0.6,
             transmission: 0.6, thickness: 2.0, ior: 1.35,
             attenuationColor: new THREE.Color(0xffe4a8), attenuationDistance: 0.5 } },
  { geo: new THREE.OctahedronGeometry(0.95, 0),                  hex: 0xffffff, name: 'diamond gem',
    props: { metalness: 0, roughness: 0.0, envMapIntensity: 1.2,
             transmission: 1.0, thickness: 0.5, ior: 2.4,
             attenuationColor: new THREE.Color(0xc8f0ff), attenuationDistance: 3.0 } },
  { geo: new THREE.DodecahedronGeometry(0.85, 0),                hex: 0xfff5f8, name: 'pearl',
    props: { metalness: 0.2, roughness: 0.3, envMapIntensity: 0.9,
             iridescence: 1.0, iridescenceIOR: 1.4, iridescenceThicknessRange: [600, 1200],
             clearcoat: 0.5, clearcoatRoughness: 0.1 } },
  { geo: new THREE.ConeGeometry(0.7, 1.4, 64),                   hex: 0x6080a0, name: 'anodized titanium',
    props: { metalness: 1.0, roughness: 0.25, envMapIntensity: 1.0,
             iridescence: 0.5, iridescenceIOR: 1.8, iridescenceThicknessRange: [300, 800] } },
  { geo: makeVaseGeometry(),                                      hex: 0xc41e3a, name: 'car paint vase',
    props: { metalness: 0.1, roughness: 0.4, envMapIntensity: 0.9,
             clearcoat: 1.0, clearcoatRoughness: 0.03 } },
  { geo: makeRibbonGeometry(),                                    hex: 0x4a1e8a, name: 'velvet ribbon',
    props: { metalness: 0, roughness: 0.9, envMapIntensity: 0.5,
             sheen: 1.0, sheenColor: new THREE.Color(0xff80c0), sheenRoughness: 0.3 } },
  { geo: new THREE.TorusGeometry(0.55, 0.18, 32, 64),            hex: 0xffffff, name: 'liquid mercury',
    props: { metalness: 1.0, roughness: 0.0, envMapIntensity: 1.5 } },
  { geo: makeStarGeometry(),                                      hex: 0x802040, name: 'silk star',
    props: { metalness: 0, roughness: 0.95, envMapIntensity: 0.4,
             sheen: 1.0, sheenColor: new THREE.Color(0xffa080), sheenRoughness: 0.5 } },
];

// Normalise every geometry to the same bounding-sphere radius so all 12 shapes
// look the same size in-frame. Without this, the cube reads huge next to the
// capsule, and the active-state framing varies wildly between objects.
const TARGET_BSPHERE_R = 0.9;
shapeDefs.forEach((d) => {
  d.geo.computeBoundingSphere();
  const r = d.geo.boundingSphere.radius;
  if (r > 0) d.geo.scale(TARGET_BSPHERE_R / r, TARGET_BSPHERE_R / r, TARGET_BSPHERE_R / r);
  d.geo.computeBoundingSphere();
});

// ──────────────────── PER-SHAPE METADATA (for the click-detail panel) ────────────────────
// `accent` drives the panel's wire colour, banner glow, and corner-dot tint.
// Chosen to read against the dark scene rather than the shape's literal colour
// (most shapes are white glass or chrome — a white accent would vanish).
const metas = [
  { code: 'MTRL_01_CHRM', accent: 0x88c8ff, year: '04.29.2026', display: 'CHROME SPHERE',
    description: 'Polished aluminium mirror — iridescent thin-film at glancing angles.' },
  { code: 'GLSS_02_RPTL', accent: 0xff80c0, year: '11.18.2024', display: 'ROSE GLASS CUBE',
    description: 'Soda-lime cube — rose-petal volumetric attenuation across 1.2u.' },
  { code: 'METL_03_GOLD', accent: 0xffd66d, year: '07.02.2023', display: 'BRUSHED GOLD KNOT',
    description: 'Anisotropic specular along the sweep — warm 1800K reflection.' },
  { code: 'GLSS_04_FRST', accent: 0xa0e0ff, year: '02.14.2025', display: 'FROSTED PANEL',
    description: 'Translucent cyan glass — light scatters across the volume.' },
  { code: 'WAX_05_SUBS',  accent: 0xffc080, year: '09.30.2024', display: 'WAX / SOAP',
    description: 'Subsurface-style amber transmission. Soft attenuation at 0.5u.' },
  { code: 'GEM_06_DMND',  accent: 0xc8f0ff, year: '12.05.2025', display: 'DIAMOND GEM',
    description: 'Cubic diamond, IOR 2.4 — total internal reflection across facets.' },
  { code: 'BIO_07_PEARL', accent: 0xffd0e0, year: '03.21.2026', display: 'PEARL',
    description: 'Mother-of-pearl — iridescent layer 600–1200nm thick.' },
  { code: 'METL_08_TI',   accent: 0x9080ff, year: '06.11.2024', display: 'ANODISED TITANIUM',
    description: 'Surface oxide tints by viewing angle. Aerospace alloy.' },
  { code: 'PNT_09_LCQR',  accent: 0xff4060, year: '08.04.2025', display: 'CAR PAINT VASE',
    description: 'Two-coat automotive lacquer — mirror clearcoat over red base.' },
  { code: 'TXTL_10_VLVT', accent: 0xff80c0, year: '01.27.2026', display: 'VELVET RIBBON',
    description: 'Velvet sheen shader — pink rim under raking light.' },
  { code: 'LIQ_11_HG',    accent: 0xc0e0ff, year: '10.10.2024', display: 'LIQUID MERCURY',
    description: 'Mirror-perfect at zero roughness. Most reflective liquid known.' },
  { code: 'TXTL_12_SILK', accent: 0xff8060, year: '05.04.2026', display: 'SILK STAR',
    description: 'Anisotropic silk sheen — warm thread at micro scale.' },
];

// ──────────────────── RANDOM-SPHERE SCATTER (with no-overlap constraint) ────────────────────
// Pure uniform random unit-sphere direction per shape, but rejection-sample
// against previously placed targets so no two shapes land within MIN_GAP of
// each other. With normalised geometry (~radius 0.9) and a 3.6-unit minimum
// centre-to-centre gap, debris always reads as separate objects.
const interactables = [];
const placedPositions = [];
const MIN_GAP = 3.6;

function randomUnitVector() {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(theta), u, s * Math.sin(theta));
}

shapeDefs.forEach((d, i) => {
  const mat = new THREE.MeshPhysicalMaterial({
    color:           d.hex,
    metalness:       0.55,
    roughness:       0.18,
    envMapIntensity: 1.0,
    ...d.props,
  });
  const mesh = new THREE.Mesh(d.geo, mat);

  // Rejection-sample a target position that's at least MIN_GAP from every
  // previously placed shape. After 60 attempts, accept whatever we have
  // (extreme edge case — should never happen for 12 shapes in radius 7..13).
  let target;
  for (let attempt = 0; attempt < 60; attempt++) {
    const dir = randomUnitVector();
    const radius = 7 + Math.random() * 6;       // 7 .. 13
    target = dir.multiplyScalar(radius);
    const tooClose = placedPositions.some((p) => p.distanceTo(target) < MIN_GAP);
    if (!tooClose) break;
  }
  placedPositions.push(target.clone());

  // Random tumble target: each shape spins ~24 rad on each axis during the burst.
  const tumble = new THREE.Vector3(
    (Math.random() - 0.5) * 24,
    (Math.random() - 0.5) * 24,
    (Math.random() - 0.5) * 24,
  );

  mesh.position.set(0, 0, 0);
  mesh.scale.setScalar(0.001);
  mesh.rotation.set(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
  );
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  mesh.userData = {
    name:  d.name,
    index: i,
    meta:  metas[i],
    target,
    tumble,
    targetScale: 1,
    // Per-shape ambient spin — wider variance so the field has more visible motion.
    spin: new THREE.Vector3(
      (Math.random() - 0.5) * 0.008,
      (Math.random() - 0.5) * 0.008,
      (Math.random() - 0.5) * 0.008,
    ),
  };
  scene.add(mesh);
  interactables.push(mesh);
});

// ──────────────────── INTRO EXPLOSION ────────────────────
// 2 s pause, then a synchronised bang. All shapes leave the origin at the SAME
// instant — only their per-shape duration is randomised so they arrive ragged.
// The "bang light" is two layered effects at the origin:
//   1. Flash sphere — additive-blended white sphere that pops 0→10 in 0.18s
//      and fades opacity 1→0 over 0.5s
//   2. Point light pulse — high-intensity warm light that lights every PBR
//      surface from the origin for one frame, decaying over 0.4s

const flashGeo = new THREE.SphereGeometry(1, 24, 16);
const flashMat = new THREE.MeshBasicMaterial({
  color: 0xfff5ee,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const flash = new THREE.Mesh(flashGeo, flashMat);
flash.scale.setScalar(0.001);
scene.add(flash);

const flashLight = new THREE.PointLight(0xfff5ee, 0, 60, 1.0);
flashLight.position.set(0, 0, 0);
scene.add(flashLight);

// The intro is gated on the user dismissing the audio gate. Two phases:
//   T=0..INTRO_DELAY   — BIG BANG SINGULARITY: a brilliant point of light at
//                         origin grows + brightens, with shockwave rings
//                         pulsing outward in quickening rhythm.
//   T=INTRO_DELAY      — DETONATION: the singularity flashes outward, the
//                         12 objects are *born* from the point and scatter.
const INTRO_DELAY = 3.0;
let explosionTriggered = false;
function triggerExplosion() {
  if (explosionTriggered) return;
  explosionTriggered = true;

  audio.charge();   // 3s riser

  // ── PHASE 1 — BIG BANG singularity at origin ───────────────────────────
  // A bright additive sphere + a hot point light, both growing. Around them
  // shockwave rings pulse outward at quickening intervals as energy builds.
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 4), coreMat);
  core.scale.setScalar(0.05);
  scene.add(core);

  const coreLight = new THREE.PointLight(0xffffff, 1, 60, 1.6);
  coreLight.position.set(0, 0, 0);
  scene.add(coreLight);

  // Core grows + light intensifies, both with `power3.in` so the energy
  // accelerates toward the moment of detonation.
  gsap.to(core.scale, { x: 1.1, y: 1.1, z: 1.1, duration: INTRO_DELAY, ease: 'power3.in' });
  gsap.to(coreLight,  { intensity: 70,            duration: INTRO_DELAY, ease: 'power3.in' });

  // Subtle organic wobble so the core feels alive, not just inflating.
  const wobbleTween = gsap.to(core.scale, {
    x: '+=0.08', y: '+=0.08', z: '+=0.08',
    duration: 0.18, repeat: -1, yoyo: true, ease: 'sine.inOut',
  });

  // Shockwave rings — quickening rhythm: 0.6s → 0.18s between spawns.
  const ringMats = [];
  const ringMeshes = [];
  function spawnRing() {
    const ringGeo = new THREE.RingGeometry(0.4, 0.6, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    // Always face the camera so it reads as an expanding wave.
    ring.lookAt(camera.position);
    scene.add(ring);
    ringMats.push(ringMat); ringMeshes.push(ring);
    gsap.to(ring.scale, { x: 14, y: 14, z: 14, duration: 1.4, ease: 'power2.out' });
    gsap.to(ringMat,    { opacity: 0,            duration: 1.4, ease: 'power2.out',
      onComplete: () => { scene.remove(ring); ringGeo.dispose(); ringMat.dispose(); } });
  }
  // Spawn rings at quickening intervals over the 3s.
  const ringTimes = [0.20, 0.75, 1.25, 1.65, 2.00, 2.30, 2.55, 2.75, 2.90];
  const ringCalls = ringTimes.map((t) => gsap.delayedCall(t, spawnRing));

  // ── PHASE 2 — DETONATION at T=INTRO_DELAY ─────────────────────────────
  gsap.delayedCall(INTRO_DELAY, () => {
    audio.boom();
    wobbleTween.kill();
    ringCalls.forEach((c) => c.kill());

    // The singularity erupts and dissolves
    gsap.to(core.scale, { x: 6, y: 6, z: 6, duration: 0.35, ease: 'power3.out' });
    gsap.to(coreMat, { opacity: 0, duration: 0.6, ease: 'power2.out',
      onComplete: () => { scene.remove(core); core.geometry.dispose(); coreMat.dispose(); } });
    gsap.to(coreLight, { intensity: 0, duration: 1.2, ease: 'expo.out',
      onComplete: () => scene.remove(coreLight) });

    // Bang flash + outer light pulse (the white-out moment)
    flashMat.opacity = 1;
    gsap.to(flash.scale, { x: 18, y: 18, z: 18, duration: 0.40, ease: 'power2.out' });
    gsap.to(flashMat,    { opacity: 0,           duration: 0.95, ease: 'power2.out',
      onComplete: () => { scene.remove(flash); flashGeo.dispose(); flashMat.dispose(); } });
    flashLight.intensity = 110;
    gsap.to(flashLight, { intensity: 0, duration: 0.95, ease: 'expo.out',
      onComplete: () => scene.remove(flashLight) });

    // The 12 objects are BORN from the singularity — start at origin scale 0,
    // explode outward with the same scatter targets as before.
    interactables.forEach((mesh) => {
      const t  = mesh.userData.target;
      const tu = mesh.userData.tumble;
      const dur = 2.2 + Math.random() * 0.9;

      mesh.position.set(0, 0, 0);
      mesh.scale.setScalar(0.001);

      gsap.to(mesh.position, { x: t.x, y: t.y, z: t.z,                 duration: dur,        ease: 'expo.out'     });
      gsap.to(mesh.rotation, { x: `+=${tu.x}`, y: `+=${tu.y}`, z: `+=${tu.z}`,
                               duration: dur,        ease: 'power3.out'   });
      gsap.to(mesh.scale,    { x: 1, y: 1, z: 1,                       duration: dur * 0.85, ease: 'back.out(1.5)' });
    });
  });
}

// ──────────────────── DETAIL PANEL — Solo-Leveling banner + floating labels ────────────────────
const panel       = document.getElementById('detail-panel');
const dpBannerTxt = panel.querySelector('.dp-banner-text');
const dpCode      = panel.querySelector('.dp-code');
const dpIdxVal    = panel.querySelector('.dp-idx-val');
const dpYear      = panel.querySelector('.dp-year');
const dpDesc      = panel.querySelector('.dp-desc');
const dpClose     = panel.querySelector('.dp-close');
const dpPrev      = panel.querySelector('.dp-nav-prev');
const dpNext      = panel.querySelector('.dp-nav-next');

// Each "key" maps an SVG polyline + a floating label. Labels are positioned every
// frame as { object_screen_pos + offset } so they orbit around the object.
const FLOAT_KEYS = ['banner', 'code', 'idx', 'year', 'desc'];
const wires  = {};
const floats = {};
const innerBanner = panel.querySelector('.dp-banner-wrap .dp-banner');
// drawFactor is animated 0→1 by the reveal timeline (or back to 0 by hide).
// updateLayout uses it to set stroke-dashoffset, so the polyline literally
// draws out from the object toward the label.
const drawFactor = { banner: 0, code: 0, idx: 0, year: 0, desc: 0 };
for (const k of FLOAT_KEYS) {
  wires[k]  = panel.querySelector(`.dp-wire[data-key="${k}"]`);
  floats[k] = panel.querySelector(`.dp-float[data-key="${k}"]`);
}

// All labels orbit the active object. Direction unit vectors are scaled by
// the per-label `dist` to give the label its position on screen.
//
// Corner labels use shallow vertical components (uy ≈ ±0.40) so the line
// from the label to the object travels mostly horizontally before bending
// 45° — the user wants a long straight segment from the content.
//
// Banner has its own dist (screenR + margin) so it sits just above the
// silhouette regardless of how big the object renders.
function getOffsets(screenR) {
  const orbitDist  = Math.max(screenR * 1.7, 350);
  const bannerDist = screenR + 60;          // tighter gap between title and object
  return {
    banner: { ux:  0,    uy: -1.00, dist: bannerDist },
    code:   { ux: -0.92, uy: -0.40, dist: orbitDist  },
    idx:    { ux:  0.92, uy: -0.40, dist: orbitDist  },
    year:   { ux: -0.92, uy:  0.45, dist: orbitDist  },
    desc:   { ux:  0.92, uy:  0.45, dist: orbitDist  },
  };
}

// Each label is anchored at the CENTRE of the edge that faces the object —
// the wire connects perpendicular to that edge, content reads as centred
// on the line.
const ANCHOR_TRANSFORM = {
  banner: 'translate(-50%, -100%)',  // bottom-centre — banner extends upward
  code:   'translate(-100%, -50%)',  // right-edge centre — label is up-left
  idx:    'translate(0%, -50%)',     // left-edge centre  — label is up-right
  year:   'translate(-100%, -50%)',  // right-edge centre — label is down-left
  desc:   'translate(0%, -50%)',     // left-edge centre  — label is down-right
};

// Tiny breathing gap between the wire's tip and the content's edge.
const WIRE_LABEL_GAP = 12;

let panelOpen     = false;
let activeObj     = null;
let panelClosedAt = 0;

const tmpProj = new THREE.Vector3();
function projectToScreen(worldPos) {
  tmpProj.copy(worldPos).project(camera);
  return {
    x: (tmpProj.x + 1) * 0.5 * window.innerWidth,
    y: (1 - tmpProj.y) * 0.5 * window.innerHeight,
  };
}

// Approximate screen radius of the active object using its bounding sphere.
// We use this to start each line stub OUTSIDE the object's silhouette.
function objectScreenRadius() {
  const geo = activeObj.geometry;
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const worldR = geo.boundingSphere.radius * Math.max(activeObj.scale.x, activeObj.scale.y, activeObj.scale.z);
  const dist = camera.position.distanceTo(activeObj.position);
  const fov2 = THREE.MathUtils.degToRad(camera.fov) / 2;
  return (worldR / dist) / Math.tan(fov2) * (window.innerHeight / 2);
}

function updateLayout() {
  if (!activeObj) return;
  const obj = projectToScreen(activeObj.position);
  const screenR = objectScreenRadius();
  const offs = getOffsets(screenR);

  for (const k of FLOAT_KEYS) {
    const o = offs[k];
    // Label anchor (= wire endpoint) sits at obj_centre + offset_unit * dist.
    const lx = obj.x + o.ux * o.dist;
    const ly = obj.y + o.uy * o.dist;
    const el = floats[k];
    // Label visual extends FROM (lx, ly) outward — its "near corner" lands
    // exactly at the line tip.
    el.style.transform = `translate(${lx}px, ${ly}px) ${ANCHOR_TRANSFORM[k]}`;

    // Wire start: just outside object silhouette in the direction of the label
    const len = Math.hypot(o.ux, o.uy) || 1;
    const ux = o.ux / len, uy = o.uy / len;
    const sx = obj.x + ux * (screenR + 14);
    const sy = obj.y + uy * (screenR + 14);

    // Wire end: a small gap before the centre of the label's near edge.
    // The last segment is horizontal for corner labels (uy small) and vertical
    // for the banner (ux=0); we shift the endpoint along the dominant axis so
    // the line stops just before the content edge with a clean breathing gap.
    let ex, ey;
    if (Math.abs(o.ux) > Math.abs(o.uy)) {
      ex = lx - Math.sign(o.ux) * WIRE_LABEL_GAP;
      ey = ly;
    } else {
      ex = lx;
      ey = ly - Math.sign(o.uy) * WIRE_LABEL_GAP;
    }

    // Polyline elbow with a 45° diagonal. The line leaves the LABEL straight
    // along the dominant axis (horizontal or vertical), then bends 45° to
    // reach the object. The bend angle is therefore one of 45° / 135° /
    // 225° / 315° — never a flat 90° L.
    const stubLen = Math.hypot(ex - sx, ey - sy);
    const sameDir = (ex - sx) * ux + (ey - sy) * uy > 0;
    let pts;
    if (stubLen < 6 || !sameDir) {
      pts = `${sx},${sy} ${sx},${sy} ${sx},${sy}`;
    } else {
      const ddx = sx - ex;            // signed delta from label endpoint to object endpoint
      const ddy = sy - ey;
      const adx = Math.abs(ddx);
      const ady = Math.abs(ddy);
      let elbowX, elbowY;
      if (adx > ady + 1) {
        // Horizontal-dominant: line leaves label horizontally, then 45° diagonal
        elbowX = sx - Math.sign(ddx) * ady;
        elbowY = ey;
      } else if (ady > adx + 1) {
        // Vertical-dominant: line leaves label vertically, then 45° diagonal
        elbowX = ex;
        elbowY = sy - Math.sign(ddy) * adx;
      } else {
        // Already on a 45° diagonal — no bend needed
        elbowX = (sx + ex) / 2;
        elbowY = (sy + ey) / 2;
      }
      pts = `${sx},${sy} ${elbowX},${elbowY} ${ex},${ey}`;
    }
    wires[k].setAttribute('points', pts);

    // Draw-in animation via stroke-dashoffset.
    // getTotalLength reads the actual polyline path length each frame.
    const pathLen = wires[k].getTotalLength();
    wires[k].style.strokeDasharray  = `${pathLen}`;
    wires[k].style.strokeDashoffset = `${pathLen * (1 - drawFactor[k])}`;
  }
}

// ─── Text-scramble decoder effect — random chars resolve to the final string ───
const SCRAMBLE_CHARS = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&_+/';
function scrambleText(el, target, duration = 0.7) {
  if (el._scrambleTimer) {
    clearInterval(el._scrambleTimer);
    el._scrambleTimer = null;
  }
  const start = performance.now();
  const ms    = duration * 1000;
  const len   = target.length;
  const step  = () => {
    const t = (performance.now() - start) / ms;
    if (t >= 1) {
      el.textContent = target;
      clearInterval(el._scrambleTimer);
      el._scrambleTimer = null;
      return;
    }
    let out = '';
    for (let i = 0; i < len; i++) {
      // Each char "locks in" at a fraction (0.2 → 0.95 across the string)
      const lock = 0.2 + (i / Math.max(1, len - 1)) * 0.75;
      const ch   = target[i];
      // Preserve whitespace + structural punctuation so the scramble reads
      // as letters/digits decoding while the punctuation stays anchored.
      if (t >= lock || /[\s.,;:_\-/—–()]/.test(ch)) {
        out += ch;
      } else {
        out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      }
    }
    el.textContent = out;
  };
  el._scrambleTimer = setInterval(step, 33);
  step();
}

// Just sets the static text (no animation) — used during the hide phase
// so a Next/Prev nav can update content while it's invisible.
function populatePanel(obj) {
  const m   = obj.userData.meta;
  const idx = obj.userData.index + 1;
  dpBannerTxt.textContent = m.display;
  dpCode.textContent      = m.code;
  dpIdxVal.textContent    = String(idx).padStart(2, '0') + ' / ' + String(interactables.length).padStart(2, '0');
  dpYear.textContent      = m.year;
  dpDesc.textContent      = m.description;
}

// ─── Reveal / hide choreography ─────────────────────────────────────────────
let revealTL = null;
let hideTL   = null;

function killTimelines() {
  if (revealTL) { revealTL.kill(); revealTL = null; }
  if (hideTL)   { hideTL.kill();   hideTL   = null; }
  // Stop any in-flight text scrambles so navigation doesn't write old chars
  // into the new content's element.
  for (const el of [dpBannerTxt, dpCode, dpIdxVal, dpYear, dpDesc]) {
    if (el._scrambleTimer) {
      clearInterval(el._scrambleTimer);
      el._scrambleTimer = null;
    }
  }
}

// Hand the panel to the reveal animation: wires draw out, banner slams in,
// labels fade in, content text scrambles to its final value.
function revealContent(obj) {
  killTimelines();
  const m = obj.userData.meta;
  const idx = obj.userData.index + 1;

  // One stat-up bell per reveal (initial open AND each prev/next navigation).
  audio.tick();

  // Reset to invisible starting state
  for (const k of FLOAT_KEYS) drawFactor[k] = 0;
  gsap.set([floats.banner, floats.code, floats.idx, floats.year, floats.desc], { opacity: 0 });
  gsap.set(innerBanner, { y: -40, scale: 0.94, opacity: 0 });

  // Clear text so the scramble starts from empty (avoids a flash of old content)
  dpBannerTxt.textContent = '';
  dpCode.textContent      = '';
  dpIdxVal.textContent    = '';
  dpYear.textContent      = '';
  dpDesc.textContent      = '';

  const idxStr = String(idx).padStart(2, '0') + ' / ' + String(interactables.length).padStart(2, '0');

  revealTL = gsap.timeline({ onComplete: () => { revealTL = null; } });
  revealTL
    // 1. Wires draw out from the object (staggered)
    .to(drawFactor, { banner: 1, duration: 0.45, ease: 'power2.out' },        0.10)
    .to(drawFactor, { code:   1, duration: 0.40, ease: 'power2.out' },        0.20)
    .to(drawFactor, { idx:    1, duration: 0.40, ease: 'power2.out' },        0.26)
    .to(drawFactor, { year:   1, duration: 0.40, ease: 'power2.out' },        0.32)
    .to(drawFactor, { desc:   1, duration: 0.40, ease: 'power2.out' },        0.38)
    // 2. Banner slams in from above with overshoot
    .to(floats.banner, { opacity: 1, duration: 0.30, ease: 'power2.out' },    0.30)
    .to(innerBanner, { y: 0, scale: 1, opacity: 1, duration: 0.55, ease: 'back.out(1.6)' },
                                                                              0.30)
    // 3. Labels fade in at the wire endpoints
    .to(floats.code, { opacity: 1, duration: 0.35, ease: 'power2.out' },      0.55)
    .to(floats.idx,  { opacity: 1, duration: 0.35, ease: 'power2.out' },      0.62)
    .to(floats.year, { opacity: 1, duration: 0.35, ease: 'power2.out' },      0.70)
    .to(floats.desc, { opacity: 1, duration: 0.35, ease: 'power2.out' },      0.78)
    // 4. Scramble decoder runs concurrently with each label's fade-in
    // Slower scramble — the decoder tickers more leisurely so each character
    // is readable as it locks in. Description gets the longest duration since
    // it has the most characters to resolve.
    .call(() => scrambleText(dpBannerTxt, m.display,     1.40),                null, 0.30)
    .call(() => scrambleText(dpCode,      m.code,        1.05),                null, 0.55)
    .call(() => scrambleText(dpIdxVal,    idxStr,        1.05),                null, 0.62)
    .call(() => scrambleText(dpYear,      m.year,        1.05),                null, 0.70)
    .call(() => scrambleText(dpDesc,      m.description, 1.80),                null, 0.82);
}

// Reverse: labels fade, wires retract, banner exits. Returns a timeline so the
// caller (navigateBy) can chain the camera-fly off its onComplete.
function hideContent() {
  killTimelines();
  hideTL = gsap.timeline({ onComplete: () => { hideTL = null; } });
  hideTL
    .to([floats.desc, floats.year, floats.idx, floats.code], {
      opacity: 0, duration: 0.20, ease: 'power2.in', stagger: 0.04,
    },                                                                         0)
    .to(drawFactor, { banner: 0, code: 0, idx: 0, year: 0, desc: 0,
                      duration: 0.25, ease: 'power2.in' },                     0.05)
    .to(innerBanner, { y: -30, opacity: 0, scale: 0.96, duration: 0.30, ease: 'power2.in' },
                                                                               0.05)
    .to(floats.banner, { opacity: 0, duration: 0.30, ease: 'power2.in' },      0.05);
  return hideTL;
}

// Active scale: the object pops up slightly when it's the panel focus.
// Stops short of overflowing because stopDist already gave room.
const ACTIVE_SCALE = 1.2;

function tweenActiveScale(obj, to, duration = 0.6, ease = 'power2.out') {
  gsap.to(obj.scale, { x: to, y: to, z: to, duration, ease });
}

function openPanel(obj) {
  activeObj = obj;
  panel.classList.add('is-open');
  document.body.classList.add('panel-open');
  panelOpen = true;
  audio.swoosh(true);
  tweenActiveScale(obj, ACTIVE_SCALE, 0.6, 'power2.out');
  revealContent(obj);
}

function closePanel() {
  if (!panelOpen) return;
  killTimelines();
  audio.swoosh(false);
  if (activeObj) tweenActiveScale(activeObj, 1, 0.45, 'power2.in');
  panel.classList.remove('is-open');
  document.body.classList.remove('panel-open');
  panelOpen = false;
  activeObj = null;
  panelClosedAt = performance.now();
}

function navigateBy(delta) {
  if (!activeObj || flyingLock) return;
  const idx  = interactables.indexOf(activeObj);
  const next = interactables[(idx + delta + interactables.length) % interactables.length];
  // 1. Hide current content + ease the old active back to scale 1 + close-swoosh
  // 2. Swap activeObj + populate (invisible)
  // 3. Camera flies to next (panel stays open)
  // 4. On arrival: scale new active up + open-swoosh + reveal content
  const oldActive = activeObj;
  audio.swoosh(false);
  const hide = hideContent();
  tweenActiveScale(oldActive, 1, 0.4, 'power2.in');
  hide.eventCallback('onComplete', () => {
    activeObj = next;
    populatePanel(next);
    flyToObject(next, (arrived) => {
      tweenActiveScale(arrived, ACTIVE_SCALE, 0.6, 'power2.out');
      audio.swoosh(true);
      revealContent(arrived);
    });
  });
}

dpClose.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
dpPrev .addEventListener('click', (e) => { e.stopPropagation(); navigateBy(-1); });
dpNext .addEventListener('click', (e) => { e.stopPropagation(); navigateBy(+1); });
window.addEventListener('keydown', (e) => {
  if (!panelOpen) return;
  if (e.key === 'Escape')          closePanel();
  else if (e.key === 'ArrowLeft')  navigateBy(-1);
  else if (e.key === 'ArrowRight') navigateBy(+1);
});

// ─── Sound toggle + first-gesture audio unlock ─────────────────────────────
const soundToggle = document.getElementById('sound-toggle');
const soundState  = soundToggle.querySelector('.st-state');
// Default to ON — only OFF if the user has explicitly toggled it off before.
// Browser autoplay policy still blocks the AudioContext until the first user
// gesture; unlockOnFirstGesture below kicks in the moment that happens.
let soundOn = (() => {
  try { return localStorage.getItem('drift-sound-on') !== 'false'; } catch { return true; }
})();

function applySoundToggle() {
  soundToggle.classList.toggle('is-on', soundOn);
  soundState.textContent = soundOn ? 'ON' : 'OFF';
}
applySoundToggle();

soundToggle.addEventListener('click', () => {
  soundOn = !soundOn;
  try { localStorage.setItem('drift-sound-on', soundOn); } catch {}
  applySoundToggle();
  audio.ensureContext();
  audio.setEnabled(soundOn);
});

// Browsers block AudioContext until a user gesture. If sound is persisted ON,
// we still need ANY gesture (click, key, scroll, touch) before the ambient
// drone can play. The intro "click to enter" gate captures that gesture
// intentionally; the broader unlockOnFirstGesture is a fallback for cases
// where the user dismissed the gate without clicking it (e.g. via dev-tools).
const audioGate = document.getElementById('audio-gate');
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (soundOn) {
    audio.ensureContext();
    audio.setEnabled(true);
  }
  soundToggle.classList.remove('is-waiting');
  UNLOCK_EVENTS.forEach((ev) =>
    window.removeEventListener(ev, unlockAudio, { passive: true }),
  );
  // Gate dismissed → kick off the explosion intro now (and only now).
  triggerExplosion();
  audioGate?.classList.add('is-dismissed');
}
soundToggle.classList.toggle('is-waiting', soundOn);
UNLOCK_EVENTS.forEach((ev) =>
  window.addEventListener(ev, unlockAudio, { passive: true }),
);

// Hover-to-rescramble: the title and EVERY content label re-decode their
// current text whenever the cursor enters them. Only fires while the panel
// is open and the element has settled text.
[
  { el: dpBannerTxt, dur: 0.85 },
  { el: dpCode,      dur: 0.55 },
  { el: dpIdxVal,    dur: 0.55 },
  { el: dpYear,      dur: 0.55 },
  { el: dpDesc,      dur: 1.20 },
].forEach(({ el, dur }) => {
  el.addEventListener('mouseenter', () => {
    if (!panelOpen) return;
    const cur = el.textContent;
    if (!cur) return;
    audio.tick();
    scrambleText(el, cur, dur);
  });
});

// ──────────────────── POST-PROCESSING ────────────────────
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());

// ──────────────────── FIRST-PERSON CAMERA STATE ────────────────────
// We keep yaw / pitch as the source of truth, then rebuild the camera quaternion
// each frame. This avoids accumulating drift from incremental rotateY / rotateX.
const view = {
  yaw:   0,                      // rotation around world-up
  pitch: 0,                      // -π/2..+π/2 to avoid flipping
  yawTarget:   0,
  pitchTarget: 0,
};

function applyView() {
  const e = new THREE.Euler(view.pitch, view.yaw, 0, 'YXZ');
  camera.quaternion.setFromEuler(e);
}

// Forward direction implied by current yaw/pitch.
function forwardVector(out = new THREE.Vector3()) {
  out.set(0, 0, -1).applyQuaternion(camera.quaternion);
  return out;
}

// ──────────────────── INPUT — drag to look (or rotate object), click to fly ─────
// At pointerdown we raycast: if a shape is hit, drag rotates THAT shape.
// If empty space, drag rotates the camera view (yaw/pitch).
// A pointerup with no movement past the threshold is treated as a click instead.
const DRAG_THRESHOLD_PX  = 4;
const VIEW_SENSITIVITY   = 0.0035;   // radians per pixel — view drag
const OBJECT_SENSITIVITY = 0.01;     // radians per pixel — object drag
const PITCH_LIMIT        = Math.PI / 2 - 0.05;

let isPointerDown = false;
let dragMoved     = false;
let dragMode      = null;            // 'view' | 'object'
let dragTarget    = null;            // shape being rotated (when dragMode === 'object')
let downX = 0, downY = 0;
let lastX = 0, lastY = 0;

const mouseNdc  = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let hovered     = null;
let flyingLock  = false;            // while a click-fly tween is running, ignore wheel/clicks

// Scratch math state for camera-space drag rotation (avoid GC each frame)
const _camAxis = new THREE.Vector3();
const _qDelta  = new THREE.Quaternion();

function setCursor(state) {
  document.body.classList.toggle('cursor-grab',     state === 'grab');
  document.body.classList.toggle('cursor-grabbing', state === 'grabbing');
}

window.addEventListener('pointerdown', (e) => {
  if (flyingLock) return;

  // Panel-open mode: drag rotates the active object. Clicks on the panel's
  // own buttons are ignored (their click handlers fire normally).
  if (panelOpen) {
    if (e.target.closest('.dp-close, .dp-nav')) return;
    isPointerDown = true;
    dragMoved = false;
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    dragMode   = 'object';
    dragTarget = activeObj;
    setCursor('grabbing');
    return;
  }

  isPointerDown = true;
  dragMoved = false;
  downX = lastX = e.clientX;
  downY = lastY = e.clientY;

  // Decide drag mode now: hit a shape → object drag, otherwise → view drag.
  mouseNdc.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  mouseNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseNdc, camera);
  const hits = raycaster.intersectObjects(interactables, false);
  if (hits.length > 0) {
    dragMode   = 'object';
    dragTarget = hits[0].object;
  } else {
    dragMode   = 'view';
    dragTarget = null;
  }
  setCursor('grabbing');
});

window.addEventListener('pointermove', (e) => {
  mouseNdc.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  mouseNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;

  if (!isPointerDown) return;

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;

  if (Math.abs(e.clientX - downX) > DRAG_THRESHOLD_PX || Math.abs(e.clientY - downY) > DRAG_THRESHOLD_PX) {
    dragMoved = true;
  }

  if (dragMode === 'object' && dragTarget) {
    // Camera-space rotation with "trackball" feel — the surface follows the
    // cursor (drag right → grabbed point moves right, drag down → moves down).
    _camAxis.setFromMatrixColumn(camera.matrixWorld, 1);   // camera up
    _qDelta.setFromAxisAngle(_camAxis, dx * OBJECT_SENSITIVITY);
    dragTarget.quaternion.premultiply(_qDelta);

    _camAxis.setFromMatrixColumn(camera.matrixWorld, 0);   // camera right
    _qDelta.setFromAxisAngle(_camAxis, dy * OBJECT_SENSITIVITY);
    dragTarget.quaternion.premultiply(_qDelta);
  } else {
    view.yawTarget   -= dx * VIEW_SENSITIVITY;
    view.pitchTarget -= dy * VIEW_SENSITIVITY;
    view.pitchTarget = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, view.pitchTarget));
  }
});

window.addEventListener('pointerup', (e) => {
  if (!isPointerDown) return;
  isPointerDown = false;
  const wasMode   = dragMode;
  const wasTarget = dragTarget;
  const wasInPanel = panelOpen;
  dragMode = null;
  dragTarget = null;
  setCursor(hovered ? 'grab' : 'default');

  // While the panel was open, a no-drag click does nothing (use Close / Esc / wheel).
  if (wasInPanel) return;

  // No drag → it's a click. Object click flies to it; empty click lunges along ray.
  if (!dragMoved && !flyingLock) {
    if (wasMode === 'object' && wasTarget) flyToObject(wasTarget);
    else                                   handleClick(e);
  }
});

// Wheel = swim along view direction. Velocity accumulates and decays in tick().
let swimVelocity = 0;
const SWIM_PER_NOTCH = 0.45;     // halved — slower, weightier zoom
const SWIM_DAMPING   = 0.88;

window.addEventListener('wheel', (e) => {
  e.preventDefault();
  // While the detail panel is open, ANY wheel input closes it.
  // A 350 ms grace period after close prevents the same wheel motion from
  // immediately driving a swim forward.
  if (panelOpen) { closePanel(); return; }
  if (flyingLock) return;
  if (performance.now() - panelClosedAt < 350) return;
  // deltaY > 0 = scroll down = swim forward; flip sign so positive = forward
  swimVelocity += -Math.sign(e.deltaY) * SWIM_PER_NOTCH * 0.18;
}, { passive: false });

// ──────────────────── CLICK → FLY TO TARGET ────────────────────
// onArrive lets navigateBy() reuse this without re-opening the panel:
//   • clicking a shape: onArrive defaults to openPanel(obj)
//   • prev/next navigation: onArrive=null (panel stays open, content already swapped)
function flyToObject(obj, onArrive = openPanel) {
  const objPos = obj.position.clone();
  // Frame the object: stand back along the camera-to-object direction.
  const camToObj = objPos.clone().sub(camera.position).normalize();
  // Distance is generous enough that the active-state scale-up (≈1.2×) never
  // overflows the viewport, and there's room for labels to orbit cleanly.
  const stopDist = 3.6;
  const stopPos  = objPos.clone().sub(camToObj.multiplyScalar(stopDist));

  // Aim slightly ABOVE the object — pushes the object below screen-centre
  // so the title banner has clearance at the top of the frame.
  const FRAMING_UP = 0.25;
  const lookAt = objPos.clone().add(new THREE.Vector3(0, FRAMING_UP, 0));
  const aim = lookAt.clone().sub(stopPos).normalize();
  const targetYaw   = Math.atan2(-aim.x, -aim.z);
  const targetPitch = Math.asin(aim.y);

  // Pick the closest equivalent yaw to current to avoid the long way around.
  let yawGoal = targetYaw;
  while (yawGoal - view.yawTarget >  Math.PI) yawGoal -= Math.PI * 2;
  while (yawGoal - view.yawTarget < -Math.PI) yawGoal += Math.PI * 2;

  flyingLock = true;
  swimVelocity = 0;
  audio.whoosh(1.4);

  gsap.to(camera.position, {
    x: stopPos.x, y: stopPos.y, z: stopPos.z,
    duration: 1.6,
    ease: 'power3.inOut',
  });
  gsap.to(view, {
    yawTarget: yawGoal,
    pitchTarget: targetPitch,
    duration: 1.6,
    ease: 'power3.inOut',
    onComplete: () => {
      flyingLock = false;
      if (onArrive) onArrive(obj);
    },
  });
}

function lungeAlongRay(rayDir) {
  const dist = 5;
  const target = camera.position.clone().add(rayDir.multiplyScalar(dist));
  flyingLock = true;
  swimVelocity = 0;
  gsap.to(camera.position, {
    x: target.x, y: target.y, z: target.z,
    duration: 1.0,
    ease: 'power2.out',
    onComplete: () => { flyingLock = false; },
  });
}

function handleClick() {
  raycaster.setFromCamera(mouseNdc, camera);
  const hits = raycaster.intersectObjects(interactables, false);
  if (hits.length > 0) {
    flyToObject(hits[0].object);
  } else {
    lungeAlongRay(raycaster.ray.direction.clone());
  }
}

// ──────────────────── RENDER LOOP ────────────────────
const tmpFwd = new THREE.Vector3();

function tick() {
  // 1. Smooth view toward target yaw/pitch (drag eases in).
  view.yaw   += (view.yawTarget   - view.yaw)   * 0.18;
  view.pitch += (view.pitchTarget - view.pitch) * 0.18;
  applyView();

  // 2. Swim — velocity along forward direction, decays each frame.
  if (Math.abs(swimVelocity) > 0.0005 && !flyingLock) {
    forwardVector(tmpFwd).multiplyScalar(swimVelocity);
    camera.position.add(tmpFwd);
    swimVelocity *= SWIM_DAMPING;
  }
  // Drive continuous swim noise — louder when scrolling fast, silent at rest.
  audio.setSwimIntensity(Math.abs(swimVelocity) * 8);

  // 3. Raycast for hover (skip while pointer is down — they're looking around).
  if (!isPointerDown && !flyingLock && !panelOpen) {
    raycaster.setFromCamera(mouseNdc, camera);
    const hits = raycaster.intersectObjects(interactables, false);
    const newHover = hits.length > 0 ? hits[0].object : null;
    if (newHover !== hovered) {
      if (hovered) hovered.userData.targetScale = 1;
      hovered = newHover;
      if (hovered) hovered.userData.targetScale = 1.18;
      setCursor(hovered ? 'grab' : 'default');
    }
  }

  // 4. Lerp scales toward targets (smooth pop). Skip the active panel object —
  //    GSAP owns its scale (active-state pop, navigation handoff).
  interactables.forEach((o) => {
    if (panelOpen && o === activeObj) return;
    const s = o.userData.targetScale;
    o.scale.lerp(new THREE.Vector3(s, s, s), 0.12);
  });

  // 5. Idle ambient spin — paused on the hovered shape and the active drag target.
  //    The active panel object gets a faster turntable spin instead.
  interactables.forEach((o) => {
    if (o === hovered || o === dragTarget) return;
    if (panelOpen && o === activeObj) return;
    o.rotation.x += o.userData.spin.x;
    o.rotation.y += o.userData.spin.y + 0.005;   // faster baseline ambient spin
    o.rotation.z += o.userData.spin.z;
  });

  // 6. Active panel object — turntable spin around Y (paused while user is dragging it).
  if (panelOpen && activeObj && activeObj !== dragTarget) {
    activeObj.rotation.y += 0.012;
  }

  // 7. Floating labels + wire stubs — repositioned each frame around the active object.
  if (panelOpen) updateLayout();

  composer.render();
  requestAnimationFrame(tick);
}
tick();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  // Layout will recompute on the next render tick automatically.
});
