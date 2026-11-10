import './scroll.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// ───────── Scene ─────────
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0a14');

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 1, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// Environment
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
new RGBELoader().load('/hdri/environment.hdr', (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(texture).texture;
  scene.background = texture;
});

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-3, 4, 2);
sun.castShadow = true;
scene.add(sun);

// ───────── Six metal shapes spaced wide along X ─────────
const metalMat = new THREE.MeshStandardMaterial({
  color: '#f0f0f4', metalness: 1.0, roughness: 0.05, envMapIntensity: 1.6,
});

// each shape gets a distinct material clone so per-section property tweens
// (e.g. roughness/color) don't bleed between objects
function makeMat() { return metalMat.clone(); }

const shapes = [
  { mesh: new THREE.Mesh(new THREE.SphereGeometry(1.4, 96, 96),         makeMat()), name: 'sphere'    },
  { mesh: new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2),          makeMat()), name: 'cube'      },
  { mesh: new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.4, 32, 128),    makeMat()), name: 'torus'     },
  { mesh: new THREE.Mesh(new THREE.TorusKnotGeometry(0.9, 0.32, 200, 32), makeMat()), name: 'knot'    },
  { mesh: new THREE.Mesh(new THREE.OctahedronGeometry(1.5),             makeMat()), name: 'diamond'   },
  { mesh: new THREE.Mesh(new THREE.IcosahedronGeometry(1.5),            makeMat()), name: 'ico'       },
];

// Shapes arranged along Z (camera flies forward into the scene). Each shape has a small
// X offset to enhance the zigzag — shapes themselves alternate left/right of the centerline.
// Z spacing 22 units — more breathing room between each object.
const scatterPositions = [
  [ 0,    0,    -12],   // sphere (centered)
  [ 1.5,  1,    -34],   // cube (right)
  [-1.5, -0.5, -56],    // torus (left)
  [ 1.5,  0.5, -78],    // knot (right)
  [-1.5,  0,   -100],   // diamond (left)
  [ 1.5,  0.5, -122],   // ico (right)
];
shapes.forEach((s, i) => {
  s.mesh.position.set(...scatterPositions[i]);
  s.mesh.castShadow = true;
  scene.add(s.mesh);
});

// ───────── Camera flies FORWARD (-Z) with X zigzag — passes each shape on alternating sides ─────────
// Camera Z monotonically decreases (flies forward into scene). Camera X zigzags: at each shape's
// section center, camera sits to one side of that shape — right of sphere, left of cube, right of
// torus, left of knot, right of diamond, left of ico. CatmullRom smooths these waypoints into an
// S-curved snake. lookAt always targets the current shape so it stays centered on screen.
const camPoints = [
  new THREE.Vector3( 0,   1,    8),    // 0 — intro: pulled back, looking forward
  new THREE.Vector3( 3,   0.5, -9),    // 1 — sphere (at z=-12): camera RIGHT of sphere
  new THREE.Vector3(-2,   1.5, -31),   // 2 — cube   (at z=-34, x=+1.5): camera LEFT of cube
  new THREE.Vector3( 2,   0,   -53),   // 3 — torus  (at z=-56, x=-1.5): camera RIGHT of torus
  new THREE.Vector3(-2,   1,   -75),   // 4 — knot   (at z=-78, x=+1.5): camera LEFT of knot
  new THREE.Vector3( 2,   0.5, -97),   // 5 — diamond(at z=-100, x=-1.5): camera RIGHT of diamond
  new THREE.Vector3(-2,   1,   -119),  // 6 — ico    (at z=-122, x=+1.5): camera LEFT of ico
  new THREE.Vector3( 0,   2,   -140),  // 7 — outro: pulled back further, slightly above
];

const lookPoints = [
  shapes[0].mesh.position.clone(),  // intro looks at sphere
  shapes[0].mesh.position.clone(),  // sphere
  shapes[1].mesh.position.clone(),  // cube
  shapes[2].mesh.position.clone(),  // torus
  shapes[3].mesh.position.clone(),  // knot
  shapes[4].mesh.position.clone(),  // diamond
  shapes[5].mesh.position.clone(),  // ico
  shapes[5].mesh.position.clone(),  // outro looks back at ico
];
const camCurve  = new THREE.CatmullRomCurve3(camPoints);
const lookCurve = new THREE.CatmullRomCurve3(lookPoints);

// ───────── Lenis smooth scroll → drives ScrollTrigger ─────────
const lenis = new Lenis({ duration: 1.4, smoothWheel: true });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);

// ───────── Scroll position drives camera curve T ─────────
// Each section's *center* corresponds to one waypoint along the curve.
// Between adjacent section centers, scrollT interpolates between waypoints.
// This guarantees that when a section is centered, its shape is centered in view.
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let scrollT = 0;

const sectionsForCam = gsap.utils.toArray('.section');
const lastSegment = camPoints.length - 1;

for (let i = 0; i < sectionsForCam.length - 1; i++) {
  const fromT = i / lastSegment;
  const toT   = (i + 1) / lastSegment;
  ScrollTrigger.create({
    trigger:    sectionsForCam[i],
    start:      'center center',
    endTrigger: sectionsForCam[i + 1],
    end:        'center center',
    scrub: 1,
    onUpdate: (self) => {
      scrollT = fromT + (toT - fromT) * self.progress;
    },
  });
}
// Pin scrollT at boundaries so the camera doesn't drift past the curve
ScrollTrigger.create({
  trigger: sectionsForCam[sectionsForCam.length - 1],
  start: 'center center',
  end: 'bottom bottom',
  onEnter: () => { scrollT = 1; },
  onUpdate: () => { scrollT = 1; },
});

// ───────── Per-section shape animations ─────────
function spin(shape, sectionId, axis = 'y', turns = 4) {
  gsap.to(shape.mesh.rotation, {
    scrollTrigger: { trigger: sectionId, start: 'top bottom', end: 'bottom top', scrub: 1 },
    [axis]: Math.PI * turns,
  });
}
spin(shapes[0], '#section2', 'y', 3);  // sphere
spin(shapes[1], '#section3', 'x', 2);  // cube
gsap.to(shapes[1].mesh.scale, {
  scrollTrigger: { trigger: '#section3', start: 'top center', end: 'bottom center', scrub: 1 },
  x: 1.3, y: 1.3, z: 1.3,
});
spin(shapes[2], '#section4', 'x', 4);  // torus rolling — x-axis tumbles the ring (z-axis was invisible due to torus symmetry)
spin(shapes[3], '#section5', 'y', 3);  // knot
gsap.to(shapes[3].mesh.rotation, {
  scrollTrigger: { trigger: '#section5', start: 'top bottom', end: 'bottom top', scrub: 1 },
  x: Math.PI * 2,
});
spin(shapes[4], '#section6', 'y', 4);  // diamond
gsap.to(shapes[5].mesh.rotation, {       // icosahedron
  scrollTrigger: { trigger: '#section7', start: 'top bottom', end: 'bottom top', scrub: 1 },
  y: Math.PI * 4, x: Math.PI * 2,
});
// frosting effect at the end — icosahedron metal goes from chrome to brushed
gsap.to(shapes[5].mesh.material, {
  scrollTrigger: { trigger: '#section7', start: 'top center', end: 'bottom center', scrub: 1 },
  roughness: 0.45,
});

// ───────── Headline / paragraph fade-in + fade-out per section ─────────
// Individual gsap.fromTo and gsap.to triggers per fade phase. Each tween uses scrub,
// so reverse scroll perfectly rewinds. The last section's fade-in completes at
// "top 50%" — well within the reachable scroll range (no opacity-stuck-mid problem).
const sections = gsap.utils.toArray('.section');
sections.forEach((sec, i) => {
  const h = sec.querySelector('h1');
  const p = sec.querySelector('p');
  if (!h && !p) return;
  const isLast = i === sections.length - 1;

  // Fade in
  if (h) gsap.fromTo(h,
    { y: 50, opacity: 0 },
    {
      y: 0, opacity: 1, ease: 'none',
      scrollTrigger: {
        trigger: sec,
        start: 'top 85%',
        end: 'top 40%',
        scrub: true,
      },
    }
  );
  if (p) gsap.fromTo(p,
    { y: 30, opacity: 0 },
    {
      y: 0, opacity: 1, ease: 'none',
      scrollTrigger: {
        trigger: sec,
        start: 'top 80%',
        end: 'top 35%',
        scrub: true,
      },
    }
  );

  // Fade out — skip for last section so the closing card stays at full opacity.
  // Use fromTo (explicit start state) so reverse-scroll from page end cleanly rewinds the
  // animation. With plain gsap.to the reverse can leave text stuck at opacity 0.
  if (!isLast) {
    if (h) gsap.fromTo(h,
      { y: 0, opacity: 1 },
      {
        y: -50, opacity: 0, ease: 'none',
        scrollTrigger: { trigger: sec, start: 'bottom 65%', end: 'bottom 25%', scrub: true },
      }
    );
    if (p) gsap.fromTo(p,
      { y: 0, opacity: 1 },
      {
        y: -30, opacity: 0, ease: 'none',
        scrollTrigger: { trigger: sec, start: 'bottom 60%', end: 'bottom 20%', scrub: true },
      }
    );
  }
});

// ───────── Render loop ─────────
// Both camera position AND look-at sample from CatmullRom curves — gives a single continuous
// smooth motion. No segment-based locking, no sudden swing as we cross each shape.
// Tiny look-ahead (+0.01 in scrollT) makes the camera lead its target slightly, so transitions
// feel like the camera is "heading toward" the next shape rather than glued to the current one.
function tick() {
  camCurve.getPoint(scrollT, camPos);
  lookCurve.getPoint(Math.min(1, scrollT + 0.01), camLook);

  camera.position.copy(camPos);
  camera.lookAt(camLook);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
