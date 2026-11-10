import './shapes.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0a14');
scene.fog = new THREE.Fog('#0a0a14', 10, 30);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 2, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// HDRI override — loads if /hdri/environment.hdr is present
new RGBELoader().load('/hdri/environment.hdr', (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(texture).texture; // for reflections
  scene.background = texture;                                     // sharp original for the sky
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.5, 0);

// Polished metal — shared material across all three shapes
const metalMat = new THREE.MeshStandardMaterial({
  color: '#f0f0f4',
  metalness: 1.0,
  roughness: 0.02,
  envMapIntensity: 1.6,
});

const showcaseShapes = [
  { geometry: new THREE.SphereGeometry(1.2, 96, 96),  position: [-4.5, 0, 0] },
  { geometry: new THREE.BoxGeometry(2, 2, 2),         position: [0, 0, 0] },
  { geometry: new THREE.IcosahedronGeometry(1.4),     position: [4.5, 0, 0] },
];
showcaseShapes.forEach(({ geometry, position }) => {
  const m = new THREE.Mesh(geometry, metalMat);
  m.position.set(...position);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
});

// Lights — environment provides fill; key light shapes the highlights and shadows
scene.add(new THREE.AmbientLight(0xffffff, 0.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-3, 4, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 20;
sun.shadow.camera.left = -8;
sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8;
sun.shadow.camera.bottom = -8;
sun.shadow.bias = -0.0002;
sun.shadow.radius = 4;
scene.add(sun);

function tick() {
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
