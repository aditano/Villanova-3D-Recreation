import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildCampus } from './campus.js';
import { makeTerrain, pointInPoly } from './geo.js';
import { createFacadeTextures, createMaterials } from './materials.js';

const canvas = document.getElementById('c');
const loader = document.getElementById('loader');
const layersEl = document.getElementById('layers');
const clockEl = document.getElementById('clock');
const timeInput = document.getElementById('time');
const nav = document.getElementById('nav');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 800 ? 1.25 : 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = 'label-layer';
document.getElementById('app').appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc5c9c4, 0.00042);
scene.background = new THREE.Color(0xc5c9c4);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.35, 5000);
camera.position.set(40, 420, 380);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.06;
controls.minDistance = 6;
controls.maxDistance = 2200;
controls.target.set(0, 8, 0);

const hemi = new THREE.HemisphereLight(0xd5ddd8, 0x2a2620, 0.72);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3e4, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(window.innerWidth < 800 ? 1024 : 2048, window.innerWidth < 800 ? 1024 : 2048);
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 2200;
sun.shadow.camera.left = -900;
sun.shadow.camera.right = 900;
sun.shadow.camera.top = 900;
sun.shadow.camera.bottom = -900;
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

const sunDir = new THREE.Vector3();
const dayZenith = new THREE.Color(0x8b9bab);
const dayHorizon = new THREE.Color(0xd7dbd6);
const nightZenith = new THREE.Color(0x070b12);
const nightHorizon = new THREE.Color(0x1a2230);
const warm = new THREE.Color(0xffb57a);
const sunNoon = new THREE.Color(0xfff6ea);

const sky = createSky();
scene.add(sky.mesh);

let hour = 16.8;
let walking = false;
let rotating = false;
let fly = null;
let campus = null;
let blockers = [];
let terrainY = () => 0;

const walkState = {
  yaw: 0.2,
  pitch: -0.05,
  keys: new Set(),
  dragging: false,
  lx: 0,
  ly: 0,
};

function createSky() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0.35, 0.55, 0.25).normalize() },
    uHorizon: { value: dayHorizon.clone() },
    uZenith: { value: dayZenith.clone() },
    uGlow: { value: new THREE.Color(0xffe0bf) },
    uDay: { value: 1 },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
  };
  const mat = new THREE.ShaderMaterial({
    depthTest: true,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: `
      varying vec2 vNdc;
      void main() {
        vNdc = position.xy;
        gl_Position = vec4(position.xy, 0.9999, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDir;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uGlow;
      uniform float uDay;
      uniform mat4 uInvProj;
      uniform mat4 uCamWorld;
      varying vec2 vNdc;
      void main() {
        vec4 far = uInvProj * vec4(vNdc, 1.0, 1.0);
        vec3 dir = normalize(mat3(uCamWorld) * (far.xyz / far.w));
        float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.85));
        float sun = pow(max(dot(dir, uSunDir), 0.0), 90.0);
        col += uGlow * sun * (0.25 + 0.45 * uDay);
        float stars = step(0.9975, fract(sin(dot(floor(dir * 700.0), vec3(12.9, 78.2, 37.7))) * 43758.5));
        col += vec3(0.85) * stars * smoothstep(0.45, 0.8, h) * (1.0 - uDay);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.onBeforeRender = (_r, _s, cam) => {
    uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
    uniforms.uCamWorld.value.copy(cam.matrixWorld);
  };
  return { mesh, uniforms };
}

function applyHour(next) {
  hour = (next + 24) % 24;
  const angle = ((hour - 6) / 24) * Math.PI * 2;
  const elevation = Math.sin(angle);
  const day = THREE.MathUtils.smoothstep(elevation, -0.2, 0.32);
  const night = 1 - day;
  const sunset = Math.max(0, 1 - Math.abs(elevation) / 0.38) * (0.35 + 0.65 * day);
  sunDir.set(Math.cos(angle), Math.max(0.08, elevation), 0.42).normalize();
  const anchor = walking ? camera.position : controls.target;
  sun.position.copy(anchor).addScaledVector(sunDir, 900);
  sun.target.position.copy(anchor);
  sun.intensity = 0.06 + 3.35 * day;
  sun.color.copy(warm).lerp(sunNoon, 1 - sunset);
  hemi.intensity = 0.08 + 0.38 * day;
  hemi.color.copy(nightHorizon).lerp(dayHorizon, day);
  sky.uniforms.uSunDir.value.copy(sunDir);
  sky.uniforms.uDay.value = day;
  sky.uniforms.uZenith.value.copy(nightZenith).lerp(dayZenith, day);
  sky.uniforms.uHorizon.value.copy(nightHorizon).lerp(dayHorizon, day);
  sky.uniforms.uHorizon.value.lerp(warm, sunset * 0.45);
  sky.uniforms.uGlow.value.copy(warm);
  scene.fog.color.copy(sky.uniforms.uHorizon.value);
  scene.background.copy(scene.fog.color);
  if (campus?.facades) {
    for (const mat of campus.facades) mat.emissiveIntensity = 0.04 + night * 0.9;
  }
  const h = Math.floor(hour);
  const m = Math.floor((hour % 1) * 60);
  clockEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  if (document.activeElement !== timeInput) timeInput.value = String(hour);
  const dayBtn = document.getElementById('day');
  const nightBtn = document.getElementById('night');
  dayBtn.setAttribute('aria-pressed', day > 0.55 ? 'true' : 'false');
  nightBtn.setAttribute('aria-pressed', day < 0.35 ? 'true' : 'false');
}

function landmarkMap(data) {
  const map = new Map();
  for (const lm of data.landmarks || []) map.set(lm.id, lm);
  return map;
}

function coreBounds(landmarks) {
  const ids = ['church', 'quad', 'falvey', 'connelly', 'bartley', 'stadium', 'pavilion', 'station', 'law', 'garey', 'mendel', 'tolentine', 'alumni'];
  const pts = landmarks.filter((l) => ids.includes(l.id));
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return {
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    span: Math.max(maxX - minX, maxZ - minZ, 400),
  };
}

function viewsFor(data) {
  const byId = landmarkMap(data);
  const core = coreBounds(data.landmarks || []);
  const y = (lm) => terrainY(lm.x, lm.z);
  const place = (lm, dist, height, bearing, aim = 8) => {
    if (!lm) return null;
    const ground = y(lm);
    return {
      pos: [lm.x + Math.sin(bearing) * dist, ground + height, lm.z + Math.cos(bearing) * dist],
      target: [lm.x, ground + aim, lm.z],
    };
  };
  const church = byId.get('church');
  const quad = byId.get('quad');
  const aerial = {
    pos: [core.cx - core.span * 0.08, core.span * 0.38, core.cz + core.span * 0.58],
    target: [core.cx, 16, core.cz - core.span * 0.04],
  };
  return {
    aerial,
    quad: quad && church
      ? {
          pos: [quad.x + 20, y(quad) + 48, quad.z + 95],
          target: [church.x, y(church) + 12, church.z],
        }
      : place(quad, 90, 46, 0.3, 4),
    church: place(church, 52, 18, 0.02, 11),
    stadium: place(byId.get('stadium'), 130, 32, 1.15, 8),
    library: place(byId.get('falvey'), 52, 18, 1.15, 7),
    station: place(byId.get('station'), 55, 16, 0.2, 4),
    rotate: aerial,
  };
}

function setActive(name) {
  for (const btn of nav.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.view === name);
  }
}

function flyTo(view, { animate = true } = {}) {
  if (!view) return Promise.resolve();
  rotating = false;
  controls.autoRotate = false;
  if (!animate) {
    camera.position.set(...view.pos);
    controls.target.set(...view.target);
    controls.update();
    fly = null;
    return Promise.resolve();
  }
  const fromP = camera.position.clone();
  const fromT = controls.target.clone();
  const toP = new THREE.Vector3(...view.pos);
  const toT = new THREE.Vector3(...view.target);
  const t0 = performance.now();
  return new Promise((resolve) => {
    fly = { fromP, fromT, toP, toT, t0, ms: 1200, resolve };
  });
}

function go(name, animate = true) {
  if (!campus) return Promise.resolve();
  if (walking) setWalk(false);
  if (name === 'rotate') {
    setActive('rotate');
    return flyTo(campus.views.aerial, { animate }).then(() => {
      rotating = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.45;
    });
  }
  const view = campus.views[name];
  if (!view) return Promise.resolve();
  setActive(name);
  return flyTo(view, { animate });
}

function makeLabel(lm) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pin';
  const sub = lm.sub && lm.sub.length <= 12 ? `<span class="pin-sub">${lm.sub}</span>` : '';
  btn.innerHTML = `<span class="pin-tick"></span><span class="pin-name">${lm.label}</span>${sub}`;
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const preset = lm.preset || (lm.id === 'falvey' ? 'library' : null);
    if (preset && campus.views[preset]) go(preset);
    else {
      const ground = terrainY(lm.x, lm.z);
      flyTo({
        pos: [lm.x + 40, ground + 28, lm.z + 70],
        target: [lm.x, ground + Math.min(lm.h * 0.4, 12), lm.z],
      });
      setActive('');
    }
  });
  const obj = new CSS2DObject(btn);
  const ground = terrainY(lm.x, lm.z);
  const lift = lm.id === 'church' ? Math.max(lm.h, 30) + 8 : Math.max(lm.h, 6) + 7;
  obj.position.set(lm.x, ground + lift, lm.z);
  obj.center.set(0.5, 1);
  return obj;
}

function blocked(x, z) {
  for (const b of blockers) {
    if (pointInPoly(x, z, b.f)) return true;
  }
  return false;
}

function setWalk(on) {
  walking = on;
  document.getElementById('walk').setAttribute('aria-pressed', on ? 'true' : 'false');
  document.getElementById('walk-help').classList.toggle('show', on);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  document.getElementById('walk-pad').classList.toggle('show', on && coarse);
  controls.enabled = !on;
  controls.autoRotate = !on && rotating;
  if (on) {
    const ground = terrainY(controls.target.x, controls.target.z);
    camera.position.set(controls.target.x, ground + 1.68, controls.target.z + 0.01);
    walkState.yaw = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    walkState.pitch = -0.04;
  }
}

function updateWalk(dt) {
  const speed = (walkState.keys.has('ShiftLeft') || walkState.keys.has('ShiftRight') ? 12 : 5.5) * dt;
  const sin = Math.sin(walkState.yaw);
  const cos = Math.cos(walkState.yaw);
  let mx = 0;
  let mz = 0;
  if (walkState.keys.has('KeyW') || walkState.keys.has('ArrowUp')) {
    mx -= sin;
    mz -= cos;
  }
  if (walkState.keys.has('KeyS') || walkState.keys.has('ArrowDown')) {
    mx += sin;
    mz += cos;
  }
  if (walkState.keys.has('KeyA') || walkState.keys.has('ArrowLeft')) {
    mx -= cos;
    mz += sin;
  }
  if (walkState.keys.has('KeyD') || walkState.keys.has('ArrowRight')) {
    mx += cos;
    mz -= sin;
  }
  const len = Math.hypot(mx, mz);
  if (len > 0 && speed > 0) {
    const nx = camera.position.x + (mx / len) * speed;
    const nz = camera.position.z + (mz / len) * speed;
    if (!blocked(nx, nz)) {
      camera.position.x = nx;
      camera.position.z = nz;
    }
  }
  camera.position.y = terrainY(camera.position.x, camera.position.z) + 1.68;
  const look = walkState.pitch;
  const cp = Math.cos(look);
  camera.lookAt(
    camera.position.x - Math.sin(walkState.yaw) * cp,
    camera.position.y + Math.sin(look),
    camera.position.z - Math.cos(walkState.yaw) * cp,
  );
}

function onKey(ev, down) {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(ev.code)) {
    if (down) walkState.keys.add(ev.code);
    else walkState.keys.delete(ev.code);
    if (walking) ev.preventDefault();
  }
  if (down && ev.code === 'Escape' && walking) setWalk(false);
}

window.addEventListener('keydown', (ev) => onKey(ev, true));
window.addEventListener('keyup', (ev) => onKey(ev, false));

canvas.addEventListener('pointerdown', (ev) => {
  if (!walking) return;
  walkState.dragging = true;
  walkState.lx = ev.clientX;
  walkState.ly = ev.clientY;
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', (ev) => {
  if (!walking || !walkState.dragging) return;
  const dx = ev.clientX - walkState.lx;
  const dy = ev.clientY - walkState.ly;
  walkState.lx = ev.clientX;
  walkState.ly = ev.clientY;
  walkState.yaw -= dx * 0.005;
  walkState.pitch = Math.max(-0.9, Math.min(0.7, walkState.pitch - dy * 0.004));
});
const endDrag = () => {
  walkState.dragging = false;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

for (const btn of document.querySelectorAll('#walk-pad button')) {
  const code = btn.dataset.key;
  const press = (on) => {
    if (on) walkState.keys.add(code);
    else walkState.keys.delete(code);
  };
  btn.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    press(true);
  });
  btn.addEventListener('pointerup', () => press(false));
  btn.addEventListener('pointerleave', () => press(false));
  btn.addEventListener('pointercancel', () => press(false));
}

nav.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button');
  if (!btn || btn.disabled) return;
  go(btn.dataset.view);
});

timeInput.addEventListener('input', () => {
  applyHour(Number(timeInput.value));
});
document.getElementById('day').addEventListener('click', () => applyHour(15.5));
document.getElementById('night').addEventListener('click', () => applyHour(21.2));
document.getElementById('walk').addEventListener('click', () => setWalk(!walking));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  if (fly) {
    const t = Math.min(1, (performance.now() - fly.t0) / fly.ms);
    const e = t * t * (3 - 2 * t);
    camera.position.lerpVectors(fly.fromP, fly.toP, e);
    controls.target.lerpVectors(fly.fromT, fly.toT, e);
    if (t >= 1) {
      const done = fly.resolve;
      fly = null;
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = true;
      done();
    }
  } else if (!walking) controls.update();
  else updateWalk(dt);
  applyHour(hour);
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

async function main() {
  applyHour(hour);
  animate();
  const res = await fetch(`${import.meta.env.BASE_URL}data/villanova.json`);
  if (!res.ok) throw new Error(`campus data ${res.status}`);
  const data = await res.json();
  terrainY = makeTerrain(data.terrain);
  const materials = createMaterials(createFacadeTextures());
  const built = buildCampus(data, terrainY, materials);
  scene.add(built.group);
  blockers = built.blockers;
  const views = viewsFor(data);
  campus = { views, facades: materials.facadeList, data };
  for (const lm of data.landmarks || []) {
    if (!lm.label) continue;
    scene.add(makeLabel(lm));
  }
  const presetIds = { quad: 'quad', church: 'church', stadium: 'stadium', library: 'falvey', station: 'station' };
  for (const btn of nav.querySelectorAll('button')) {
    const id = presetIds[btn.dataset.view];
    if (id && !views[btn.dataset.view]) btn.disabled = true;
  }
  const heightTagged = (data.buildings || []).filter((b) => b.hs === 'height' || b.hs === 'levels').length;
  layersEl.textContent = `${data.buildings.length} buildings · ${data.roads.length} roads · ${data.paths.length} paths · ${heightTagged} tagged heights`;
  const initial = new URLSearchParams(location.search).get('view') || 'aerial';
  await go(campus.views[initial] ? initial : 'aerial', false);
  loader.classList.add('hidden');
  document.body.dataset.ready = '1';
  window.__campus = {
    ready: true,
    setView: (name) => go(name, false),
  };
}

main().catch((err) => {
  console.error(err);
  window.__campusError = String(err?.stack || err);
  loader.querySelector('.eyebrow').textContent = 'Could not load the campus model';
});
