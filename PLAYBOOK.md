# 3D Page Playbook

How to take a Three.js page from "demo scaffold" to "realistic + cinematic + interactive."

This is the playbook used to build [`src/interactive.js`](./src/interactive.js) — read that file alongside this doc; every pattern below is implemented there.

---

## 0. Pick what you need

Not every page wants the full cinematic treatment. Match your goal to the sections below.

| Goal | Sections to apply | Sections to skip |
|---|---|---|
| **Realism only** (PBR shading, real lighting, no UX flourishes) | §1, §2 | §3–§9 |
| **Realism + basic interactivity** (orbit/click, no audio or panels) | §1, §2, §6 *or* §7 | §3, §4, §5, §8, §9 |
| **Realism + atmosphere with sound** (no intro gate) | §1, §2, §3 (skip `boom`/`charge`) | §4, §5, §8, §9 |
| **Full cinematic** (intro gate + boom + scramble panel) | all of §1–§9 | — |

**Realism-only quickstart:** read §2 (the four core ingredients are the renderer, HDRI environment, 3-light rig, and PBR materials — that's it). §10 covers any HUD/typography styling if your page has UI overlays.

---

## 1. Tech baseline

```
three           ^0.168
gsap            ^3.x
vite            ^5+
```

```js
// imports you'll always want
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader }      from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';
import gsap from 'gsap';
```

---

## 2. Realism stack

### Renderer
```js
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace        = THREE.SRGBColorSpace;
renderer.toneMapping             = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure     = 0.95;
renderer.shadowMap.enabled       = true;
renderer.shadowMap.type          = THREE.PCFSoftShadowMap;
```

### HDRI environment (IBL + visible sky)
```js
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;  // fallback while .hdr loads
new RGBELoader().load('/hdri/blue-sky.hdr', (tex) => {
  tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  scene.background  = tex;
  scene.backgroundBlurriness = 0.0;     // 0..0.5
  scene.backgroundIntensity  = 1.0;
});
```
**Common HDRI choices:** `night.hdr` (deep navy, no sun), `blue-sky.hdr` (daylight w/ sun), studio HDRIs from polyhaven.com.

### 3-light rig
Always layered on top of HDRI lighting:
```js
scene.add(new THREE.AmbientLight(0xffffff, 0.18));   // global fill

const key = new THREE.DirectionalLight(0xfff1d6, 1.4);
key.position.set(6, 8, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0005;
scene.add(key);

const fill = new THREE.DirectionalLight(0x88aaff, 0.5);  // cool sky-bounce
fill.position.set(-6, 4, -3);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffaa55, 0.4);   // warm rim
rim.position.set(0, -3, -8);
scene.add(rim);
```

### PBR materials (never `MeshBasicMaterial` for solids)
```js
const mat = new THREE.MeshPhysicalMaterial({
  color:           0xffffff,
  metalness:       0.55,
  roughness:       0.18,
  envMapIntensity: 1.0,
  // domain-specific extras:
  // clearcoat: 1.0, clearcoatRoughness: 0.04,
  // transmission: 0.95, thickness: 0.5, ior: 1.5,
  // sheen: 1.0, sheenColor: 0xffe6c8,
});
```

### Geometry normalisation (so a cube and a capsule read at the same scale)
```js
const TARGET_BSPHERE_R = 0.9;
geo.computeBoundingSphere();
const s = TARGET_BSPHERE_R / geo.boundingSphere.radius;
geo.scale(s, s, s);
```

### Object placement on a sphere with rejection sampling (no overlaps)
```js
const MIN_GAP = 3.6;
const placed = [];
function randomUnitVector() {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(theta), u, s * Math.sin(theta));
}
let pos;
for (let attempt = 0; attempt < 60; attempt++) {
  pos = randomUnitVector().multiplyScalar(7 + Math.random() * 6);   // radius 7..13
  if (placed.every(p => p.distanceTo(pos) >= MIN_GAP)) break;
}
placed.push(pos.clone());
```

---

## 3. Audio engine

File-based engine that handles autoplay policy + buffer-not-yet-loaded queueing.

```js
const SOUND_FILES = {
  ambient: '/sounds/ambient.mp3',  // looping bed
  swim:    '/sounds/swim.mp3',     // looping, gain driven by motion
  boom:    '/sounds/boom.mp3',     // intro impact
  whoosh:  '/sounds/whoosh.mp3',   // camera fly
  swoosh:  '/sounds/swoosh.mp3',   // panel open/close
  tick:    '/sounds/tick.mp3',     // event accent (scramble reveal, etc.)
  charge:  '/sounds/charge.mp3',   // riser into the boom
};
const SOUND_GAIN = {
  ambient: 0.55, swim: 0.7, boom: 1.0, whoosh: 0.85,
  swoosh: 0.75, tick: 0.95, charge: 0.9,
};
```

Key engine behaviour to replicate (full source: [`src/interactive.js:45-178`](./src/interactive.js)):

- `ensureContext()` lazily creates `AudioContext` + master `GainNode` + `DynamicsCompressor` (`threshold:-3, ratio:2, knee:4`)
- `_loadAll()` runs after context creation: fetch + `decodeAudioData` per file, missing files fail silently
- `_play(name, {gain, loop})` defensively `ctx.resume()`s before each play (Chrome auto-suspends after inactivity)
- `setEnabled(on)` ramps master gain 0↔1 over 0.3s; on `true`, awaits load promise then starts ambient + swim loops
- `boom()` queues into `pendingBoom` if ctx not yet running, replays on `setEnabled(true)`
- `charge()` is `async` — awaits `loadPromise` first because it fires on the first gesture before buffers are decoded
- `setSwimIntensity(v)` modulates swim-loop gain via `setTargetAtTime` for smooth ramps
- Persist on/off in `localStorage.getItem('drift-sound-on')`

**Sources for free sounds:** [Mixkit](https://mixkit.co/free-sound-effects/) (CC0, direct mp3), [Free Music Archive](https://freemusicarchive.org/) (per-track CC license).

---

## 4. Click-to-enter gate (autoplay-policy fix)

Every browser blocks `AudioContext.start()` until a user gesture. The standard solution:

**HTML:**
```html
<div id="audio-gate" class="audio-gate">
  <div class="ag-inner">
    <div class="ag-line ag-top">DRIFT // ARCHIVE</div>
    <div class="ag-cta">CLICK TO ENTER</div>
    <div class="ag-line ag-bot">— sound on —</div>
  </div>
</div>
```

**CSS** (full version in `interactive.css`): full-viewport, z-index 100, blurred backdrop, breathing animation, `.is-dismissed` fades it out.

**JS:**
```js
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (soundOn) { audio.ensureContext(); audio.setEnabled(true); }
  triggerExplosion();   // or whatever the page's intro is
  audioGate?.classList.add('is-dismissed');
  UNLOCK_EVENTS.forEach(ev => window.removeEventListener(ev, unlockAudio));
}
UNLOCK_EVENTS.forEach(ev => window.addEventListener(ev, unlockAudio, { passive: true }));
```

**Critical:** the page's intro/explosion/animation must be gated on `unlockAudio()`. Do **not** auto-fire it at module load — the user sees the gate, clicks, *then* the page comes alive. This is the same pattern Spotify, SoundCloud, and game sites use.

---

## 5. Cinematic intro: charge → boom → scatter

Three-phase pattern (full implementation: [`src/interactive.js`](./src/interactive.js) — `triggerExplosion`):

1. **CHARGE (T=0..3s):** play `charge.mp3` riser; render a glowing additive sphere at origin; grow scale + light intensity with `power3.in` easing (slow start, accelerating); spawn shockwave rings on `gsap.delayedCall` at quickening intervals.
2. **DETONATION (T=3s):** `audio.boom()`; flash sphere expands + fades; the singularity dissolves; objects appear at origin scale 0 and tween outward to scattered targets.
3. **SETTLE:** objects ease into final positions with `expo.out` over 2.2..3.1s (per-object randomised) so arrival is ragged, not synchronized.

`INTRO_DELAY = 3.0` is the single tunable controlling pacing.

---

## 6. First-person camera

Yaw/pitch as source of truth → rebuild `camera.quaternion` each frame:

```js
const view = { yaw: 0, pitch: 0, yawTarget: 0, pitchTarget: 0 };
const PITCH_LIMIT = Math.PI / 2 - 0.05;

// in tick():
view.yaw   += (view.yawTarget   - view.yaw)   * 0.12;
view.pitch += (view.pitchTarget - view.pitch) * 0.12;
const q = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 1, 0), view.yaw)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), view.pitch));
camera.quaternion.copy(q);
```

**Drag → look** (see `pointerdown`/`move` handlers): subtract `dx*VIEW_SENSITIVITY` from `yawTarget`, clamp pitch.

**Wheel → swim along view direction** with velocity decay (`SWIM_DAMPING = 0.88`).

**Click → fly to object:** GSAP-tween `camera.position` + `view.yawTarget`/`pitchTarget` simultaneously over 1.6s `power3.inOut`, set `flyingLock` to ignore inputs during transit.

---

## 7. Object trackball drag (rotate object, not camera)

Camera-space axes for "the surface follows the cursor" feel:
```js
const _camAxis = new THREE.Vector3();
const _qDelta  = new THREE.Quaternion();
const OBJECT_SENSITIVITY = 0.005;

// in pointermove, when dragMode === 'object':
_camAxis.setFromMatrixColumn(camera.matrixWorld, 1);  // camera up
_qDelta.setFromAxisAngle(_camAxis, dx * OBJECT_SENSITIVITY);
target.quaternion.premultiply(_qDelta);

_camAxis.setFromMatrixColumn(camera.matrixWorld, 0);  // camera right
_qDelta.setFromAxisAngle(_camAxis, dy * OBJECT_SENSITIVITY);
target.quaternion.premultiply(_qDelta);
```

---

## 8. Detail panel: banner + bent connector wires + scramble text

When user clicks an object, fly camera + open a UI panel that:
- Shows a Solo-Leveling-style angular banner (slanted parallelogram with clip-path) with the object's name
- Floats 4 content labels (CODE, IDX, YEAR, DESC) around the object at fixed screen-space angles
- Draws an SVG polyline from the object's screen position → bent elbow → label, animated with `stroke-dasharray` + `stroke-dashoffset`
- Each label decodes via a scramble effect (random chars locking in left-to-right)
- Bell rings once at `revealContent()` start

**Key files:** look at the `dp-*` CSS classes in `interactive.css` and the `revealContent` / `scrambleText` / `updateLayout` functions.

**Bend math** (the "go straight from content, bend, connect to object" pattern):
```js
// Horizontal-dominant: elbow at (sx - sign(ddx)*ady, ey) → 45° diagonal
// Vertical-dominant:   elbow at (sx, ey + sign(ddy)*adx) → 45° diagonal
// Where (sx,sy) = label endpoint, (ex,ey) = object screen pos, (ddx,ddy) = ex-sx, ey-sy
```

---

## 9. Scramble decoder text

```js
const SCRAMBLE_CHARS = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&_+/';
function scrambleText(el, target, duration = 0.7) {
  if (el._scrambleTimer) clearInterval(el._scrambleTimer);
  const start = performance.now();
  const ms = duration * 1000;
  const len = target.length;
  el._scrambleTimer = setInterval(() => {
    const t = (performance.now() - start) / ms;
    if (t >= 1) { el.textContent = target; clearInterval(el._scrambleTimer); el._scrambleTimer = null; return; }
    let out = '';
    for (let i = 0; i < len; i++) {
      const lock = 0.2 + (i / Math.max(1, len - 1)) * 0.75;
      const ch = target[i];
      if (t >= lock || /[\s.,;:_\-/—–()]/.test(ch)) out += ch;
      else out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
    }
    el.textContent = out;
  }, 33);
}
```
Pair with `audio.tick()` at start of each `revealContent()` (NOT inside `scrambleText`, otherwise you fire 5× per reveal and hit browser audio rate-limits).

Hover-to-rescramble: bind `mouseenter` on each label → `audio.tick(); scrambleText(el, el.textContent, dur)`.

---

## 10. CSS conventions

- `font-family: 'Courier New', ui-monospace, monospace` for HUD/labels; `system-ui, sans-serif` for big banner text
- All-caps + `letter-spacing: 0.18em..0.32em` for the cinematic-HUD vibe
- `backdrop-filter: blur(6px..10px)` on every floating panel
- Slanted parallelogram clip-path for action banners: `clip-path: polygon(24px 0, 100% 0, calc(100% - 24px) 100%, 0 100%)`
- Blueprint grid via 3 stacked `repeating-linear-gradient`s (0°/90°/diagonal)
- Accent colors: green dot (`#88ff8a`) for "live"; otherwise pure white on dark navy `#06080d`

---

## 11. Common pitfalls

| Symptom | Fix |
|---|---|
| Audio doesn't start on reload | Browser autoplay policy. Use the click-to-enter gate; *no* JS workaround exists. |
| Charge sound silent on first click | The buffer hasn't decoded yet. Make `audio.charge()` `async` and `await this.loadPromise` first. |
| Subsequent ticks silent after first | (a) Compressor too aggressive (relax to threshold:-3, ratio:2). (b) Don't fire `audio.tick()` 5× per scrambleText — fire once at `revealContent()`. (c) Defensive `ctx.resume()` before every `_play()`. |
| Bright "sun" reflections on chrome | The HDRI's sun is mirrored in metallic surfaces. Either drop the directional key light, raise material roughness, or use a soft RoomEnvironment for `scene.environment` (separate from the visible `scene.background`). |
| Bloom blooms PBR specular highlights | Threshold too low. Raise `UnrealBloomPass` threshold to ~1.0 so only true emissive whites pass. |
| Object overlap in scattered field | Rejection sampling: try up to 60 random positions, accept first that's `MIN_GAP` away from all placed. |
| Drag rotation feels reversed | You probably built it in object-local axes. Use camera-space (`setFromMatrixColumn(camera.matrixWorld, 0/1)`) for trackball feel. |
| Camera takes the long way around on fly | Wrap target yaw to closest equivalent: `while (yawGoal - view.yawTarget > Math.PI) yawGoal -= Math.PI * 2`. |

---

## 12. Reference file

Single source of truth — read this when in doubt:

```
/home/user/Desktop/3D-website/three-starter/src/interactive.js   (JS, ~1200 LOC)
/home/user/Desktop/3D-website/three-starter/src/interactive.css  (CSS)
/home/user/Desktop/3D-website/three-starter/interactive.html     (markup)
/home/user/Desktop/3D-website/three-starter/public/sounds/*.mp3  (the 7 audio files)
```

When applying this playbook to a new page, copy the audio engine and click-to-enter gate first (they're identical across pages), then choose which subset of the realism + interactivity stack the page needs based on its specific concept.
