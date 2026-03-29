import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/plugins';

// ═══ GOOGLE API KEY ═══
const GOOGLE_API_KEY = 'AIzaSyA8hlBZf4nsKQ92rjyqxUUrxQ9Awh74_bQ';

// ═══ STATE ═══
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
let scene, camera, renderer, clock;
let tilesRenderer;
let player;
let velY = 0, onGround = true;
let mF = 0, mB = 0, mL = 0, mR = 0, sprinting = false;
let yaw = 0, pitch = 0.4;
let cLat, cLon, locName = '';
let joyVec = { x: 0, y: 0 }, lookTID = null;
let arrowLook = { left: 0, right: 0, up: 0, down: 0 }; // Arrow key look state
let fireKeyHeld = false; // For shooting with / key
let vehicles = [], activeVehicle = null;
let carAccelInput = 0, carBrakeInput = 0;
let autoSprint = false; // Mobile auto-sprint toggle

// Jetpack
let jetpackActive = false;
const JETPACK_MAX_FUEL = 15;
let jetpackFuel = JETPACK_MAX_FUEL;
let jetpackMesh = null;

// Wingsuit
let wingsuitActive = false;
let wingsuitMesh = null;
const WINGSUIT_GLIDE_RATIO = 3; // Forward distance per unit of fall
const WINGSUIT_MIN_FALL = -4; // Minimum fall speed when gliding

// Night mode
let nightMode = false;

// Paintball
let paintMode = false;
let paintColor = '#ff3366';
let paintBalls = [];
let paintSplats = [];
const PAINT_SPEED = 50;
const PAINT_GRAVITY = -15;
const MAX_SPLATS = 300;

// Zombies
let zombies = [];
const ZOMBIE_COUNT = 15;
const ZOMBIE_SPEED = 2.5;
const ZOMBIE_WANDER_RANGE = 80;

// Mini map
let spawnPoint = { x: 0, z: 0 };
let mapMarkers = [];
let minimapCtx = null;
let minimapImage = null;
const MINIMAP_SCALE = 2; // meters per pixel (smaller = more zoomed in)

// World origin for local coordinate system
let worldOriginECEF = null;
let localEast = null, localNorth = null, localUp = null;

// Constants
const P_SPD = 8, SPRINT = 2.2, JUMP = 12, GRAV = -30, MSENS = 0.003;
const ARROW_LOOK_SPEED = 2.5; // Radians per second for arrow key looking
const CAM_DIST = 6, CAM_HEIGHT = 2.5;
const CAR_ACCEL = 15, CAR_BRAKE = 20, CAR_MAX = 28, CAR_STEER = 2, CAR_FRICTION = 5;

// WGS84 ellipsoid
const WGS84_A = 6378137.0;
const WGS84_E2 = 0.00669437999014;

// ═══ COORDINATE CONVERSION ═══
function latLonAltToECEF(lat, lon, alt = 0) {
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);

  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);

  return new THREE.Vector3(
    (N + alt) * cosLat * cosLon,
    (N + alt) * cosLat * sinLon,
    (N * (1 - WGS84_E2) + alt) * sinLat
  );
}

function setupLocalFrame(lat, lon) {
  const pos = latLonAltToECEF(lat, lon, 0);
  worldOriginECEF = pos.clone();

  // Local up = normalized ECEF position (points away from Earth center)
  localUp = pos.clone().normalize();

  // Local east = cross(north pole, up)
  const northPole = new THREE.Vector3(0, 0, 1);
  localEast = new THREE.Vector3().crossVectors(northPole, localUp).normalize();

  // Local north = cross(up, east)
  localNorth = new THREE.Vector3().crossVectors(localUp, localEast).normalize();
}

function localToECEF(local) {
  const ecef = worldOriginECEF.clone();
  ecef.addScaledVector(localEast, local.x);
  ecef.addScaledVector(localUp, local.y);
  ecef.addScaledVector(localNorth, local.z);
  return ecef;
}

function ecefToLocal(ecef) {
  const diff = ecef.clone().sub(worldOriginECEF);
  return new THREE.Vector3(
    diff.dot(localEast),
    diff.dot(localUp),
    diff.dot(localNorth)
  );
}

// ═══ UI HELPERS ═══
function setS(msg, err = false) {
  const el = document.getElementById('st');
  el.textContent = msg;
  el.className = err ? 'err' : '';
}

function setP(pct) {
  document.getElementById('pw').style.display = pct > 0 && pct < 100 ? 'block' : 'none';
  document.getElementById('pb').style.width = pct + '%';
  document.getElementById('loading-spinner').style.display = pct > 0 && pct < 100 ? 'block' : 'none';
}

// ═══ GEOCODING ═══
async function geocode(query) {
  // Use Google Geocoding API (same key as tiles)
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.status !== 'OK' || !data.results.length) throw new Error('Location not found');
  const result = data.results[0];
  return {
    lat: result.geometry.location.lat,
    lon: result.geometry.location.lng,
    name: result.address_components[0]?.short_name || query
  };
}

// ═══ INIT THREE.JS ═══
function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 1, 1e7);

  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('gc'),
    antialias: !isMobile,
    logarithmicDepthBuffer: true
  });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(1, 1, 0.5).normalize().multiplyScalar(1e6);
  scene.add(sun);

  clock = new THREE.Clock();

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

// ═══ SETUP GOOGLE 3D TILES ═══
async function setupTiles() {
  setS('Loading Google 3D Tiles...');
  setP(30);

  // Setup local coordinate frame centered at target location
  setupLocalFrame(cLat, cLon);

  // DRACO decoder for compressed meshes
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

  // GLTF loader with DRACO support
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  // Create tiles renderer
  tilesRenderer = new TilesRenderer();

  // Register Google authentication plugin
  tilesRenderer.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: GOOGLE_API_KEY }));

  // Configure loader
  tilesRenderer.manager.addHandler(/\.gltf$/i, gltfLoader);
  tilesRenderer.manager.addHandler(/\.glb$/i, gltfLoader);

  // Set initial camera and resolution
  tilesRenderer.setCamera(camera);
  tilesRenderer.setResolutionFromRenderer(camera, renderer);

  // Handle attribution
  tilesRenderer.onLoadTileSet = (tileset) => {
    console.log('Tileset loaded:', tileset);
    if (tileset.asset?.copyright) {
      document.getElementById('attribution').textContent = tileset.asset.copyright;
    }
  };

  // Add tiles to scene with rotation to convert ECEF to local ENU
  // Create rotation matrix: ECEF -> ENU where Y is up
  const tilesGroup = tilesRenderer.group;

  // Rotation matrix: columns are where ECEF X, Y, Z go in our local frame
  // We want: localEast=X, localUp=Y, localNorth (negated)=Z (for right-hand system)
  const rotMatrix = new THREE.Matrix4();
  rotMatrix.makeBasis(localEast, localUp, localNorth.clone().negate());

  // Invert to get ECEF->local transform
  rotMatrix.invert();

  // Apply rotation to tiles group
  tilesGroup.setRotationFromMatrix(rotMatrix);

  // Translate so world origin is at our location
  tilesGroup.position.copy(worldOriginECEF.clone().applyMatrix4(rotMatrix).negate());

  scene.add(tilesGroup);

  setP(50);

  // Position camera above target location (now in local ENU coords)
  camera.position.set(0, 200, 0);

  // Look at ground
  camera.lookAt(0, 0, 0);

  // Wait for initial tiles to load
  setS('Downloading world data...');

  return new Promise((resolve) => {
    let loadAttempts = 0;
    const maxAttempts = 300; // ~10 seconds at 30fps

    const checkLoaded = () => {
      tilesRenderer.update();
      loadAttempts++;

      const stats = tilesRenderer.stats || {};
      const loading = stats.downloading || 0;
      const parsing = stats.parsing || 0;

      if (loadAttempts % 30 === 0) {
        console.log(`Loading tiles... downloading: ${loading}, parsing: ${parsing}`);
      }

      if ((loading === 0 && parsing === 0 && loadAttempts > 30) || loadAttempts >= maxAttempts) {
        setP(80);
        resolve();
      } else {
        requestAnimationFrame(checkLoaded);
      }
    };
    checkLoaded();
  });
}

// ═══ CREATE PLAYER ═══
function createPlayer() {
  const group = new THREE.Group();

  // More realistic human-scale character (~1.7m tall)
  // Using muted colors that blend with photorealistic environment

  // Leg pivots (for animation)
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.1, 0.52, 0);
  group.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.1, 0.52, 0);
  group.add(rightLegPivot);

  // Legs
  const legGeo = new THREE.CapsuleGeometry(0.08, 0.4, 4, 8);
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2a3a4a, roughness: 0.8 });
  const leftLeg = new THREE.Mesh(legGeo, pantsMat);
  leftLeg.position.y = -0.2;
  leftLegPivot.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo, pantsMat);
  rightLeg.position.y = -0.2;
  rightLegPivot.add(rightLeg);

  // Torso
  const torsoGeo = new THREE.CapsuleGeometry(0.15, 0.35, 4, 8);
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0x3d5a6e, roughness: 0.7 });
  const torso = new THREE.Mesh(torsoGeo, shirtMat);
  torso.position.y = 0.85;
  group.add(torso);

  // Arm pivots (for animation)
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.22, 1.0, 0);
  group.add(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.22, 1.0, 0);
  group.add(rightArmPivot);

  // Arms
  const armGeo = new THREE.CapsuleGeometry(0.05, 0.3, 4, 8);
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc4a484, roughness: 0.6 });
  const leftArm = new THREE.Mesh(armGeo, skinMat);
  leftArm.position.y = -0.15;
  leftArm.rotation.z = 0.15;
  leftArmPivot.add(leftArm);
  const rightArm = new THREE.Mesh(armGeo, skinMat);
  rightArm.position.y = -0.15;
  rightArm.rotation.z = -0.15;
  rightArmPivot.add(rightArm);

  // Head
  const headGeo = new THREE.SphereGeometry(0.12, 12, 12);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.y = 1.22;
  group.add(head);

  // Hair
  const hairGeo = new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.9 });
  const hair = new THREE.Mesh(hairGeo, hairMat);
  hair.position.y = 1.24;
  group.add(hair);

  // Shadow blob under feet for grounding
  const shadowGeo = new THREE.CircleGeometry(0.2, 16);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.3,
    depthWrite: false
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  // Store references for animation
  group.userData.shadow = shadow;
  group.userData.leftLegPivot = leftLegPivot;
  group.userData.rightLegPivot = rightLegPivot;
  group.userData.leftArmPivot = leftArmPivot;
  group.userData.rightArmPivot = rightArmPivot;
  group.userData.animTime = 0;

  // Start position in local coords
  group.userData.localPos = new THREE.Vector3(0, 5, 0);
  group.userData.height = 1.4;

  scene.add(group);
  player = group;

  return group;
}

// ═══ CREATE VEHICLE ═══
function createVehicle(localX, localZ) {
  const car = new THREE.Group();

  // More realistic muted car colors
  const colors = [0x2c3e50, 0x7f8c8d, 0x34495e, 0x1a1a2e, 0x4a4a4a, 0x8b0000, 0x1e3d59, 0xf0f0f0];
  const color = colors[Math.floor(Math.random() * colors.length)];

  // Body - realistic car proportions (~4.5m long, 1.8m wide, 1.4m tall)
  const bodyGeo = new THREE.BoxGeometry(1.8, 0.7, 4.2);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.6 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.55;
  car.add(body);

  // Roof/cabin
  const roofGeo = new THREE.BoxGeometry(1.5, 0.5, 2.0);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x87CEEB, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.6 });
  const roof = new THREE.Mesh(roofGeo, glassMat);
  roof.position.set(0, 1.05, -0.2);
  car.add(roof);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.22, 16);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  [[0.85, 0.35, 1.3], [-0.85, 0.35, 1.3], [0.85, 0.35, -1.3], [-0.85, 0.35, -1.3]].forEach(pos => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(...pos);
    car.add(wheel);
  });

  // Shadow under car
  const shadowGeo = new THREE.PlaneGeometry(2, 4.5);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  car.add(shadow);

  car.userData = {
    speed: 0,
    angle: 0,
    localPos: new THREE.Vector3(localX, 1, localZ)
  };

  scene.add(car);
  return car;
}

// ═══ JETPACK MESH ═══
function createJetpackMesh() {
  if (jetpackMesh || !player) return;

  const g = new THREE.Group();

  // Smaller tanks for smaller character
  const tankGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.2, 8);
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.4, metalness: 0.6 });
  const tank1 = new THREE.Mesh(tankGeo, tankMat);
  tank1.position.set(-0.1, 0.85, -0.12);
  g.add(tank1);
  const tank2 = tank1.clone();
  tank2.position.x = 0.1;
  g.add(tank2);

  // Flames
  const flameGeo = new THREE.ConeGeometry(0.03, 0.15, 8);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
  const flame1 = new THREE.Mesh(flameGeo, flameMat);
  flame1.position.set(-0.1, 0.68, -0.12);
  flame1.rotation.x = Math.PI;
  flame1.visible = false;
  g.add(flame1);
  const flame2 = flame1.clone();
  flame2.position.x = 0.1;
  g.add(flame2);

  g.flame1 = flame1;
  g.flame2 = flame2;

  player.add(g);
  jetpackMesh = g;
}

// ═══ WINGSUIT MESH ═══
function createWingsuitMesh() {
  if (wingsuitMesh || !player) return;

  const g = new THREE.Group();

  // Wing material - translucent fabric look
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x2244aa,
    roughness: 0.8,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide
  });

  // Left wing (triangular shape from arm to leg)
  const leftWingGeo = new THREE.BufferGeometry();
  const leftVerts = new Float32Array([
    -0.22, 1.0, 0,    // Shoulder
    -0.12, 0.3, 0,    // Hip
    -0.8, 0.6, 0.1    // Wing tip
  ]);
  leftWingGeo.setAttribute('position', new THREE.BufferAttribute(leftVerts, 3));
  leftWingGeo.computeVertexNormals();
  const leftWing = new THREE.Mesh(leftWingGeo, wingMat);
  g.add(leftWing);

  // Right wing
  const rightWingGeo = new THREE.BufferGeometry();
  const rightVerts = new Float32Array([
    0.22, 1.0, 0,
    0.12, 0.3, 0,
    0.8, 0.6, 0.1
  ]);
  rightWingGeo.setAttribute('position', new THREE.BufferAttribute(rightVerts, 3));
  rightWingGeo.computeVertexNormals();
  const rightWing = new THREE.Mesh(rightWingGeo, wingMat);
  g.add(rightWing);

  // Leg wing (between legs)
  const legWingGeo = new THREE.BufferGeometry();
  const legVerts = new Float32Array([
    -0.12, 0.3, 0,
    0.12, 0.3, 0,
    0, 0.1, 0.15
  ]);
  legWingGeo.setAttribute('position', new THREE.BufferAttribute(legVerts, 3));
  legWingGeo.computeVertexNormals();
  const legWing = new THREE.Mesh(legWingGeo, wingMat);
  g.add(legWing);

  g.visible = false; // Hidden until activated
  player.add(g);
  wingsuitMesh = g;
}

// ═══ NIGHT MODE ═══
function toggleNightMode() {
  nightMode = !nightMode;

  if (nightMode) {
    // Night sky
    scene.background = new THREE.Color(0x0a0a1a);

    // Dim the lights
    scene.traverse(obj => {
      if (obj.isAmbientLight) {
        obj.intensity = 0.15;
        obj.color.setHex(0x4444aa);
      }
      if (obj.isDirectionalLight) {
        obj.intensity = 0.3;
        obj.color.setHex(0x8888ff); // Moonlight blue tint
      }
    });

    setS('Night mode ON');
  } else {
    // Day sky
    scene.background = new THREE.Color(0x87CEEB);

    // Restore lights
    scene.traverse(obj => {
      if (obj.isAmbientLight) {
        obj.intensity = 0.6;
        obj.color.setHex(0xffffff);
      }
      if (obj.isDirectionalLight) {
        obj.intensity = 1.2;
        obj.color.setHex(0xffffff);
      }
    });

    setS('Day mode ON');
  }

  setTimeout(() => setS(''), 2000);
}

// ═══ ZOMBIE SYSTEM ═══
function createZombie(localX, localZ) {
  const group = new THREE.Group();

  // Zombie colors - sickly green/gray
  const zombieSkin = new THREE.MeshStandardMaterial({ color: 0x5a7a5a, roughness: 0.9 });
  const zombieClothes = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.95 });
  const zombieRed = new THREE.MeshStandardMaterial({ color: 0x880000, roughness: 0.8 });

  // Leg pivots (for shambling animation)
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.12, 0.55, 0);
  group.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.12, 0.55, 0);
  group.add(rightLegPivot);

  // Legs
  const legGeo = new THREE.CapsuleGeometry(0.09, 0.42, 4, 8);
  const leftLeg = new THREE.Mesh(legGeo, zombieClothes);
  leftLeg.position.y = -0.22;
  leftLegPivot.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo, zombieClothes);
  rightLeg.position.y = -0.22;
  rightLegPivot.add(rightLeg);

  // Torso (hunched)
  const torsoGeo = new THREE.CapsuleGeometry(0.17, 0.38, 4, 8);
  const torso = new THREE.Mesh(torsoGeo, zombieClothes);
  torso.position.y = 0.88;
  torso.rotation.x = 0.2; // Hunched forward
  group.add(torso);

  // Arm pivots (reaching forward)
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.25, 1.0, 0);
  leftArmPivot.rotation.x = -0.8; // Arms reaching forward
  group.add(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.25, 1.0, 0);
  rightArmPivot.rotation.x = -0.6;
  group.add(rightArmPivot);

  // Arms
  const armGeo = new THREE.CapsuleGeometry(0.055, 0.32, 4, 8);
  const leftArm = new THREE.Mesh(armGeo, zombieSkin);
  leftArm.position.y = -0.18;
  leftArmPivot.add(leftArm);
  const rightArm = new THREE.Mesh(armGeo, zombieSkin);
  rightArm.position.y = -0.18;
  rightArmPivot.add(rightArm);

  // Head
  const headGeo = new THREE.SphereGeometry(0.14, 12, 12);
  const head = new THREE.Mesh(headGeo, zombieSkin);
  head.position.y = 1.2;
  head.position.z = 0.1; // Forward (hunched)
  group.add(head);

  // Glowing red eyes
  const eyeGeo = new THREE.SphereGeometry(0.02, 8, 8);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.045, 1.22, 0.22);
  group.add(leftEye);
  const rightEye = leftEye.clone();
  rightEye.position.x = 0.045;
  group.add(rightEye);

  // Store animation refs
  group.userData.leftLegPivot = leftLegPivot;
  group.userData.rightLegPivot = rightLegPivot;
  group.userData.leftArmPivot = leftArmPivot;
  group.userData.rightArmPivot = rightArmPivot;
  group.userData.animTime = Math.random() * Math.PI * 2;

  // Zombie AI state
  group.userData.localPos = new THREE.Vector3(localX, 2, localZ);
  group.userData.health = 3; // Takes 3 paintball hits to kill
  group.userData.wanderTarget = new THREE.Vector3(localX, 0, localZ);
  group.userData.wanderTimer = 0;
  group.userData.dead = false;
  group.userData.respawnTimer = 0;

  scene.add(group);
  return group;
}

function spawnZombies() {
  for (let i = 0; i < ZOMBIE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * ZOMBIE_WANDER_RANGE;
    const zombie = createZombie(Math.cos(angle) * dist, Math.sin(angle) * dist);
    zombies.push(zombie);
  }
}

function updateZombies(dt) {
  for (const z of zombies) {
    if (z.userData.dead) {
      z.userData.respawnTimer -= dt;
      if (z.userData.respawnTimer <= 0) {
        // Respawn zombie at random location
        const angle = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * ZOMBIE_WANDER_RANGE;
        z.userData.localPos.set(Math.cos(angle) * dist, 2, Math.sin(angle) * dist);
        z.userData.health = 3;
        z.userData.dead = false;
        z.visible = true;
      }
      continue;
    }

    // Wander AI - pick new target periodically
    z.userData.wanderTimer -= dt;
    if (z.userData.wanderTimer <= 0) {
      z.userData.wanderTimer = 3 + Math.random() * 4;
      // Pick random point near current position
      const angle = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * 15;
      z.userData.wanderTarget.set(
        z.userData.localPos.x + Math.cos(angle) * dist,
        0,
        z.userData.localPos.z + Math.sin(angle) * dist
      );
    }

    // Move toward target
    const dx = z.userData.wanderTarget.x - z.userData.localPos.x;
    const dz = z.userData.wanderTarget.z - z.userData.localPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist > 1) {
      const moveX = (dx / dist) * ZOMBIE_SPEED * dt;
      const moveZ = (dz / dist) * ZOMBIE_SPEED * dt;
      z.userData.localPos.x += moveX;
      z.userData.localPos.z += moveZ;

      // Face movement direction
      z.rotation.y = Math.atan2(dx, dz);
    }

    // Ground height
    const groundY = getGroundHeight(z.userData.localPos.x, z.userData.localPos.z);
    z.userData.localPos.y = groundY + 0.1;

    // Update 3D position
    z.position.copy(z.userData.localPos);

    // Shambling animation
    z.userData.animTime += dt * 4;
    const shamble = Math.sin(z.userData.animTime) * 0.4;
    z.userData.leftLegPivot.rotation.x = shamble;
    z.userData.rightLegPivot.rotation.x = -shamble;
    z.userData.leftArmPivot.rotation.x = -0.8 + shamble * 0.2;
    z.userData.rightArmPivot.rotation.x = -0.6 - shamble * 0.2;
  }
}

function checkZombieHits(paintball) {
  for (const z of zombies) {
    if (z.userData.dead) continue;

    const dist = paintball.position.distanceTo(z.position);
    if (dist < 1.2) {
      z.userData.health--;

      // Create hit effect (green splat on zombie)
      createSplat(paintball.position.clone(), new THREE.Vector3(0, 1, 0), paintball.userData.color);

      if (z.userData.health <= 0) {
        // Zombie dies!
        z.userData.dead = true;
        z.userData.respawnTimer = 8 + Math.random() * 5; // Respawn in 8-13 seconds
        z.visible = false;

        // Show kill notification
        showKillNotification();
      }

      return true; // Hit detected
    }
  }
  return false;
}

function showKillNotification() {
  let notif = document.getElementById('kill-notif');
  if (!notif) {
    notif = document.createElement('div');
    notif.id = 'kill-notif';
    notif.style.cssText = 'position:fixed;top:30%;left:50%;transform:translateX(-50%);font-family:Orbitron,sans-serif;font-size:24px;color:#ff0000;text-shadow:0 0 10px #ff0000;z-index:100;opacity:0;transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(notif);
  }
  notif.textContent = 'ZOMBIE KILLED!';
  notif.style.opacity = '1';
  setTimeout(() => { notif.style.opacity = '0'; }, 1500);
}

// ═══ PAINTBALL FUNCTIONS ═══
function togglePaintball() {
  paintMode = !paintMode;
  const crosshair = document.getElementById('crosshair');
  const colorPicker = document.getElementById('color-picker');

  if (paintMode) {
    if (!crosshair) {
      const ch = document.createElement('div');
      ch.id = 'crosshair';
      ch.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:20px;height:20px;border:2px solid white;border-radius:50%;pointer-events:none;z-index:100;mix-blend-mode:difference;';
      document.body.appendChild(ch);
    } else {
      crosshair.style.display = 'block';
    }

    if (!colorPicker) {
      const cp = document.createElement('div');
      cp.id = 'color-picker';
      cp.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:100;';
      const colors = ['#ff3366', '#33ff66', '#3366ff', '#ffff33', '#ff6600', '#9933ff', '#00ffff', '#ffffff'];
      colors.forEach(c => {
        const swatch = document.createElement('div');
        swatch.style.cssText = `width:30px;height:30px;background:${c};border-radius:50%;cursor:pointer;border:2px solid ${c === paintColor ? '#fff' : 'transparent'};`;
        swatch.onclick = () => {
          paintColor = c;
          document.querySelectorAll('#color-picker div').forEach(s => s.style.borderColor = 'transparent');
          swatch.style.borderColor = '#fff';
        };
        cp.appendChild(swatch);
      });
      document.body.appendChild(cp);
    } else {
      colorPicker.style.display = 'flex';
    }

    setS('Paintball ON! Click to shoot');
  } else {
    if (crosshair) crosshair.style.display = 'none';
    if (colorPicker) colorPicker.style.display = 'none';
    setS('Paintball OFF');
  }
  setTimeout(() => setS(''), 2000);
}

function shootPaintball() {
  if (!player || activeVehicle) return;

  const src = player.position.clone();
  src.y += 1.1; // Shoulder height for smaller character

  // Shoot toward center of screen (where camera is looking)
  // Use camera direction, accounting for both yaw and pitch
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);

  firePaintball(src, dir);
}

function shootAtScreen(sx, sy) {
  if (!player) return;

  const src = player.position.clone();
  src.y += 1.1; // Shoulder height for smaller character

  // Raycast from screen point
  const mouse = new THREE.Vector2(
    (sx / innerWidth) * 2 - 1,
    -(sy / innerHeight) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);
  const dir = raycaster.ray.direction.clone();

  firePaintball(src, dir);
}

function firePaintball(src, dir) {
  const geo = new THREE.SphereGeometry(0.15, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: paintColor });
  const ball = new THREE.Mesh(geo, mat);

  ball.position.copy(src);
  ball.userData = {
    vel: dir.clone().multiplyScalar(PAINT_SPEED),
    color: paintColor,
    life: 5
  };

  scene.add(ball);
  paintBalls.push(ball);
}

function updatePaintballs(dt) {
  for (let i = paintBalls.length - 1; i >= 0; i--) {
    const b = paintBalls[i];
    b.userData.vel.y += PAINT_GRAVITY * dt;
    b.position.addScaledVector(b.userData.vel, dt);
    b.userData.life -= dt;

    // Check zombie hits first
    if (checkZombieHits(b)) {
      scene.remove(b);
      paintBalls.splice(i, 1);
      continue;
    }

    // Check collision with tiles
    if (tilesRenderer) {
      const raycaster = new THREE.Raycaster();
      raycaster.set(b.position, b.userData.vel.clone().normalize());
      raycaster.far = b.userData.vel.length() * dt * 2;

      const hits = raycaster.intersectObject(tilesRenderer.group, true);
      if (hits.length > 0) {
        createSplat(hits[0].point, hits[0].face?.normal || new THREE.Vector3(0, 1, 0), b.userData.color);
        scene.remove(b);
        paintBalls.splice(i, 1);
        continue;
      }
    }

    // Ground check
    if (b.position.y < 0) {
      createSplat(new THREE.Vector3(b.position.x, 0.01, b.position.z), new THREE.Vector3(0, 1, 0), b.userData.color);
      scene.remove(b);
      paintBalls.splice(i, 1);
      continue;
    }

    // Life expired
    if (b.userData.life <= 0) {
      scene.remove(b);
      paintBalls.splice(i, 1);
    }
  }
}

function createSplat(pos, normal, color) {
  const geo = new THREE.CircleGeometry(0.3 + Math.random() * 0.3, 8);
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const splat = new THREE.Mesh(geo, mat);

  splat.position.copy(pos);
  splat.lookAt(pos.clone().add(normal));
  splat.position.addScaledVector(normal, 0.02);

  scene.add(splat);
  paintSplats.push(splat);

  // Remove old splats
  while (paintSplats.length > MAX_SPLATS) {
    const old = paintSplats.shift();
    scene.remove(old);
  }
}

// ═══ MINI MAP ═══
function initMinimap() {
  const canvas = document.getElementById('minimap');
  if (canvas) {
    minimapCtx = canvas.getContext('2d');
    loadMinimapImage();
  }
}

function loadMinimapImage() {
  // Load Google Maps Static image for the minimap background
  const size = 300; // Higher res for quality
  const zoom = 18; // Street level zoom
  const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${cLat},${cLon}&zoom=${zoom}&size=${size}x${size}&maptype=roadmap&style=feature:all|element:labels|visibility:off&style=feature:road|element:geometry|color:0x444444&style=feature:landscape|element:geometry|color:0x222222&style=feature:water|element:geometry|color:0x111133&style=feature:poi|visibility:off&key=${GOOGLE_API_KEY}`;

  minimapImage = new Image();
  minimapImage.crossOrigin = 'anonymous';
  minimapImage.src = mapUrl;
}

function drawMinimap() {
  if (!minimapCtx || !player) return;

  const canvas = minimapCtx.canvas;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const playerPos = player.userData.localPos;

  // Clear canvas
  minimapCtx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw circular clip path
  minimapCtx.save();
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, cx - 2, 0, Math.PI * 2);
  minimapCtx.clip();

  // Draw map background image if loaded
  if (minimapImage && minimapImage.complete) {
    // The image is centered on spawn point, so we need to offset based on player position
    // Each pixel in the static map is approximately 0.5m at zoom 18
    const pixelsPerMeter = 2; // At zoom 18
    const offsetX = -playerPos.x * pixelsPerMeter;
    const offsetZ = playerPos.z * pixelsPerMeter; // Flip Z because map Y is inverted

    minimapCtx.drawImage(
      minimapImage,
      cx - minimapImage.width / 2 + offsetX,
      cy - minimapImage.height / 2 + offsetZ,
      minimapImage.width,
      minimapImage.height
    );
  } else {
    // Fallback dark background with grid
    minimapCtx.fillStyle = 'rgba(10, 15, 20, 0.95)';
    minimapCtx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    minimapCtx.strokeStyle = 'rgba(0, 255, 170, 0.15)';
    minimapCtx.lineWidth = 1;
    for (let i = -5; i <= 5; i++) {
      const offset = i * 20;
      minimapCtx.beginPath();
      minimapCtx.moveTo(cx + offset, 0);
      minimapCtx.lineTo(cx + offset, canvas.height);
      minimapCtx.stroke();
      minimapCtx.beginPath();
      minimapCtx.moveTo(0, cy + offset);
      minimapCtx.lineTo(canvas.width, cy + offset);
      minimapCtx.stroke();
    }
  }

  // Draw spawn point (yellow star) - NORTH IS UP, no rotation
  const spawnDx = (spawnPoint.x - playerPos.x) / MINIMAP_SCALE;
  const spawnDz = (spawnPoint.z - playerPos.z) / MINIMAP_SCALE;
  const spawnMapX = cx + spawnDx;
  const spawnMapY = cy - spawnDz; // Negative because +Z is forward but map Y goes down

  if (Math.abs(spawnDx) < cx && Math.abs(spawnDz) < cy) {
    minimapCtx.fillStyle = '#ffcc00';
    minimapCtx.beginPath();
    drawStar(minimapCtx, spawnMapX, spawnMapY, 5, 6, 3);
    minimapCtx.fill();
  }

  // Draw markers (dropped pins)
  mapMarkers.forEach((marker, i) => {
    const dx = (marker.x - playerPos.x) / MINIMAP_SCALE;
    const dz = (marker.z - playerPos.z) / MINIMAP_SCALE;

    if (Math.abs(dx) < cx && Math.abs(dz) < cy) {
      minimapCtx.fillStyle = marker.color || '#ff66aa';
      minimapCtx.beginPath();
      minimapCtx.arc(cx + dx, cy - dz, 4, 0, Math.PI * 2);
      minimapCtx.fill();
      minimapCtx.fillStyle = '#fff';
      minimapCtx.font = '8px Orbitron';
      minimapCtx.textAlign = 'center';
      minimapCtx.fillText(i + 1, cx + dx, cy - dz + 3);
    }
  });

  // Draw vehicles
  vehicles.forEach(v => {
    const dx = (v.userData.localPos.x - playerPos.x) / MINIMAP_SCALE;
    const dz = (v.userData.localPos.z - playerPos.z) / MINIMAP_SCALE;

    if (Math.abs(dx) < cx && Math.abs(dz) < cy) {
      minimapCtx.fillStyle = v === activeVehicle ? '#00ffaa' : '#4488ff';
      minimapCtx.fillRect(cx + dx - 3, cy - dz - 2, 6, 4);
    }
  });

  // Draw zombies (red dots)
  zombies.forEach(z => {
    if (z.userData.dead) return;
    const dx = (z.userData.localPos.x - playerPos.x) / MINIMAP_SCALE;
    const dz = (z.userData.localPos.z - playerPos.z) / MINIMAP_SCALE;

    if (Math.abs(dx) < cx && Math.abs(dz) < cy) {
      minimapCtx.fillStyle = '#ff0000';
      minimapCtx.beginPath();
      minimapCtx.arc(cx + dx, cy - dz, 3, 0, Math.PI * 2);
      minimapCtx.fill();
    }
  });

  // Draw player (center, ROTATES to show facing direction)
  minimapCtx.save();
  minimapCtx.translate(cx, cy);
  // Get player facing direction (use facingYaw if moving, otherwise camera yaw)
  const playerFacing = player.userData.facingYaw || yaw;
  minimapCtx.rotate(-playerFacing); // Negative because canvas rotation is clockwise

  minimapCtx.fillStyle = '#00ff88';
  minimapCtx.beginPath();
  minimapCtx.moveTo(0, -8);  // Point forward
  minimapCtx.lineTo(-5, 5);
  minimapCtx.lineTo(5, 5);
  minimapCtx.closePath();
  minimapCtx.fill();
  minimapCtx.restore();

  minimapCtx.restore(); // Restore from clip

  // Draw compass ring (outside clip)
  minimapCtx.strokeStyle = 'rgba(0, 255, 170, 0.4)';
  minimapCtx.lineWidth = 2;
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, cx - 2, 0, Math.PI * 2);
  minimapCtx.stroke();

  // Update coords display
  const coordsEl = document.getElementById('minimap-coords');
  if (coordsEl) {
    coordsEl.textContent = `${playerPos.x.toFixed(0)}, ${playerPos.z.toFixed(0)}`;
  }
}

function drawStar(ctx, x, y, points, outer, inner) {
  ctx.moveTo(x, y - outer);
  for (let i = 0; i < points; i++) {
    const angle = (i * 2 * Math.PI / points) - Math.PI / 2;
    const nextAngle = angle + Math.PI / points;
    ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    ctx.lineTo(x + Math.cos(nextAngle) * inner, y + Math.sin(nextAngle) * inner);
  }
  ctx.closePath();
}

function dropMarker() {
  if (!player) return;
  const pos = player.userData.localPos;
  const colors = ['#ff66aa', '#66aaff', '#aaff66', '#ffaa66', '#aa66ff'];
  mapMarkers.push({
    x: pos.x,
    z: pos.z,
    color: colors[mapMarkers.length % colors.length]
  });
  setS(`Marker ${mapMarkers.length} dropped!`);
  setTimeout(() => setS(''), 2000);
}

function clearMarkers() {
  mapMarkers = [];
  setS('Markers cleared');
  setTimeout(() => setS(''), 2000);
}

function updateJetpackHUD() {
  let hud = document.getElementById('jetpack-hud');

  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'jetpack-hud';
    hud.style.cssText = 'position:fixed;bottom:50px;left:10px;background:rgba(0,0,0,0.6);padding:8px;border-radius:4px;font-size:12px;color:#fff;z-index:80;display:none;';
    hud.innerHTML = '<div style="margin-bottom:4px;">FUEL</div><div style="width:100px;height:8px;background:#333;border-radius:4px;"><div id="fuel-bar" style="height:100%;background:linear-gradient(90deg,#ff6600,#ffaa00);border-radius:4px;width:100%;"></div></div>';
    document.body.appendChild(hud);
  }

  if (jetpackActive || jetpackFuel < JETPACK_MAX_FUEL) {
    hud.style.display = 'block';
    document.getElementById('fuel-bar').style.width = (jetpackFuel / JETPACK_MAX_FUEL * 100) + '%';
  } else {
    hud.style.display = 'none';
  }
}

// ═══ RAYCAST FOR GROUND HEIGHT ═══
function getGroundHeight(localX, localZ) {
  if (!tilesRenderer || !tilesRenderer.group.children.length) return 0;

  // Cast ray straight down in local coordinates (Y is up)
  const rayOrigin = new THREE.Vector3(localX, 500, localZ);
  const rayDir = new THREE.Vector3(0, -1, 0);

  const raycaster = new THREE.Raycaster();
  raycaster.set(rayOrigin, rayDir);
  raycaster.far = 1000;

  const intersects = raycaster.intersectObject(tilesRenderer.group, true);
  if (intersects.length > 0) {
    return intersects[0].point.y;
  }

  return 0;
}

// ═══ CONTROLS ═══
function setupControls() {
  document.addEventListener('keydown', e => {
    if (e.code === 'KeyE') {
      if (activeVehicle) exitVehicle();
      else enterNearestVehicle();
      return;
    }
    if (e.code === 'KeyJ') {
      jetpackActive = !jetpackActive;
      setS(jetpackActive ? 'Jetpack ON! Hold SHIFT to fly' : 'Jetpack OFF');
      setTimeout(() => setS(''), 2000);
      return;
    }
    if (e.code === 'KeyP') {
      togglePaintball();
      return;
    }
    if (e.code === 'KeyH') {
      const controls = document.getElementById('controls-key');
      if (controls) controls.classList.toggle('hidden');
      return;
    }
    if (e.code === 'KeyM') {
      dropMarker();
      return;
    }
    if (e.code === 'KeyC') {
      clearMarkers();
      return;
    }
    if (e.code === 'KeyG') {
      // Toggle wingsuit (only works in air)
      if (!onGround) {
        wingsuitActive = !wingsuitActive;
        if (wingsuitMesh) wingsuitMesh.visible = wingsuitActive;
        setS(wingsuitActive ? 'Wingsuit DEPLOYED!' : 'Wingsuit retracted');
        setTimeout(() => setS(''), 2000);
      } else {
        setS('Jump first to deploy wingsuit!');
        setTimeout(() => setS(''), 2000);
      }
      return;
    }
    if (e.code === 'KeyN') {
      toggleNightMode();
      return;
    }
    switch (e.code) {
      // WASD for movement
      case 'KeyW': mF = 1; break;
      case 'KeyS': mB = 1; break;
      case 'KeyA': mL = 1; break;
      case 'KeyD': mR = 1; break;
      // Arrow keys for looking
      case 'ArrowUp': arrowLook.up = 1; break;
      case 'ArrowDown': arrowLook.down = 1; break;
      case 'ArrowLeft': arrowLook.left = 1; break;
      case 'ArrowRight': arrowLook.right = 1; break;
      case 'ShiftLeft': case 'ShiftRight': sprinting = true; break;
      case 'Space':
        e.preventDefault();
        if (!activeVehicle && onGround) { velY = JUMP; onGround = false; }
        break;
      // Slash key for shooting
      case 'Slash':
        e.preventDefault();
        fireKeyHeld = true;
        break;
    }
  });

  document.addEventListener('keyup', e => {
    switch (e.code) {
      case 'KeyW': mF = 0; break;
      case 'KeyS': mB = 0; break;
      case 'KeyA': mL = 0; break;
      case 'KeyD': mR = 0; break;
      case 'ArrowUp': arrowLook.up = 0; break;
      case 'ArrowDown': arrowLook.down = 0; break;
      case 'ArrowLeft': arrowLook.left = 0; break;
      case 'ArrowRight': arrowLook.right = 0; break;
      case 'ShiftLeft': case 'ShiftRight': sprinting = false; break;
      case 'Slash': fireKeyHeld = false; break;
    }
  });

  let mouseDown = false, lastX = 0, lastY = 0;
  renderer.domElement.addEventListener('mousedown', e => { mouseDown = true; lastX = e.clientX; lastY = e.clientY; });
  document.addEventListener('mouseup', () => { mouseDown = false; });
  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement) {
      yaw -= e.movementX * MSENS;
      pitch -= e.movementY * MSENS;
    } else if (mouseDown) {
      yaw -= (e.clientX - lastX) * MSENS;
      pitch -= (e.clientY - lastY) * MSENS;
      lastX = e.clientX;
      lastY = e.clientY;
    }
    pitch = Math.max(-0.3, Math.min(1.4, pitch));
  });

  renderer.domElement.addEventListener('click', (e) => {
    if (paintMode) {
      shootAtScreen(e.clientX, e.clientY);
    } else if (!isMobile) {
      renderer.domElement.requestPointerLock();
    }
  });

  renderer.domElement.addEventListener('mousedown', (e) => {
    if (paintMode && e.button === 0) {
      shootAtScreen(e.clientX, e.clientY);
    }
  });

  if (isMobile) setupMobile();
}

function setupMobile() {
  document.getElementById('touch-controls').style.display = 'block';

  // Mobile menu handlers
  const menuBtn = document.getElementById('mobile-menu-btn');
  const menu = document.getElementById('mobile-menu');
  const menuClose = document.getElementById('mobile-menu-close');

  if (menuBtn) {
    menuBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      menu.classList.toggle('hidden');
    });
  }

  if (menuClose) {
    menuClose.addEventListener('touchstart', (e) => {
      e.preventDefault();
      menu.classList.add('hidden');
    });
  }

  // Menu item handlers
  document.getElementById('mm-jetpack')?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    jetpackActive = !jetpackActive;
    updateMobileMenuStatus();
  });

  document.getElementById('mm-paintball')?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    togglePaintball();
    updateMobileMenuStatus();
  });

  document.getElementById('mm-sprint')?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    autoSprint = !autoSprint;
    updateMobileMenuStatus();
  });

  document.getElementById('mm-car')?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (activeVehicle) exitVehicle();
    else enterNearestVehicle();
    menu.classList.add('hidden');
  });

  document.getElementById('mm-marker')?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    dropMarker();
    menu.classList.add('hidden');
  });

  document.getElementById('mm-clear-markers')?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    clearMarkers();
    menu.classList.add('hidden');
  });

  const jz = document.getElementById('jz');
  const jk = document.getElementById('jk');
  let jTID = null, jC = { x: 0, y: 0 };
  const JM = 40;

  jz.addEventListener('touchstart', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (jTID === null) {
        jTID = t.identifier;
        const r = document.getElementById('jb').getBoundingClientRect();
        jC = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
  }, { passive: false });

  jz.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === jTID) {
        let dx = t.clientX - jC.x, dy = t.clientY - jC.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > JM) { dx = dx / d * JM; dy = dy / d * JM; }
        jk.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        joyVec.x = dx / JM;
        joyVec.y = dy / JM;
      }
    }
  }, { passive: false });

  const rj = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === jTID) {
        jTID = null;
        jk.style.transform = 'translate(-50%, -50%)';
        joyVec = { x: 0, y: 0 };
      }
    }
  };
  jz.addEventListener('touchend', rj, { passive: false });
  jz.addEventListener('touchcancel', rj, { passive: false });

  // Look zone
  const lz = document.getElementById('lz');
  let lx = 0, ly = 0;

  lz.addEventListener('touchstart', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (lookTID === null) {
        lookTID = t.identifier;
        lx = t.clientX;
        ly = t.clientY;
      }
    }
  }, { passive: false });

  lz.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === lookTID) {
        yaw -= (t.clientX - lx) * 0.005;
        pitch -= (t.clientY - ly) * 0.003;
        pitch = Math.max(-0.3, Math.min(1.4, pitch));
        lx = t.clientX;
        ly = t.clientY;
      }
    }
  }, { passive: false });

  const rl = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookTID) lookTID = null;
    }
  };
  lz.addEventListener('touchend', rl, { passive: false });
  lz.addEventListener('touchcancel', rl, { passive: false });

  updateMobileButtons();
}

function updateMobileButtons() {
  const ab = document.getElementById('action-btns');
  if (activeVehicle) {
    ab.innerHTML = `
      <div class="abtn yl" id="mb-gas">GAS</div>
      <div class="abtn rd" id="mb-brake">BRK</div>
      <div class="abtn" id="mb-exit">EXIT</div>
    `;
    document.getElementById('mb-gas').addEventListener('touchstart', e => { e.preventDefault(); carAccelInput = 1; }, { passive: false });
    document.getElementById('mb-gas').addEventListener('touchend', () => { carAccelInput = 0; });
    document.getElementById('mb-brake').addEventListener('touchstart', e => { e.preventDefault(); carBrakeInput = 1; }, { passive: false });
    document.getElementById('mb-brake').addEventListener('touchend', () => { carBrakeInput = 0; });
    document.getElementById('mb-exit').addEventListener('touchstart', e => { e.preventDefault(); exitVehicle(); }, { passive: false });
  } else {
    ab.innerHTML = `
      <div class="abtn" id="mb-jump">JUMP</div>
      ${paintMode ? '<div class="abtn yl" id="mb-shoot">FIRE</div>' : ''}
    `;
    document.getElementById('mb-jump')?.addEventListener('touchstart', e => {
      e.preventDefault();
      if (onGround) { velY = JUMP; onGround = false; }
    }, { passive: false });
    document.getElementById('mb-shoot')?.addEventListener('touchstart', e => {
      e.preventDefault();
      shootPaintball();
    }, { passive: false });
  }
}

function updateMobileMenuStatus() {
  const jetpackStatus = document.getElementById('mm-jetpack-status');
  const paintballStatus = document.getElementById('mm-paintball-status');
  const sprintStatus = document.getElementById('mm-sprint-status');

  if (jetpackStatus) {
    jetpackStatus.textContent = jetpackActive ? 'ON' : 'OFF';
    jetpackStatus.classList.toggle('on', jetpackActive);
  }
  if (paintballStatus) {
    paintballStatus.textContent = paintMode ? 'ON' : 'OFF';
    paintballStatus.classList.toggle('on', paintMode);
  }
  if (sprintStatus) {
    sprintStatus.textContent = autoSprint ? 'ON' : 'OFF';
    sprintStatus.classList.toggle('on', autoSprint);
  }

  // Update action buttons when paintball changes
  if (isMobile && !activeVehicle) updateMobileButtons();
}

// ═══ VEHICLE ENTER/EXIT ═══
function enterNearestVehicle() {
  if (!player) return;
  const pPos = player.userData.localPos;
  let best = null, bestDist = 8;
  for (const v of vehicles) {
    const d = pPos.distanceTo(v.userData.localPos);
    if (d < bestDist) { bestDist = d; best = v; }
  }
  if (best) {
    activeVehicle = best;
    player.visible = false;
    document.getElementById('speedometer').style.display = 'block';
    if (isMobile) updateMobileButtons();
  }
}

function exitVehicle() {
  if (!activeVehicle) return;
  player.userData.localPos.copy(activeVehicle.userData.localPos);
  player.userData.localPos.x += 2;
  player.userData.localPos.y += 0.5;
  player.visible = true;
  velY = 0;
  activeVehicle = null;
  document.getElementById('speedometer').style.display = 'none';
  if (isMobile) updateMobileButtons();
}

// ═══ GAME LOOP ═══
let lastShotTime = 0;
const SHOT_COOLDOWN = 0.15; // Seconds between shots when holding command

function gameLoop() {
  requestAnimationFrame(gameLoop);
  const dt = Math.min(clock.getDelta(), 0.1);

  // Update tiles
  if (tilesRenderer) {
    tilesRenderer.setCamera(camera);
    tilesRenderer.setResolutionFromRenderer(camera, renderer);
    tilesRenderer.update();
  }

  // Arrow key looking (takes priority over auto-follow)
  const lookX = arrowLook.right - arrowLook.left;
  const lookY = arrowLook.down - arrowLook.up;
  const arrowsActive = lookX !== 0 || lookY !== 0;

  if (arrowsActive) {
    yaw -= lookX * ARROW_LOOK_SPEED * dt;
    pitch += lookY * ARROW_LOOK_SPEED * dt * 0.5;
    pitch = Math.max(-0.3, Math.min(1.4, pitch));
  }

  // Auto-follow camera when running (but arrows override)
  if (!arrowsActive && !activeVehicle && player) {
    const moveX = mR - mL + (Math.abs(joyVec.x) > 0.1 ? joyVec.x : 0);
    const moveZ = mF - mB + (Math.abs(joyVec.y) > 0.1 ? -joyVec.y : 0);
    const isMoving = Math.abs(moveZ) > 0.1 || Math.abs(moveX) > 0.1;

    if (isMoving) {
      // Calculate movement direction in world space
      const moveDirX = Math.sin(yaw) * moveZ - Math.cos(yaw) * moveX;
      const moveDirZ = Math.cos(yaw) * moveZ + Math.sin(yaw) * moveX;
      const targetYaw = Math.atan2(moveDirX, moveDirZ);

      // Slowly rotate camera toward movement direction
      let yawDiff = targetYaw - yaw;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      yaw += yawDiff * 0.02; // Slow auto-follow (0.02 = gentle)
    }
  }

  // Slash key shooting (auto-fire when held in paintball mode)
  if (fireKeyHeld && paintMode && !activeVehicle) {
    lastShotTime += dt;
    if (lastShotTime >= SHOT_COOLDOWN) {
      shootPaintball();
      lastShotTime = 0;
    }
  }

  // Update player or vehicle
  if (activeVehicle) {
    updateVehicle(dt);
  } else {
    updatePlayer(dt);
  }

  // Update 3D positions from local coords
  updateWorldPositions();

  // Update camera
  updateCamera();

  // Update zombies
  updateZombies(dt);

  // Update paintballs
  if (paintMode) updatePaintballs(dt);

  // Update minimap
  drawMinimap();

  renderer.render(scene, camera);
}

function updatePlayer(dt) {
  if (!player) return;

  let moveX = mR - mL;  // Positive = right strafe
  let moveZ = mF - mB;  // Positive = forward
  if (Math.abs(joyVec.x) > 0.1) moveX = joyVec.x;
  if (Math.abs(joyVec.y) > 0.1) moveZ = -joyVec.y;

  const speed = P_SPD * ((sprinting || autoSprint) ? SPRINT : 1);

  // Movement relative to camera/yaw direction
  // Forward is -Z in Three.js (toward where camera looks)
  const dx = (Math.sin(yaw) * moveZ - Math.cos(yaw) * moveX) * speed * dt;
  const dz = (Math.cos(yaw) * moveZ + Math.sin(yaw) * moveX) * speed * dt;

  player.userData.localPos.x += dx;
  player.userData.localPos.z += dz;

  // Jetpack physics
  if (jetpackActive && jetpackFuel > 0 && (sprinting || autoSprint)) {
    velY = 12; // Upward thrust
    jetpackFuel -= dt;
    if (jetpackFuel < 0) jetpackFuel = 0;
    onGround = false;
    if (jetpackMesh) {
      jetpackMesh.flame1.visible = true;
      jetpackMesh.flame2.visible = true;
    }
    // Disable wingsuit while jetpacking
    if (wingsuitActive) {
      wingsuitActive = false;
      if (wingsuitMesh) wingsuitMesh.visible = false;
    }
  } else if (wingsuitActive && !onGround && velY < 0) {
    // Wingsuit gliding physics
    // Slow the fall significantly
    velY = Math.max(velY, WINGSUIT_MIN_FALL);
    velY += GRAV * dt * 0.1; // Much reduced gravity

    // Convert fall speed into forward speed
    const glideSpeed = Math.abs(velY) * WINGSUIT_GLIDE_RATIO * (sprinting ? 1.5 : 1);
    const glideDx = Math.sin(yaw) * glideSpeed * dt;
    const glideDz = Math.cos(yaw) * glideSpeed * dt;
    player.userData.localPos.x += glideDx;
    player.userData.localPos.z += glideDz;

    if (jetpackMesh) {
      jetpackMesh.flame1.visible = false;
      jetpackMesh.flame2.visible = false;
    }
  } else {
    // Normal gravity
    velY += GRAV * dt;
    if (jetpackMesh) {
      jetpackMesh.flame1.visible = false;
      jetpackMesh.flame2.visible = false;
    }
  }

  player.userData.localPos.y += velY * dt;

  // Ground collision
  const groundY = getGroundHeight(player.userData.localPos.x, player.userData.localPos.z);
  if (player.userData.localPos.y < groundY + 0.1) {
    player.userData.localPos.y = groundY + 0.1;
    velY = 0;
    onGround = true;

    // Auto-retract wingsuit on landing
    if (wingsuitActive) {
      wingsuitActive = false;
      if (wingsuitMesh) wingsuitMesh.visible = false;
    }

    // Recharge jetpack on ground
    if (jetpackFuel < JETPACK_MAX_FUEL) {
      jetpackFuel += dt * 0.5;
      if (jetpackFuel > JETPACK_MAX_FUEL) jetpackFuel = JETPACK_MAX_FUEL;
    }
  }

  // Update jetpack HUD
  updateJetpackHUD();

  // Player model rotates to face movement direction (camera controlled by arrows)
  const isMoving = Math.abs(moveZ) > 0.1 || Math.abs(moveX) > 0.1;
  if (isMoving) {
    const moveAngle = Math.atan2(dx, dz);
    // Smoothly rotate player model to face movement direction
    player.userData.facingYaw = player.userData.facingYaw || yaw;
    let facingDiff = moveAngle - player.userData.facingYaw;
    while (facingDiff > Math.PI) facingDiff -= Math.PI * 2;
    while (facingDiff < -Math.PI) facingDiff += Math.PI * 2;
    player.userData.facingYaw += facingDiff * 0.15;
  }

  // Running animation
  const moveSpeed = Math.sqrt(dx * dx + dz * dz) / dt;
  if (isMoving && onGround && moveSpeed > 0.5) {
    const animSpeed = (sprinting || autoSprint) ? 18 : 12;
    player.userData.animTime += dt * animSpeed;
    const swing = Math.sin(player.userData.animTime) * 0.6;

    // Legs swing opposite to each other
    player.userData.leftLegPivot.rotation.x = swing;
    player.userData.rightLegPivot.rotation.x = -swing;

    // Arms swing opposite to legs
    player.userData.leftArmPivot.rotation.x = -swing * 0.8;
    player.userData.rightArmPivot.rotation.x = swing * 0.8;
  } else {
    // Return to idle pose
    player.userData.leftLegPivot.rotation.x *= 0.85;
    player.userData.rightLegPivot.rotation.x *= 0.85;
    player.userData.leftArmPivot.rotation.x *= 0.85;
    player.userData.rightArmPivot.rotation.x *= 0.85;
  }
}

function updateVehicle(dt) {
  const v = activeVehicle;
  let ac = mF || carAccelInput ? 1 : 0;
  let br = mB || carBrakeInput ? 1 : 0;
  let st = mR - mL;

  if (Math.abs(joyVec.x) > 0.15) st = joyVec.x;
  if (joyVec.y < -0.2) ac = Math.min(1, -joyVec.y);
  if (joyVec.y > 0.2) br = Math.min(1, joyVec.y);

  let spd = v.userData.speed;
  spd += ac * CAR_ACCEL * dt;
  if (br) {
    if (spd > 0) spd -= CAR_BRAKE * dt;
    else spd -= CAR_ACCEL * 0.4 * dt;
  }
  if (!ac && !br) spd *= (1 - CAR_FRICTION * dt);
  spd = Math.max(-CAR_MAX * 0.3, Math.min(CAR_MAX, spd));

  v.userData.angle += st * CAR_STEER * dt * Math.min(1, Math.abs(spd) / 5) * (spd >= 0 ? 1 : -1);

  // Move in local coords
  v.userData.localPos.x += Math.sin(v.userData.angle) * spd * dt;
  v.userData.localPos.z += Math.cos(v.userData.angle) * spd * dt;

  // Ground height
  const groundY = getGroundHeight(v.userData.localPos.x, v.userData.localPos.z);
  v.userData.localPos.y = groundY + 0.5;

  v.userData.speed = spd;

  // Update speedometer
  document.getElementById('spd-val').textContent = Math.abs(spd * 2.237).toFixed(0);
  yaw = v.userData.angle + Math.PI;
}

function updateWorldPositions() {
  // Update player position - now simple since tiles are in local coords
  if (player && player.visible) {
    player.position.copy(player.userData.localPos);
    // Player model faces movement direction, not camera direction
    player.rotation.y = player.userData.facingYaw || yaw;
  }

  // Update vehicles
  for (const v of vehicles) {
    v.position.copy(v.userData.localPos);
    v.rotation.y = v.userData.angle;
  }
}

function updateCamera() {
  const target = activeVehicle || player;
  if (!target) return;

  const tgtLocal = target.userData.localPos;

  // Camera position in local coords (Y is up)
  const camPos = new THREE.Vector3(
    tgtLocal.x - Math.sin(yaw) * CAM_DIST,
    tgtLocal.y + CAM_HEIGHT + Math.sin(pitch) * CAM_DIST * 0.5,
    tgtLocal.z - Math.cos(yaw) * CAM_DIST
  );

  // Smooth camera movement
  camera.position.lerp(camPos, 0.12);

  // Look at target (upper body of character)
  const lookAt = new THREE.Vector3(tgtLocal.x, tgtLocal.y + 1.0, tgtLocal.z);
  camera.lookAt(lookAt);
}

// ═══ START GAME ═══
async function startGame() {
  try {
    setS('Initializing...');
    setP(10);

    initThree();

    await setupTiles();

    setS('Creating player...');
    setP(90);

    createPlayer();
    createJetpackMesh();
    createWingsuitMesh();

    // Set spawn point for minimap
    spawnPoint = { x: 0, z: 0 };
    initMinimap();

    // Spawn cars nearby (post-apocalyptic abandoned cars)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 10 + Math.random() * 25;
      const car = createVehicle(Math.cos(angle) * dist, Math.sin(angle) * dist);
      vehicles.push(car);
    }

    // Spawn zombies!
    spawnZombies();

    setupControls();

    setS('Ready! Explore the photorealistic world.');
    setP(100);

    document.getElementById('launch').style.display = 'none';
    document.getElementById('gc').style.display = 'block';
    document.getElementById('hud').style.display = 'block';
    document.getElementById('hn').textContent = locName;

    gameLoop();

  } catch (e) {
    console.error('Start game error:', e);
    setS('Error: ' + e.message, true);
  }
}

// ═══ EVENT LISTENERS ═══
document.getElementById('go-btn').addEventListener('click', async () => {
  const query = document.getElementById('li').value.trim();
  if (!query) { setS('Enter an address', true); return; }
  setS('Searching...');
  try {
    const loc = await geocode(query);
    cLat = loc.lat;
    cLon = loc.lon;
    locName = loc.name;
    startGame();
  } catch (e) {
    setS(e.message, true);
  }
});

document.getElementById('gps-btn').addEventListener('click', () => {
  if (!navigator.geolocation) { setS('GPS not available', true); return; }
  setS('Getting location...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      cLat = pos.coords.latitude;
      cLon = pos.coords.longitude;
      locName = 'Your Location';
      startGame();
    },
    err => setS('GPS error: ' + err.message, true),
    { enableHighAccuracy: true }
  );
});

// Enter key to search
document.getElementById('li').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('go-btn').click();
});
