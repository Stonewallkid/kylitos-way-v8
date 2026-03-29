import * as THREE from 'three';

// ═══ CONFIG ═══
const GOOGLE_API_KEY = 'AIzaSyA8hlBZf4nsKQ92rjyqxUUrxQ9Awh74_bQ';
const WORLD_RADIUS = 400; // meters to load

// ═══ STATE ═══
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
let scene, camera, renderer, clock;
let player;
let velY = 0, onGround = true;
let mF = 0, mB = 0, mL = 0, mR = 0, sprinting = false;
let yaw = 0, pitch = 0.4;
let cLat, cLon, locName = '';
let joyVec = { x: 0, y: 0 }, lookTID = null;
let vehicles = [], activeVehicle = null;
let carAccelInput = 0, carBrakeInput = 0;
let autoSprint = false;

// World objects
let buildings = [];
let roads = [];
let groundMesh = null;

// Jetpack
let jetpackActive = false;
const JETPACK_MAX_FUEL = 15;
let jetpackFuel = JETPACK_MAX_FUEL;
let jetpackMesh = null;

// Paintball
let paintMode = false;
let paintColor = '#ff3366';
let paintBalls = [];
let paintSplats = [];
const PAINT_SPEED = 50;
const PAINT_GRAVITY = -15;
const MAX_SPLATS = 300;

// Mini map
let spawnPoint = { x: 0, z: 0 };
let mapMarkers = [];
let minimapCtx = null;
const MINIMAP_SCALE = 3;

// Constants
const P_SPD = 8, SPRINT = 2.2, JUMP = 12, GRAV = -30, MSENS = 0.003;
const CAM_DIST = 6, CAM_HEIGHT = 2.5;
const CAR_ACCEL = 15, CAR_BRAKE = 20, CAR_MAX = 28, CAR_STEER = 2, CAR_FRICTION = 5;
const PLAYER_RADIUS = 0.3;

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

// ═══ COORDINATE UTILS ═══
function latLonToLocal(lat, lon, centerLat, centerLon) {
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(centerLat * Math.PI / 180);
  return {
    x: (lon - centerLon) * metersPerDegLon,
    z: -(lat - centerLat) * metersPerDegLat
  };
}

// ═══ INIT THREE.JS ═══
function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);
  scene.fog = new THREE.Fog(0x87CEEB, 200, 500);

  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 1000);

  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('gc'),
    antialias: !isMobile
  });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffee, 1.0);
  sun.position.set(50, 100, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 300;
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150;
  sun.shadow.camera.bottom = -150;
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(0x87CEEB, 0x3a5f0b, 0.4);
  scene.add(hemi);

  clock = new THREE.Clock();

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

// ═══ LOAD OSM DATA ═══
async function loadOSMData() {
  setS('Loading map data...');
  setP(30);

  const bbox = `${cLat - 0.004},${cLon - 0.005},${cLat + 0.004},${cLon + 0.005}`;

  const query = `
    [out:json][timeout:30];
    (
      way["building"](${bbox});
      way["highway"](${bbox});
    );
    out body;
    >;
    out skel qt;
  `;

  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`
    });
    const data = await resp.json();

    setS('Building world...');
    setP(50);

    processOSMData(data);
  } catch (e) {
    console.error('OSM load error:', e);
    setS('Using basic ground only');
  }
}

function processOSMData(data) {
  const nodes = {};
  data.elements.filter(e => e.type === 'node').forEach(n => {
    nodes[n.id] = latLonToLocal(n.lat, n.lon, cLat, cLon);
  });

  const ways = data.elements.filter(e => e.type === 'way');

  // Process buildings
  ways.filter(w => w.tags?.building).forEach(w => {
    const coords = w.nodes.map(id => nodes[id]).filter(Boolean);
    if (coords.length < 3) return;

    const height = parseFloat(w.tags['building:levels'] || '2') * 3.5 + Math.random() * 2;
    createBuilding(coords, height, w.tags);
  });

  // Process roads
  ways.filter(w => w.tags?.highway).forEach(w => {
    const coords = w.nodes.map(id => nodes[id]).filter(Boolean);
    if (coords.length < 2) return;

    const type = w.tags.highway;
    const width = type === 'primary' ? 12 : type === 'secondary' ? 10 : type === 'residential' ? 8 : 6;
    createRoad(coords, width);
  });

  setP(70);
}

// ═══ CREATE BUILDING ═══
function createBuilding(coords, height, tags) {
  // Calculate centroid and bounds
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let sumX = 0, sumZ = 0;

  coords.forEach(c => {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z);
    maxZ = Math.max(maxZ, c.z);
    sumX += c.x;
    sumZ += c.z;
  });

  const cx = sumX / coords.length;
  const cz = sumZ / coords.length;
  const width = maxX - minX;
  const depth = maxZ - minZ;

  if (width < 2 || depth < 2) return;

  // Building colors based on type
  const buildingType = tags?.building || 'yes';
  let color;
  if (buildingType === 'commercial' || buildingType === 'retail') {
    color = new THREE.Color().setHSL(0.6, 0.2, 0.6 + Math.random() * 0.2);
  } else if (buildingType === 'industrial') {
    color = new THREE.Color().setHSL(0.1, 0.1, 0.4 + Math.random() * 0.2);
  } else {
    color = new THREE.Color().setHSL(0.08 + Math.random() * 0.05, 0.3, 0.5 + Math.random() * 0.3);
  }

  const geo = new THREE.BoxGeometry(width, height, depth);
  const mat = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, height / 2, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Store collision data
  mesh.userData = {
    type: 'building',
    bounds: { minX, maxX, minZ, maxZ },
    height
  };

  scene.add(mesh);
  buildings.push(mesh);
}

// ═══ CREATE ROAD ═══
function createRoad(coords, width) {
  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];

    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dx, dz);

    const geo = new THREE.PlaneGeometry(width, length);
    const mat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const mesh = new THREE.Mesh(geo, mat);

    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -angle;
    mesh.position.set((p1.x + p2.x) / 2, 0.02, (p1.z + p2.z) / 2);
    mesh.receiveShadow = true;

    scene.add(mesh);
    roads.push(mesh);
  }
}

// ═══ CREATE GROUND ═══
function createGround() {
  const geo = new THREE.PlaneGeometry(WORLD_RADIUS * 2, WORLD_RADIUS * 2);
  const mat = new THREE.MeshLambertMaterial({ color: 0x4a7c20 });
  groundMesh = new THREE.Mesh(geo, mat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

// ═══ CREATE PLAYER ═══
function createPlayer() {
  const group = new THREE.Group();

  // Leg pivots
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.12, 0.52, 0);
  group.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.12, 0.52, 0);
  group.add(rightLegPivot);

  // Legs
  const legGeo = new THREE.CapsuleGeometry(0.1, 0.4, 4, 8);
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2244aa });
  const leftLeg = new THREE.Mesh(legGeo, pantsMat);
  leftLeg.position.y = -0.2;
  leftLeg.castShadow = true;
  leftLegPivot.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo, pantsMat);
  rightLeg.position.y = -0.2;
  rightLeg.castShadow = true;
  rightLegPivot.add(rightLeg);

  // Torso
  const torsoGeo = new THREE.CapsuleGeometry(0.18, 0.4, 4, 8);
  const shirtMat = new THREE.MeshLambertMaterial({ color: 0xff4444 });
  const torso = new THREE.Mesh(torsoGeo, shirtMat);
  torso.position.y = 0.9;
  torso.castShadow = true;
  group.add(torso);

  // Arm pivots
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.28, 1.05, 0);
  group.add(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.28, 1.05, 0);
  group.add(rightArmPivot);

  // Arms
  const armGeo = new THREE.CapsuleGeometry(0.06, 0.35, 4, 8);
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
  const leftArm = new THREE.Mesh(armGeo, skinMat);
  leftArm.position.y = -0.18;
  leftArm.castShadow = true;
  leftArmPivot.add(leftArm);
  const rightArm = new THREE.Mesh(armGeo, skinMat);
  rightArm.position.y = -0.18;
  rightArm.castShadow = true;
  rightArmPivot.add(rightArm);

  // Head
  const headGeo = new THREE.SphereGeometry(0.15, 16, 16);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.y = 1.35;
  head.castShadow = true;
  group.add(head);

  // Hair
  const hairGeo = new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const hairMat = new THREE.MeshLambertMaterial({ color: 0x332211 });
  const hair = new THREE.Mesh(hairGeo, hairMat);
  hair.position.y = 1.38;
  group.add(hair);

  // Shadow
  const shadowGeo = new THREE.CircleGeometry(0.25, 16);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  // Store refs
  group.userData = {
    shadow,
    leftLegPivot,
    rightLegPivot,
    leftArmPivot,
    rightArmPivot,
    animTime: 0,
    localPos: new THREE.Vector3(0, 2, 0),
    height: 1.5
  };

  scene.add(group);
  player = group;
  return group;
}

// ═══ CREATE VEHICLE ═══
function createVehicle(localX, localZ) {
  const car = new THREE.Group();

  const colors = [0xcc2222, 0x2222cc, 0x22aa22, 0xcccc22, 0x888888, 0x222222, 0xffffff, 0xff8800];
  const color = colors[Math.floor(Math.random() * colors.length)];

  // Body
  const bodyGeo = new THREE.BoxGeometry(2, 0.8, 4.5);
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.6;
  body.castShadow = true;
  car.add(body);

  // Cabin
  const cabinGeo = new THREE.BoxGeometry(1.7, 0.6, 2.2);
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x88ccff, transparent: true, opacity: 0.7 });
  const cabin = new THREE.Mesh(cabinGeo, glassMat);
  cabin.position.set(0, 1.15, -0.3);
  car.add(cabin);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.25, 16);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  [[0.95, 0.4, 1.5], [-0.95, 0.4, 1.5], [0.95, 0.4, -1.5], [-0.95, 0.4, -1.5]].forEach(pos => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(...pos);
    wheel.castShadow = true;
    car.add(wheel);
  });

  car.userData = {
    type: 'vehicle',
    speed: 0,
    angle: Math.random() * Math.PI * 2,
    localPos: new THREE.Vector3(localX, 0.01, localZ),
    bounds: { halfWidth: 1.1, halfLength: 2.4 }
  };

  scene.add(car);
  return car;
}

// ═══ COLLISION DETECTION ═══
function checkBuildingCollision(x, z, radius) {
  for (const b of buildings) {
    const bounds = b.userData.bounds;
    const closestX = Math.max(bounds.minX, Math.min(x, bounds.maxX));
    const closestZ = Math.max(bounds.minZ, Math.min(z, bounds.maxZ));

    const dx = x - closestX;
    const dz = z - closestZ;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < radius) {
      return { hit: true, pushX: dx, pushZ: dz, dist };
    }
  }
  return { hit: false };
}

function checkVehicleCollision(x, z, radius, excludeVehicle = null) {
  for (const v of vehicles) {
    if (v === excludeVehicle) continue;

    const vx = v.userData.localPos.x;
    const vz = v.userData.localPos.z;
    const dx = x - vx;
    const dz = z - vz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Simple circle collision for vehicles
    const vRadius = 2.5;
    if (dist < radius + vRadius) {
      return { hit: true, vehicle: v, dist };
    }
  }
  return { hit: false };
}

// ═══ JETPACK MESH ═══
function createJetpackMesh() {
  if (jetpackMesh || !player) return;

  const g = new THREE.Group();

  const tankGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.25, 8);
  const tankMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
  const tank1 = new THREE.Mesh(tankGeo, tankMat);
  tank1.position.set(-0.12, 0.9, -0.15);
  g.add(tank1);
  const tank2 = tank1.clone();
  tank2.position.x = 0.12;
  g.add(tank2);

  const flameGeo = new THREE.ConeGeometry(0.04, 0.2, 8);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
  const flame1 = new THREE.Mesh(flameGeo, flameMat);
  flame1.position.set(-0.12, 0.7, -0.15);
  flame1.rotation.x = Math.PI;
  flame1.visible = false;
  g.add(flame1);
  const flame2 = flame1.clone();
  flame2.position.x = 0.12;
  g.add(flame2);

  g.flame1 = flame1;
  g.flame2 = flame2;

  player.add(g);
  jetpackMesh = g;
}

// ═══ PAINTBALL FUNCTIONS ═══
function togglePaintball() {
  paintMode = !paintMode;
  let crosshair = document.getElementById('crosshair');
  let colorPicker = document.getElementById('color-picker');

  if (paintMode) {
    if (!crosshair) {
      crosshair = document.createElement('div');
      crosshair.id = 'crosshair';
      crosshair.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:20px;height:20px;border:2px solid white;border-radius:50%;pointer-events:none;z-index:100;';
      document.body.appendChild(crosshair);
    } else {
      crosshair.style.display = 'block';
    }

    if (!colorPicker) {
      colorPicker = document.createElement('div');
      colorPicker.id = 'color-picker';
      colorPicker.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:100;';
      ['#ff3366', '#33ff66', '#3366ff', '#ffff33', '#ff6600', '#9933ff', '#00ffff', '#ffffff'].forEach(c => {
        const swatch = document.createElement('div');
        swatch.style.cssText = `width:30px;height:30px;background:${c};border-radius:50%;cursor:pointer;border:2px solid ${c === paintColor ? '#fff' : 'transparent'};`;
        swatch.onclick = () => {
          paintColor = c;
          document.querySelectorAll('#color-picker div').forEach(s => s.style.borderColor = 'transparent');
          swatch.style.borderColor = '#fff';
        };
        colorPicker.appendChild(swatch);
      });
      document.body.appendChild(colorPicker);
    } else {
      colorPicker.style.display = 'flex';
    }
    setS('Paintball ON!');
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
  src.y += 1.2;
  const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  firePaintball(src, dir);
}

function firePaintball(src, dir) {
  const geo = new THREE.SphereGeometry(0.15, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: paintColor });
  const ball = new THREE.Mesh(geo, mat);
  ball.position.copy(src);
  ball.userData = { vel: dir.clone().multiplyScalar(PAINT_SPEED), color: paintColor, life: 5 };
  scene.add(ball);
  paintBalls.push(ball);
}

function updatePaintballs(dt) {
  for (let i = paintBalls.length - 1; i >= 0; i--) {
    const b = paintBalls[i];
    b.userData.vel.y += PAINT_GRAVITY * dt;
    b.position.addScaledVector(b.userData.vel, dt);
    b.userData.life -= dt;

    // Check building collision
    const collision = checkBuildingCollision(b.position.x, b.position.z, 0.15);
    if (collision.hit || b.position.y < 0.1 || b.userData.life <= 0) {
      if (collision.hit || b.position.y < 0.1) {
        createSplat(b.position.clone(), new THREE.Vector3(0, 1, 0), b.userData.color);
      }
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
  splat.position.y = Math.max(0.05, pos.y);
  splat.rotation.x = -Math.PI / 2;
  scene.add(splat);
  paintSplats.push(splat);

  while (paintSplats.length > MAX_SPLATS) {
    scene.remove(paintSplats.shift());
  }
}

// ═══ MINIMAP ═══
function initMinimap() {
  const canvas = document.getElementById('minimap');
  if (canvas) minimapCtx = canvas.getContext('2d');
}

function drawMinimap() {
  if (!minimapCtx || !player) return;

  const canvas = minimapCtx.canvas;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const playerPos = player.userData.localPos;

  minimapCtx.fillStyle = 'rgba(10,15,20,0.9)';
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, cx, 0, Math.PI * 2);
  minimapCtx.fill();

  // Draw buildings
  minimapCtx.fillStyle = 'rgba(100,100,100,0.8)';
  buildings.forEach(b => {
    const bounds = b.userData.bounds;
    const bx = ((bounds.minX + bounds.maxX) / 2 - playerPos.x) / MINIMAP_SCALE;
    const bz = ((bounds.minZ + bounds.maxZ) / 2 - playerPos.z) / MINIMAP_SCALE;
    const bw = (bounds.maxX - bounds.minX) / MINIMAP_SCALE;
    const bh = (bounds.maxZ - bounds.minZ) / MINIMAP_SCALE;

    const rx = bx * Math.cos(-yaw) - bz * Math.sin(-yaw);
    const rz = bx * Math.sin(-yaw) + bz * Math.cos(-yaw);

    if (Math.abs(rx) < cx && Math.abs(rz) < cy) {
      minimapCtx.fillRect(cx + rx - bw/2, cy - rz - bh/2, bw, bh);
    }
  });

  // Draw vehicles
  vehicles.forEach(v => {
    const dx = (v.userData.localPos.x - playerPos.x) / MINIMAP_SCALE;
    const dz = (v.userData.localPos.z - playerPos.z) / MINIMAP_SCALE;
    const rx = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
    const rz = dx * Math.sin(-yaw) + dz * Math.cos(-yaw);

    if (Math.abs(rx) < cx && Math.abs(rz) < cy) {
      minimapCtx.fillStyle = v === activeVehicle ? '#00ffaa' : '#4488ff';
      minimapCtx.fillRect(cx + rx - 3, cy - rz - 2, 6, 4);
    }
  });

  // Player
  minimapCtx.fillStyle = '#00ff88';
  minimapCtx.beginPath();
  minimapCtx.moveTo(cx, cy - 8);
  minimapCtx.lineTo(cx - 5, cy + 5);
  minimapCtx.lineTo(cx + 5, cy + 5);
  minimapCtx.closePath();
  minimapCtx.fill();

  // Compass
  minimapCtx.strokeStyle = 'rgba(0,255,170,0.3)';
  minimapCtx.lineWidth = 2;
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, cx - 2, 0, Math.PI * 2);
  minimapCtx.stroke();

  const northAngle = -yaw - Math.PI / 2;
  const northX = cx + Math.cos(northAngle) * (cx - 8);
  const northY = cy + Math.sin(northAngle) * (cy - 8);
  minimapCtx.fillStyle = '#ff4444';
  minimapCtx.beginPath();
  minimapCtx.arc(northX, northY, 4, 0, Math.PI * 2);
  minimapCtx.fill();
}

function dropMarker() {
  if (!player) return;
  mapMarkers.push({ x: player.userData.localPos.x, z: player.userData.localPos.z, color: '#ff66aa' });
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
    hud.innerHTML = '<div>FUEL</div><div style="width:100px;height:8px;background:#333;border-radius:4px;"><div id="fuel-bar" style="height:100%;background:linear-gradient(90deg,#ff6600,#ffaa00);border-radius:4px;width:100%;"></div></div>';
    document.body.appendChild(hud);
  }

  if (jetpackActive || jetpackFuel < JETPACK_MAX_FUEL) {
    hud.style.display = 'block';
    document.getElementById('fuel-bar').style.width = (jetpackFuel / JETPACK_MAX_FUEL * 100) + '%';
  } else {
    hud.style.display = 'none';
  }
}

// ═══ CONTROLS ═══
function setupControls() {
  document.addEventListener('keydown', e => {
    if (e.code === 'KeyE') { if (activeVehicle) exitVehicle(); else enterNearestVehicle(); return; }
    if (e.code === 'KeyJ') { jetpackActive = !jetpackActive; setS(jetpackActive ? 'Jetpack ON!' : 'Jetpack OFF'); setTimeout(() => setS(''), 2000); return; }
    if (e.code === 'KeyP') { togglePaintball(); return; }
    if (e.code === 'KeyH') { document.getElementById('controls-key')?.classList.toggle('hidden'); return; }
    if (e.code === 'KeyM') { dropMarker(); return; }
    if (e.code === 'KeyC') { clearMarkers(); return; }

    switch (e.code) {
      case 'KeyW': case 'ArrowUp': mF = 1; break;
      case 'KeyS': case 'ArrowDown': mB = 1; break;
      case 'KeyA': case 'ArrowLeft': mL = 1; break;
      case 'KeyD': case 'ArrowRight': mR = 1; break;
      case 'ShiftLeft': case 'ShiftRight': sprinting = true; break;
      case 'Space': e.preventDefault(); if (!activeVehicle && onGround) { velY = JUMP; onGround = false; } break;
    }
  });

  document.addEventListener('keyup', e => {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': mF = 0; break;
      case 'KeyS': case 'ArrowDown': mB = 0; break;
      case 'KeyA': case 'ArrowLeft': mL = 0; break;
      case 'KeyD': case 'ArrowRight': mR = 0; break;
      case 'ShiftLeft': case 'ShiftRight': sprinting = false; break;
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
    pitch = Math.max(0.1, Math.min(1.4, pitch));
  });

  renderer.domElement.addEventListener('click', e => {
    if (paintMode) shootPaintball();
    else if (!isMobile) renderer.domElement.requestPointerLock();
  });

  if (isMobile) setupMobile();
}

function setupMobile() {
  document.getElementById('touch-controls').style.display = 'block';

  const menuBtn = document.getElementById('mobile-menu-btn');
  const menu = document.getElementById('mobile-menu');

  menuBtn?.addEventListener('touchstart', e => { e.preventDefault(); menu.classList.toggle('hidden'); });
  document.getElementById('mobile-menu-close')?.addEventListener('touchstart', e => { e.preventDefault(); menu.classList.add('hidden'); });
  document.getElementById('mm-jetpack')?.addEventListener('touchstart', e => { e.preventDefault(); jetpackActive = !jetpackActive; updateMobileMenuStatus(); });
  document.getElementById('mm-paintball')?.addEventListener('touchstart', e => { e.preventDefault(); togglePaintball(); updateMobileMenuStatus(); });
  document.getElementById('mm-sprint')?.addEventListener('touchstart', e => { e.preventDefault(); autoSprint = !autoSprint; updateMobileMenuStatus(); });
  document.getElementById('mm-car')?.addEventListener('touchstart', e => { e.preventDefault(); if (activeVehicle) exitVehicle(); else enterNearestVehicle(); menu.classList.add('hidden'); });
  document.getElementById('mm-marker')?.addEventListener('touchstart', e => { e.preventDefault(); dropMarker(); menu.classList.add('hidden'); });
  document.getElementById('mm-clear-markers')?.addEventListener('touchstart', e => { e.preventDefault(); clearMarkers(); menu.classList.add('hidden'); });

  // Joystick
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
        jC = { x: r.left + r.width/2, y: r.top + r.height/2 };
      }
    }
  }, { passive: false });

  jz.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === jTID) {
        let dx = t.clientX - jC.x, dy = t.clientY - jC.y;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d > JM) { dx = dx/d*JM; dy = dy/d*JM; }
        jk.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        joyVec.x = dx/JM;
        joyVec.y = dy/JM;
      }
    }
  }, { passive: false });

  const rj = e => { for (const t of e.changedTouches) if (t.identifier === jTID) { jTID = null; jk.style.transform = 'translate(-50%,-50%)'; joyVec = {x:0,y:0}; } };
  jz.addEventListener('touchend', rj, { passive: false });
  jz.addEventListener('touchcancel', rj, { passive: false });

  // Look zone
  const lz = document.getElementById('lz');
  let lx = 0, ly = 0;
  lz.addEventListener('touchstart', e => { e.preventDefault(); for (const t of e.changedTouches) if (lookTID === null) { lookTID = t.identifier; lx = t.clientX; ly = t.clientY; } }, { passive: false });
  lz.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === lookTID) {
        yaw -= (t.clientX - lx) * 0.005;
        pitch -= (t.clientY - ly) * 0.003;
        pitch = Math.max(0.1, Math.min(1.4, pitch));
        lx = t.clientX;
        ly = t.clientY;
      }
    }
  }, { passive: false });
  const rl = e => { for (const t of e.changedTouches) if (t.identifier === lookTID) lookTID = null; };
  lz.addEventListener('touchend', rl, { passive: false });
  lz.addEventListener('touchcancel', rl, { passive: false });

  updateMobileButtons();
}

function updateMobileButtons() {
  const ab = document.getElementById('action-btns');
  if (activeVehicle) {
    ab.innerHTML = '<div class="abtn yl" id="mb-gas">GAS</div><div class="abtn rd" id="mb-brake">BRK</div><div class="abtn" id="mb-exit">EXIT</div>';
    document.getElementById('mb-gas').addEventListener('touchstart', e => { e.preventDefault(); carAccelInput = 1; }, { passive: false });
    document.getElementById('mb-gas').addEventListener('touchend', () => { carAccelInput = 0; });
    document.getElementById('mb-brake').addEventListener('touchstart', e => { e.preventDefault(); carBrakeInput = 1; }, { passive: false });
    document.getElementById('mb-brake').addEventListener('touchend', () => { carBrakeInput = 0; });
    document.getElementById('mb-exit').addEventListener('touchstart', e => { e.preventDefault(); exitVehicle(); }, { passive: false });
  } else {
    ab.innerHTML = `<div class="abtn" id="mb-jump">JUMP</div>${paintMode ? '<div class="abtn yl" id="mb-shoot">FIRE</div>' : ''}`;
    document.getElementById('mb-jump')?.addEventListener('touchstart', e => { e.preventDefault(); if (onGround) { velY = JUMP; onGround = false; } }, { passive: false });
    document.getElementById('mb-shoot')?.addEventListener('touchstart', e => { e.preventDefault(); shootPaintball(); }, { passive: false });
  }
}

function updateMobileMenuStatus() {
  const js = document.getElementById('mm-jetpack-status');
  const ps = document.getElementById('mm-paintball-status');
  const ss = document.getElementById('mm-sprint-status');
  if (js) { js.textContent = jetpackActive ? 'ON' : 'OFF'; js.classList.toggle('on', jetpackActive); }
  if (ps) { ps.textContent = paintMode ? 'ON' : 'OFF'; ps.classList.toggle('on', paintMode); }
  if (ss) { ss.textContent = autoSprint ? 'ON' : 'OFF'; ss.classList.toggle('on', autoSprint); }
  if (isMobile && !activeVehicle) updateMobileButtons();
}

// ═══ VEHICLE ENTER/EXIT ═══
function enterNearestVehicle() {
  if (!player) return;
  const pPos = player.userData.localPos;
  let best = null, bestDist = 5;
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
  player.userData.localPos.x += 2.5;
  player.userData.localPos.y = 0.1;
  player.visible = true;
  velY = 0;
  activeVehicle = null;
  document.getElementById('speedometer').style.display = 'none';
  if (isMobile) updateMobileButtons();
}

// ═══ GAME LOOP ═══
function gameLoop() {
  requestAnimationFrame(gameLoop);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (activeVehicle) updateVehicle(dt);
  else updatePlayer(dt);

  updateWorldPositions();
  updateCamera();
  if (paintMode) updatePaintballs(dt);
  drawMinimap();

  renderer.render(scene, camera);
}

function updatePlayer(dt) {
  if (!player) return;

  let moveX = mR - mL;
  let moveZ = mF - mB;
  if (Math.abs(joyVec.x) > 0.1) moveX = joyVec.x;
  if (Math.abs(joyVec.y) > 0.1) moveZ = -joyVec.y;

  const speed = P_SPD * ((sprinting || autoSprint) ? SPRINT : 1);
  let dx = (Math.sin(yaw) * moveZ - Math.cos(yaw) * moveX) * speed * dt;
  let dz = (Math.cos(yaw) * moveZ + Math.sin(yaw) * moveX) * speed * dt;

  // Check collision before moving
  const newX = player.userData.localPos.x + dx;
  const newZ = player.userData.localPos.z + dz;

  const collision = checkBuildingCollision(newX, newZ, PLAYER_RADIUS);
  if (collision.hit) {
    // Push back from building
    const pushDist = PLAYER_RADIUS - collision.dist + 0.05;
    if (collision.dist > 0) {
      dx += (collision.pushX / collision.dist) * pushDist;
      dz += (collision.pushZ / collision.dist) * pushDist;
    }
  }

  player.userData.localPos.x += dx;
  player.userData.localPos.z += dz;

  // Jetpack physics
  if (jetpackActive && jetpackFuel > 0 && (sprinting || autoSprint)) {
    velY = 12;
    jetpackFuel -= dt;
    if (jetpackFuel < 0) jetpackFuel = 0;
    onGround = false;
    if (jetpackMesh) { jetpackMesh.flame1.visible = true; jetpackMesh.flame2.visible = true; }
  } else {
    velY += GRAV * dt;
    if (jetpackMesh) { jetpackMesh.flame1.visible = false; jetpackMesh.flame2.visible = false; }
  }

  player.userData.localPos.y += velY * dt;

  // Ground collision
  if (player.userData.localPos.y < 0.1) {
    player.userData.localPos.y = 0.1;
    velY = 0;
    onGround = true;
    if (jetpackFuel < JETPACK_MAX_FUEL) { jetpackFuel += dt * 0.5; if (jetpackFuel > JETPACK_MAX_FUEL) jetpackFuel = JETPACK_MAX_FUEL; }
  }

  updateJetpackHUD();

  // Camera follow
  const isMoving = Math.abs(moveZ) > 0.1 || Math.abs(moveX) > 0.1;
  if (isMoving) {
    const moveAngle = Math.atan2(dx, dz);
    let yawDiff = moveAngle - yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    yaw += yawDiff * 0.075;
  }

  // Animation
  const moveSpeed = Math.sqrt(dx*dx + dz*dz) / dt;
  if (isMoving && onGround && moveSpeed > 0.5) {
    const animSpeed = (sprinting || autoSprint) ? 18 : 12;
    player.userData.animTime += dt * animSpeed;
    const swing = Math.sin(player.userData.animTime) * 0.6;
    player.userData.leftLegPivot.rotation.x = swing;
    player.userData.rightLegPivot.rotation.x = -swing;
    player.userData.leftArmPivot.rotation.x = -swing * 0.8;
    player.userData.rightArmPivot.rotation.x = swing * 0.8;
  } else {
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
  if (br) { if (spd > 0) spd -= CAR_BRAKE * dt; else spd -= CAR_ACCEL * 0.4 * dt; }
  if (!ac && !br) spd *= (1 - CAR_FRICTION * dt);
  spd = Math.max(-CAR_MAX * 0.3, Math.min(CAR_MAX, spd));

  v.userData.angle += st * CAR_STEER * dt * Math.min(1, Math.abs(spd) / 5) * (spd >= 0 ? 1 : -1);

  // Move and check collision
  const newX = v.userData.localPos.x + Math.sin(v.userData.angle) * spd * dt;
  const newZ = v.userData.localPos.z + Math.cos(v.userData.angle) * spd * dt;

  const collision = checkBuildingCollision(newX, newZ, 2.5);
  if (collision.hit) {
    spd *= -0.3; // Bounce back
  } else {
    v.userData.localPos.x = newX;
    v.userData.localPos.z = newZ;
  }

  v.userData.localPos.y = 0.01;
  v.userData.speed = spd;

  document.getElementById('spd-val').textContent = Math.abs(spd * 2.237).toFixed(0);
  yaw = v.userData.angle + Math.PI;
}

function updateWorldPositions() {
  if (player && player.visible) {
    player.position.copy(player.userData.localPos);
    player.rotation.y = yaw;
  }
  for (const v of vehicles) {
    v.position.copy(v.userData.localPos);
    v.rotation.y = v.userData.angle;
  }
}

function updateCamera() {
  const target = activeVehicle || player;
  if (!target) return;

  const tgtLocal = target.userData.localPos;
  const camPos = new THREE.Vector3(
    tgtLocal.x - Math.sin(yaw) * CAM_DIST,
    tgtLocal.y + CAM_HEIGHT + Math.sin(pitch) * CAM_DIST * 0.5,
    tgtLocal.z - Math.cos(yaw) * CAM_DIST
  );

  camera.position.lerp(camPos, 0.12);
  camera.lookAt(new THREE.Vector3(tgtLocal.x, tgtLocal.y + 1.0, tgtLocal.z));
}

// ═══ START GAME ═══
async function startGame() {
  try {
    setS('Initializing...');
    setP(10);

    initThree();
    createGround();

    await loadOSMData();

    setS('Creating player...');
    setP(85);

    createPlayer();
    createJetpackMesh();

    spawnPoint = { x: 0, z: 0 };
    initMinimap();

    // Spawn vehicles on roads (or nearby)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const dist = 20 + Math.random() * 30;
      vehicles.push(createVehicle(Math.cos(angle) * dist, Math.sin(angle) * dist));
    }

    setupControls();

    setS('Ready! Explore the city.');
    setP(100);

    document.getElementById('launch').style.display = 'none';
    document.getElementById('gc').style.display = 'block';
    document.getElementById('hud').style.display = 'block';
    document.getElementById('hn').textContent = locName;
    document.getElementById('attribution').textContent = '© OpenStreetMap contributors';

    gameLoop();

  } catch (e) {
    console.error('Start error:', e);
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
  } catch (e) { setS(e.message, true); }
});

document.getElementById('gps-btn').addEventListener('click', () => {
  if (!navigator.geolocation) { setS('GPS not available', true); return; }
  setS('Getting location...');
  navigator.geolocation.getCurrentPosition(
    pos => { cLat = pos.coords.latitude; cLon = pos.coords.longitude; locName = 'Your Location'; startGame(); },
    err => setS('GPS error: ' + err.message, true),
    { enableHighAccuracy: true }
  );
});

document.getElementById('li').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('go-btn').click(); });
