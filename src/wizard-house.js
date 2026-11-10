import './wizard-house.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ───────── Scene + atmosphere ─────────
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f0c896'); // warm dusk sky
scene.fog = new THREE.FogExp2('#e8b67d', 0.018);

// ───────── Renderer ─────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
document.body.appendChild(renderer.domElement);

// ───────── Camera + controls ─────────
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(11, 6, 14);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1, 0);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 4;
controls.maxDistance = 45;

// ───────── Environment lighting ─────────
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
new RGBELoader().load('/hdri/environment.hdr', (tex) => {
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  tex.dispose();
});

// ───────── Texture helper ─────────
const textureLoader = new THREE.TextureLoader();
function applyPBR(material, folder, repeat = [1, 1]) {
  const slot = (m) => m === 'map' ? 'color' : m === 'normalMap' ? 'normal' : 'roughness';
  ['map', 'normalMap', 'roughnessMap'].forEach((mapName) => {
    textureLoader.load(
      `/textures/${folder}/${slot(mapName)}.jpg`,
      (tex) => {
        if (mapName === 'map') tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeat[0], repeat[1]);
        material[mapName] = tex;
        material.needsUpdate = true;
      },
      undefined,
      () => {} // silently skip missing files
    );
  });
}

// ───────── Lights — golden hour ─────────
// Sky/ambient: cool blue from above, warm bounce from below
const hemi = new THREE.HemisphereLight('#bde0ff', '#e0b876', 0.45);
scene.add(hemi);

// Sun: warm low-angle key light (sunset)
const sun = new THREE.DirectionalLight('#ffb86b', 2.4);
sun.position.set(-12, 7, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 60;
sun.shadow.camera.left = -25;
sun.shadow.camera.right = 25;
sun.shadow.camera.top = 25;
sun.shadow.camera.bottom = -25;
sun.shadow.bias = -0.0005;
sun.shadow.radius = 4;
scene.add(sun);

// ───────── Ground (warmer green for golden hour) ─────────
const groundGeo = new THREE.PlaneGeometry(100, 100, 200, 200);
{
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, Math.sin(x * 0.18) * 0.08 + Math.cos(y * 0.22) * 0.07 + Math.sin(x * 0.6 + y * 0.4) * 0.03);
  }
  groundGeo.computeVertexNormals();
}
const groundMat = new THREE.MeshStandardMaterial({ color: '#3d6f30', roughness: 0.95 });
applyPBR(groundMat, 'grass', [25, 25]);
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ───────── Instanced grass tufts — covers fenced area densely ─────────
// Each blade is a wide-base, low-tip triangle (more like a tuft of grass than a needle).
const bladeShape = new THREE.BufferGeometry();
{
  const verts = new Float32Array([
    -0.08, 0,     0,
     0.08, 0,     0,
     0.00, 0.16,  0,
  ]);
  bladeShape.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  bladeShape.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([
    0,0,1, 0,0,1, 0,0,1
  ]), 3));
  bladeShape.computeVertexNormals();
}
const bladeMat = new THREE.MeshStandardMaterial({
  color: '#4f8a3e', side: THREE.DoubleSide, roughness: 0.95, metalness: 0,
});
const bladeCount = 25000;
const grass = new THREE.InstancedMesh(bladeShape, bladeMat, bladeCount);
const bladeColor = new THREE.Color();
const bladeMat4 = new THREE.Matrix4();
const bladePos = new THREE.Vector3();
const bladeQuat = new THREE.Quaternion();
const bladeScl = new THREE.Vector3();
const bladeAxis = new THREE.Vector3(0, 1, 0);
let placed = 0;
for (let i = 0; i < bladeCount * 1.3 && placed < bladeCount; i++) {
  // uniform 2D distribution in a square that covers the fenced yard
  const x = (Math.random() - 0.5) * 24;
  const z = (Math.random() - 0.5) * 24;
  // skip blades inside the house footprint
  if (x > -3.5 && x < 3.5 && z > -5.5 && z < -0.5) continue;
  if (x > 1.4 && x < 4 && z > -1.7 && z < 1) continue; // wing
  // skip blades on the path corridor
  const tPath = (8.5 - z) / 9.5;
  if (tPath > 0 && tPath < 1) {
    const px = Math.sin(tPath * Math.PI * 3) * 1.4;
    if (Math.abs(x - px) < 0.85) continue;
  }
  // skip the farm patch
  if (x > -7.2 && x < -3.8 && z > 3.3 && z < 6.7) continue;
  bladePos.set(x, 0, z);
  bladeQuat.setFromAxisAngle(bladeAxis, Math.random() * Math.PI * 2);
  // shorter, varied — base 0.16 * y-scale 0.7..1.6 = 0.11..0.26 final height
  const sx = 0.85 + Math.random() * 0.5;
  const sy = 0.7 + Math.random() * 0.9;
  bladeScl.set(sx, sy, sx);
  bladeMat4.compose(bladePos, bladeQuat, bladeScl);
  grass.setMatrixAt(placed, bladeMat4);
  bladeColor.setHSL(0.27 + Math.random() * 0.06, 0.5, 0.26 + Math.random() * 0.18);
  grass.setColorAt(placed, bladeColor);
  placed++;
}
grass.count = placed;
grass.instanceMatrix.needsUpdate = true;
grass.castShadow = false;
grass.receiveShadow = true;
scene.add(grass);

// ───────── Cottage (more organic, asymmetric, leaning) ─────────
const house = new THREE.Group();
house.position.set(0, 0, -3);

// Main body — slightly asymmetric, rotated a touch
const wallMat = new THREE.MeshStandardMaterial({ color: '#e6d5a8', roughness: 0.9 });
applyPBR(wallMat, 'plaster', [3, 2]);
const mainBody = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3, 3.8), wallMat);
mainBody.position.set(0, 1.5, 0);
mainBody.castShadow = true;
mainBody.receiveShadow = true;
house.add(mainBody);

// Side wing — smaller, attached
const wing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.6), wallMat);
wing.position.set(2.7, 1.2, -0.4);
wing.castShadow = true;
wing.receiveShadow = true;
house.add(wing);

// Stone foundation
const foundationMat = new THREE.MeshStandardMaterial({ color: '#7a6b5a', roughness: 0.95 });
applyPBR(foundationMat, 'stone', [4, 1]);
const foundation = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.55, 4), foundationMat);
foundation.position.y = 0.27;
foundation.castShadow = true;
foundation.receiveShadow = true;
house.add(foundation);
const foundation2 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.45, 2.8), foundationMat);
foundation2.position.set(2.7, 0.22, -0.4);
foundation2.castShadow = true;
foundation2.receiveShadow = true;
house.add(foundation2);

// Curved thatched roof — built from a Lathe so the silhouette is droopy/organic
const thatchMat = new THREE.MeshStandardMaterial({ color: '#7a4d2a', roughness: 1 });
applyPBR(thatchMat, 'thatch', [4, 2]);
{
  const points = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    // droopy curve: wider at base, peaked at top
    const y = t * 2.6;
    const r = 3.4 * Math.pow(1 - t, 0.7) + 0.1;
    points.push(new THREE.Vector2(r, y));
  }
  const lathe = new THREE.LatheGeometry(points, 4);
  const roof = new THREE.Mesh(lathe, thatchMat);
  roof.position.set(0, 3, 0);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  roof.receiveShadow = true;
  house.add(roof);
}
// Wing roof — smaller
{
  const points = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const y = t * 1.4;
    const r = 1.8 * Math.pow(1 - t, 0.7) + 0.05;
    points.push(new THREE.Vector2(r, y));
  }
  const lathe = new THREE.LatheGeometry(points, 4);
  const roof = new THREE.Mesh(lathe, thatchMat);
  roof.position.set(2.7, 2.4, -0.4);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  house.add(roof);
}

// Leaning brick chimney
const chimneyMat = new THREE.MeshStandardMaterial({ color: '#8c4a36', roughness: 0.9 });
applyPBR(chimneyMat, 'brick', [1, 3]);
const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.6, 0.8), chimneyMat);
chimney.position.set(-1.2, 4, -0.5);
chimney.rotation.z = 0.06; // slight lean
chimney.castShadow = true;
house.add(chimney);
// chimney cap
const cap = new THREE.Mesh(
  new THREE.BoxGeometry(0.95, 0.18, 0.95),
  new THREE.MeshStandardMaterial({ color: '#5d3920', roughness: 0.9 })
);
cap.position.set(-1.2, 5.4, -0.5);
cap.rotation.z = 0.06;
house.add(cap);

// Door — arched (cylinder cap + box)
const doorMat = new THREE.MeshStandardMaterial({ color: '#4a2810', roughness: 0.6, metalness: 0.05 });
applyPBR(doorMat, 'wood', [1, 2]);
const doorGroup = new THREE.Group();
const doorBody = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.6, 0.12), doorMat);
doorBody.position.y = 0.8;
doorGroup.add(doorBody);
const doorTop = new THREE.Mesh(
  new THREE.CylinderGeometry(0.55, 0.55, 0.12, 16, 1, false, 0, Math.PI),
  doorMat
);
doorTop.rotation.x = Math.PI / 2;
doorTop.rotation.z = -Math.PI / 2;
doorTop.position.y = 1.6;
doorGroup.add(doorTop);
doorGroup.position.set(0, 0, 1.95);
house.add(doorGroup);
// brass knob
const knob = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 16, 16),
  new THREE.MeshStandardMaterial({ color: '#dcb466', metalness: 0.95, roughness: 0.2 })
);
knob.position.set(0.4, 0.95, 2.02);
house.add(knob);

// Glowing arched windows (emissive — these will bloom)
const windowFrameMat = new THREE.MeshStandardMaterial({ color: '#3d2510', roughness: 0.8 });
const windowGlowMat = new THREE.MeshStandardMaterial({
  color: '#000000', emissive: '#ffc266', emissiveIntensity: 4.0,
});
function makeArchWindow(x, y, z, rotY = 0, w = 0.7, h = 0.8) {
  const g = new THREE.Group();
  const frameBody = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h + 0.05, 0.06), windowFrameMat);
  g.add(frameBody);
  const arch = new THREE.Mesh(
    new THREE.CylinderGeometry((w + 0.1) / 2, (w + 0.1) / 2, 0.06, 16, 1, false, 0, Math.PI),
    windowFrameMat
  );
  arch.rotation.x = Math.PI / 2; arch.rotation.z = -Math.PI / 2;
  arch.position.y = h / 2 + 0.025;
  g.add(arch);
  // glowing pane
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w - 0.05, h - 0.05, 0.08), windowGlowMat);
  glass.position.z = 0.03;
  g.add(glass);
  const glassArch = new THREE.Mesh(
    new THREE.CylinderGeometry((w - 0.05) / 2, (w - 0.05) / 2, 0.08, 16, 1, false, 0, Math.PI),
    windowGlowMat
  );
  glassArch.rotation.x = Math.PI / 2; glassArch.rotation.z = -Math.PI / 2;
  glassArch.position.set(0, h / 2 - 0.02, 0.03);
  g.add(glassArch);
  // mullion cross
  const mV = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, 0.1), windowFrameMat);
  mV.position.z = 0.05; g.add(mV);
  const mH = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.1), windowFrameMat);
  mH.position.z = 0.05; g.add(mH);
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  return g;
}
house.add(makeArchWindow(-1.5, 1.6, 1.95));
house.add(makeArchWindow(1.4, 1.6, 1.95));
house.add(makeArchWindow(2.55, 1.4, 0.4, Math.PI / 2, 0.55, 0.65));
house.add(makeArchWindow(2.55, 1.4, -1.0, Math.PI / 2, 0.55, 0.65));
house.add(makeArchWindow(-2.4, 1.6, 0, Math.PI / 2));
house.add(makeArchWindow(-2.4, 1.6, -1.4, Math.PI / 2));
house.add(makeArchWindow(4, 1.3, 0.85, 0, 0.55, 0.65));

// Window interior point light — warm glow spilling onto the lawn
const windowLight = new THREE.PointLight('#ffb060', 1.5, 7, 2);
windowLight.position.set(0, 1.6, 2.4);
house.add(windowLight);

// Climbing vines — fewer, more organic placement
const vineMat = new THREE.MeshStandardMaterial({ color: '#2d5a25', roughness: 0.95 });
for (let i = 0; i < 70; i++) {
  const side = Math.random() > 0.5 ? 1 : -1;
  const v = new THREE.Mesh(
    new THREE.SphereGeometry(0.16 + Math.random() * 0.12, 8, 8),
    vineMat
  );
  v.position.set(
    side * 2.3 + (Math.random() - 0.5) * 0.4,
    0.4 + Math.random() * 2.6,
    -1.8 + Math.random() * 3.6
  );
  v.castShadow = true;
  house.add(v);
}
scene.add(house);

// ───────── Zigzag stone path with worn flat stones ─────────
const pathGroup = new THREE.Group();
const pathMat = new THREE.MeshStandardMaterial({ color: '#8a7d6c', roughness: 0.95 });
applyPBR(pathMat, 'stone', [1, 1]);
const numStones = 16;
for (let i = 0; i < numStones; i++) {
  const t = i / (numStones - 1);
  const z = 8.5 - t * 9.5;
  const x = Math.sin(t * Math.PI * 3) * 1.4;
  const radius = 0.42 + Math.random() * 0.32;
  const sides = [5, 6, 7, 8][i % 4];
  const stone = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.92, 0.14, sides),
    pathMat
  );
  stone.position.set(x, 0.07, z);
  stone.rotation.y = Math.random() * Math.PI * 2;
  stone.scale.set(1 + (Math.random() - 0.5) * 0.25, 1, 1 + (Math.random() - 0.5) * 0.25);
  stone.castShadow = true;
  stone.receiveShadow = true;
  pathGroup.add(stone);
}
scene.add(pathGroup);

// ───────── Hanging lanterns on path posts ─────────
const lanternPositions = [
  [Math.sin(0.15 * Math.PI * 3) * 1.4 + 1.2, 8.5 - 0.15 * 9.5],
  [Math.sin(0.85 * Math.PI * 3) * 1.4 - 1.2, 8.5 - 0.85 * 9.5],
];
const lanterns = [];
lanternPositions.forEach(([px, pz]) => {
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 1.6, 6),
    new THREE.MeshStandardMaterial({ color: '#3d2510', roughness: 0.9 })
  );
  post.position.set(px, 0.8, pz);
  post.castShadow = true;
  scene.add(post);
  // arm
  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6),
    new THREE.MeshStandardMaterial({ color: '#3d2510', roughness: 0.9 })
  );
  arm.rotation.z = Math.PI / 2;
  arm.position.set(px - 0.2, 1.55, pz);
  scene.add(arm);
  // lantern body — glass cube with emissive interior
  const lantern = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.28, 0.22),
    new THREE.MeshStandardMaterial({
      color: '#221100', emissive: '#ffaa44', emissiveIntensity: 5.0,
    })
  );
  lantern.position.set(px - 0.4, 1.45, pz);
  scene.add(lantern);
  // attached point light for actual illumination
  const lp = new THREE.PointLight('#ffaa55', 1.2, 4.5, 2);
  lp.position.copy(lantern.position);
  scene.add(lp);
  lanterns.push({ light: lp, base: 1.2 });
});

// ───────── Fence — irregular weathered pickets ─────────
const fenceGroup = new THREE.Group();
const fenceMat = new THREE.MeshStandardMaterial({ color: '#a89476', roughness: 0.95 });
const fenceDarkMat = new THREE.MeshStandardMaterial({ color: '#6b513a', roughness: 0.95 });
function addFenceSegment(x1, z1, x2, z2) {
  const length = Math.hypot(x2 - x1, z2 - z1);
  const angle = Math.atan2(z2 - z1, x2 - x1);
  const numPickets = Math.floor(length / 0.42);
  for (let i = 0; i <= numPickets; i++) {
    const t = i / numPickets;
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    const lean = (Math.random() - 0.5) * 0.08;
    const heightVar = 1.0 + Math.random() * 0.18;
    const picket = new THREE.Mesh(new THREE.BoxGeometry(0.09, heightVar, 0.09), fenceMat);
    picket.position.set(x, heightVar / 2, z);
    picket.rotation.z = lean;
    picket.castShadow = true;
    fenceGroup.add(picket);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 4), fenceMat);
    tip.position.set(x, heightVar + 0.08, z);
    tip.rotation.y = Math.PI / 4;
    tip.rotation.z = lean;
    fenceGroup.add(tip);
  }
  for (const yh of [0.32, 0.85]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.06, 0.06), fenceDarkMat);
    rail.position.set((x1 + x2) / 2, yh, (z1 + z2) / 2);
    rail.rotation.y = -angle;
    rail.castShadow = true;
    fenceGroup.add(rail);
  }
}
addFenceSegment(-11, 9, -1.5, 9);
addFenceSegment(1.5, 9, 11, 9);
addFenceSegment(11, 9, 11, -9);
addFenceSegment(11, -9, -11, -9);
addFenceSegment(-11, -9, -11, 9);
scene.add(fenceGroup);

// ───────── Trees — proper trunks + branches + fluffy foliage ─────────
function makeTree(x, z, scale = 1) {
  const tree = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#3a2410', roughness: 0.95 });
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24 * scale, 0.42 * scale, 2.6 * scale, 12),
    trunkMat
  );
  trunk.position.y = 1.3 * scale;
  trunk.castShadow = true;
  tree.add(trunk);
  // a couple of branches
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const branch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06 * scale, 0.12 * scale, 0.9 * scale, 6),
      trunkMat
    );
    branch.position.set(
      Math.cos(angle) * 0.3 * scale,
      (1.8 + Math.random() * 0.4) * scale,
      Math.sin(angle) * 0.3 * scale
    );
    branch.rotation.z = (Math.random() - 0.5) + Math.cos(angle) * 0.6;
    branch.rotation.x = (Math.random() - 0.5) + Math.sin(angle) * 0.6;
    branch.castShadow = true;
    tree.add(branch);
  }
  // foliage — denser cluster, two greens for depth
  const leafA = new THREE.MeshStandardMaterial({ color: '#3a6b35', roughness: 0.85 });
  const leafB = new THREE.MeshStandardMaterial({ color: '#2c5028', roughness: 0.88 });
  const leafC = new THREE.MeshStandardMaterial({ color: '#4f8a3e', roughness: 0.85 });
  const leafMats = [leafA, leafB, leafC];
  for (let i = 0; i < 14; i++) {
    const r = (0.7 + Math.random() * 0.55) * scale;
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), leafMats[i % 3]);
    s.position.set(
      (Math.random() - 0.5) * 1.8 * scale,
      (2.4 + Math.random() * 1.6) * scale,
      (Math.random() - 0.5) * 1.8 * scale
    );
    s.castShadow = true;
    tree.add(s);
  }
  tree.position.set(x, 0, z);
  return tree;
}
scene.add(makeTree(-7.5, 1.5, 1.5));
scene.add(makeTree(8.5, -3, 1.1));
scene.add(makeTree(-8, -5, 0.95));
scene.add(makeTree(-3, -7.5, 0.85));
scene.add(makeTree(8, 5, 0.9));

// ───────── Glowing fairy mushrooms (clusters under trees) ─────────
function addMushroomCluster(cx, cz, count = 5) {
  for (let i = 0; i < count; i++) {
    const x = cx + (Math.random() - 0.5) * 1.6;
    const z = cz + (Math.random() - 0.5) * 1.6;
    const stemH = 0.18 + Math.random() * 0.18;
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, stemH, 8),
      new THREE.MeshStandardMaterial({
        color: '#f0e4c8', roughness: 0.7,
        emissive: '#aa66ff', emissiveIntensity: 0.6,
      })
    );
    stem.position.set(x, stemH / 2, z);
    stem.castShadow = true;
    scene.add(stem);
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.13 + Math.random() * 0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#c43a3a', roughness: 0.7 })
    );
    cap.position.set(x, stemH, z);
    cap.castShadow = true;
    scene.add(cap);
    // white spots
    for (let j = 0; j < 3; j++) {
      const spot = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 8, 8),
        new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 })
      );
      const sa = Math.random() * Math.PI * 2;
      const sr = 0.07;
      spot.position.set(x + Math.cos(sa) * sr, stemH + 0.08, z + Math.sin(sa) * sr);
      scene.add(spot);
    }
  }
  // single soft purple glow per cluster
  const glow = new THREE.PointLight('#9966ff', 0.6, 2.5, 2);
  glow.position.set(cx, 0.25, cz);
  scene.add(glow);
}
addMushroomCluster(-7.5, 1.5);
addMushroomCluster(-8, -5);
addMushroomCluster(8, 5);
addMushroomCluster(-3, -7.5, 7);

// ───────── Pet house ─────────
const petHouse = new THREE.Group();
const petBaseMat = new THREE.MeshStandardMaterial({ color: '#6b4530', roughness: 0.9 });
applyPBR(petBaseMat, 'wood', [1, 1]);
const petBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.85, 0.85), petBaseMat);
petBase.position.y = 0.42;
petBase.castShadow = true;
petBase.receiveShadow = true;
petHouse.add(petBase);
const petRoof = new THREE.Mesh(
  new THREE.ConeGeometry(0.85, 0.55, 4),
  new THREE.MeshStandardMaterial({ color: '#4a2810', roughness: 0.9 })
);
petRoof.position.y = 1.12;
petRoof.rotation.y = Math.PI / 4;
petRoof.scale.set(1, 1, 1.2);
petRoof.castShadow = true;
petHouse.add(petRoof);
const petDoor = new THREE.Mesh(
  new THREE.CircleGeometry(0.27, 16),
  new THREE.MeshStandardMaterial({ color: '#1a0f08', roughness: 1, side: THREE.DoubleSide })
);
petDoor.position.set(0, 0.4, 0.43);
petHouse.add(petDoor);
petHouse.position.set(4.5, 0, 4.5);
petHouse.rotation.y = -Math.PI / 6;
scene.add(petHouse);

// ───────── Vegetable farm ─────────
const farm = new THREE.Group();
const dirtMat = new THREE.MeshStandardMaterial({ color: '#4a3220', roughness: 1 });
applyPBR(dirtMat, 'dirt', [2, 2]);
const dirt = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), dirtMat);
dirt.rotation.x = -Math.PI / 2;
dirt.position.y = 0.02;
dirt.receiveShadow = true;
farm.add(dirt);
const cropMatA = new THREE.MeshStandardMaterial({ color: '#4a8a3c', roughness: 0.85 });
const cropMatB = new THREE.MeshStandardMaterial({ color: '#6aaf48', roughness: 0.85 });
for (let row = 0; row < 5; row++) {
  for (let col = 0; col < 7; col++) {
    const plant = new THREE.Mesh(
      new THREE.SphereGeometry(0.13 + Math.random() * 0.05, 8, 8),
      Math.random() > 0.5 ? cropMatA : cropMatB
    );
    plant.position.set(
      -1.4 + col * 0.45 + (Math.random() - 0.5) * 0.08,
      0.13,
      -1.3 + row * 0.65 + (Math.random() - 0.5) * 0.08
    );
    plant.scale.y = 1.4 + Math.random() * 0.6;
    plant.castShadow = true;
    farm.add(plant);
  }
}
farm.position.set(-5.5, 0, 5);
scene.add(farm);

// ───────── Wildflower clusters ─────────
const flowerColors = ['#e74c3c', '#f1c40f', '#d63384', '#ecf0f1', '#e67e22', '#ad57e6', '#5dade2'];
const flowerStemMat = new THREE.MeshStandardMaterial({ color: '#3a6b35', roughness: 0.9 });
function addFlowerCluster(cx, cz, count = 18, radius = 1.5) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * radius;
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.4, 5), flowerStemMat);
    stem.position.set(x, 0.2, z);
    scene.add(stem);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 10, 10),
      new THREE.MeshStandardMaterial({
        color: flowerColors[Math.floor(Math.random() * flowerColors.length)],
        roughness: 0.55,
      })
    );
    head.position.set(x, 0.43, z);
    head.castShadow = true;
    scene.add(head);
  }
}
addFlowerCluster(-2.8, 4.5, 32, 2.0);
addFlowerCluster(3.2, -1.5, 26, 1.7);
addFlowerCluster(-3.5, -2, 22, 1.5);
addFlowerCluster(2.8, 6, 28, 1.9);
addFlowerCluster(-2, 7.5, 18, 1.1);
addFlowerCluster(2.5, 7.5, 18, 1.1);
addFlowerCluster(6.5, 1, 22, 1.4);
addFlowerCluster(-7, 5, 22, 1.4);
addFlowerCluster(7, 7.5, 18, 1.2);
addFlowerCluster(-8.5, 7, 18, 1.2);

// ───────── Fireflies — animated glowing point sprites ─────────
const fireflyCount = 40;
const fireflies = [];
const fireflyGeo = new THREE.SphereGeometry(0.05, 6, 6);
const fireflyMat = new THREE.MeshBasicMaterial({ color: '#fff7c0' });
for (let i = 0; i < fireflyCount; i++) {
  const f = new THREE.Mesh(fireflyGeo, fireflyMat);
  const angle = Math.random() * Math.PI * 2;
  const radius = 4 + Math.random() * 8;
  f.userData = {
    cx: Math.cos(angle) * radius,
    cz: Math.sin(angle) * radius,
    cy: 0.5 + Math.random() * 1.5,
    phase: Math.random() * Math.PI * 2,
    speed: 0.4 + Math.random() * 0.6,
    radius: 0.4 + Math.random() * 1.2,
  };
  f.position.set(f.userData.cx, f.userData.cy, f.userData.cz);
  scene.add(f);
  fireflies.push(f);
}
// a few of them carry actual point lights (expensive, so only a few)
const fireflyLights = [];
for (let i = 0; i < 6; i++) {
  const fl = new THREE.PointLight('#fff7a0', 0.4, 2, 2);
  scene.add(fl);
  fireflyLights.push(fl);
}

// ───────── Chimney smoke ─────────
const smokeMat = new THREE.MeshBasicMaterial({
  color: '#cccccc', transparent: true, opacity: 0.4, depthWrite: false,
});
const smokePuffs = [];
for (let i = 0; i < 8; i++) {
  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 12), smokeMat.clone());
  puff.position.set(-1.2, 4.5 + i * 0.4, -3.5);
  puff.userData.t = i * 0.4;
  scene.add(puff);
  smokePuffs.push(puff);
}

// ───────── Magical floating dust ─────────
const dustGeo = new THREE.BufferGeometry();
const dustCount = 200;
const dustPos = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  dustPos[i * 3]     = (Math.random() - 0.5) * 25;
  dustPos[i * 3 + 1] = 0.5 + Math.random() * 6;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 25;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({
  color: '#ffe6a0', size: 0.06, transparent: true, opacity: 0.6,
  depthWrite: false, blending: THREE.AdditiveBlending,
});
const dust = new THREE.Points(dustGeo, dustMat);
scene.add(dust);

// ───────── Optional: real cottage GLB drop-in ─────────
// If /public/models/cottage.glb exists, it loads in addition to the primitive cottage.
// Position it to taste — comment out the primitive `house` block above if you want to replace it.
new GLTFLoader().load(
  '/models/cottage.glb',
  (gltf) => {
    const m = gltf.scene;
    m.position.set(20, 0, 20); // tucked off-screen by default
    m.traverse((c) => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });
    scene.add(m);
    console.log('Optional cottage.glb loaded — re-position in src/wizard-house.js');
  },
  undefined,
  () => {} // silently skip when absent
);

// ───────── Post-processing: bloom for windows + lanterns + mushrooms + fireflies ─────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.45, // strength
  0.35, // radius
  2.4   // threshold — only HDR-bright (>1.0) pixels bloom
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ───────── Resize ─────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ───────── Loop ─────────
const clock = new THREE.Clock();
let elapsed = 0;
function tick() {
  const dt = clock.getDelta();
  elapsed += dt;

  // Smoke
  smokePuffs.forEach((p) => {
    p.userData.t += dt * 0.3;
    p.position.y += dt * 0.4;
    p.material.opacity = Math.max(0, 0.4 - p.userData.t * 0.16);
    p.scale.setScalar(1 + p.userData.t * 0.6);
    if (p.userData.t > 2.5) {
      p.userData.t = 0;
      p.position.y = 4.5;
      p.scale.setScalar(1);
      p.material.opacity = 0.4;
    }
  });

  // Fireflies — circle and bob
  fireflies.forEach((f, i) => {
    const u = f.userData;
    const t = elapsed * u.speed + u.phase;
    f.position.x = u.cx + Math.cos(t) * u.radius;
    f.position.z = u.cz + Math.sin(t * 1.3) * u.radius;
    f.position.y = u.cy + Math.sin(t * 2.1) * 0.3;
  });
  fireflyLights.forEach((fl, i) => {
    const f = fireflies[i * 6];
    if (f) fl.position.copy(f.position);
  });

  // Lantern flicker
  lanterns.forEach((l) => {
    l.light.intensity = l.base + Math.sin(elapsed * 9 + l.light.position.x) * 0.15
                                + (Math.random() - 0.5) * 0.08;
  });

  // Dust drift
  const dpos = dust.geometry.attributes.position;
  for (let i = 0; i < dustCount; i++) {
    let y = dpos.getY(i) + dt * 0.05;
    if (y > 6.5) y = 0.5;
    dpos.setY(i, y);
    const x = dpos.getX(i) + Math.sin(elapsed * 0.3 + i) * dt * 0.05;
    dpos.setX(i, x);
  }
  dpos.needsUpdate = true;

  controls.update();
  composer.render();
  requestAnimationFrame(tick);
}
tick();
