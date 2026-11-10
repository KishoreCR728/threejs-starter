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
  const envMap = pmrem.fromEquirectangular(texture).texture;
  scene.environment = envMap;
  scene.background = envMap;
  texture.dispose();
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.5, 0);

// Sphere
const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(1, 64, 64),
  new THREE.MeshStandardMaterial({ color: '#7F77DD', roughness: 0.05, metalness: 1.0 })
);
sphere.position.set(0, 1.5, 0);
sphere.castShadow = true;
scene.add(sphere);

// Cube
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#E24B4A', roughness: 0.5, metalness: 0.1 })
);
cube.position.set(-3, -0.1, 0);
cube.rotation.y = Math.PI / 6;
cube.castShadow = true;
scene.add(cube);

// Torus
const torus = new THREE.Mesh(
  new THREE.TorusGeometry(0.7, 0.18, 16, 64),
  new THREE.MeshStandardMaterial({ color: '#EF9F27', roughness: 0.3, metalness: 0.4 })
);
torus.position.set(3, 0.1, 0.5);
torus.rotation.x = Math.PI / 3;
torus.castShadow = true;
scene.add(torus);

// Moon
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 32, 32),
  new THREE.MeshStandardMaterial({ color: '#1D9E75', roughness: 0.6, metalness: 0 })
);
moon.castShadow = true;
scene.add(moon);


// 5e. Materials showcase — five spheres demonstrating different real materials
const showcaseMaterials = [
  // Chrome — perfect mirror metal
  new THREE.MeshStandardMaterial({
    color: '#ffffff', metalness: 1.0, roughness: 0.0,
  }),
  // Frosted glass — transmissive, rough
  new THREE.MeshPhysicalMaterial({
    color: '#ffffff', metalness: 0.0, roughness: 0.15,
    transmission: 1.0, thickness: 0.5, ior: 1.5,
  }),
  // Brushed gold — metallic with grain
  new THREE.MeshStandardMaterial({
    color: '#d4a857', metalness: 1.0, roughness: 0.4,
  }),
  // Glazed ceramic — non-metal, glossy with clearcoat
  new THREE.MeshPhysicalMaterial({
    color: '#5e7ce2', metalness: 0.0, roughness: 0.5,
    clearcoat: 1.0, clearcoatRoughness: 0.05,
  }),
  // Emissive — glowing surface (independent of lighting)
  new THREE.MeshStandardMaterial({
    color: '#000000',
    emissive: '#ff5e3a', emissiveIntensity: 2.0,
  }),
];

const showcaseGeometry = new THREE.SphereGeometry(0.5, 64, 64);
showcaseMaterials.forEach((mat, i) => {
  const m = new THREE.Mesh(showcaseGeometry, mat);
  m.position.set(-4 + i * 2, -0.5, -3);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
});

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshStandardMaterial({ color: '#1a1a2e' })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.2;
ground.receiveShadow = true;
scene.add(ground);

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
  sphere.rotation.y += 0.005;
  sphere.position.y = 1.5 + Math.sin(Date.now() * 0.001) * 0.15;

  cube.rotation.x += 0.005;
  cube.rotation.y += 0.008;

  torus.rotation.x += 0.04;

  const t = Date.now() * 0.0008;
  const orbitR = 2.5;
  moon.position.x = Math.cos(t) * orbitR;
  moon.position.z = Math.sin(t) * orbitR;
  moon.position.y = 0.5 + Math.sin(t * 2) * 0.2;

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
