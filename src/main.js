import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// 1. Scene — background is the CSS gradient on <body>; canvas is transparent
const scene = new THREE.Scene();
scene.background = null;

// 2. Camera
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 2, 6);

// 3. Renderer — sRGB output + ACES tone mapping for correct PBR colors
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// 3b. Environment — RoomEnvironment fallback; HDRI overrides when loaded
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

new RGBELoader().load('/hdri/environment.hdr', (texture) => {
  const envMap = pmrem.fromEquirectangular(texture).texture;
  scene.environment = envMap;
  texture.dispose();
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.5, 0);

let model = null;
let mixer = null;
const clock = new THREE.Clock();

// 5e. Load a real 3D model from /public/models/model.glb
const loader = new GLTFLoader();
loader.load(
  '/models/model.glb',
  (gltf) => {
    model = gltf.scene;
    model.position.set(0, -1.2, 0);
    model.scale.set(1, 1, 1);
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(model);
    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(model);
      gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
      console.log(`Model loaded with ${gltf.animations.length} animation(s):`, gltf.animations.map(a => a.name));
    } else {
      console.log('Model loaded (no animations):', model);
    }
  },
  (progress) => {
    if (progress.total > 0) {
      console.log(`Loading model: ${(progress.loaded / progress.total * 100).toFixed(0)}%`);
    }
  },
  (error) => {
    console.error('Failed to load model:', error);
  }
);


// 7. Lights — environment provides most fill; one key light adds shape and shadow
scene.add(new THREE.AmbientLight(0xffffff, 0.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-3, 4, 2);
sun.castShadow = true;
scene.add(sun);

// 8. Animation loop
function tick() {
  if (mixer) mixer.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

// 9. Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
