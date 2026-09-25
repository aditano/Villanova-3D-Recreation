import * as THREE from 'three';

function canvasTexture(canvas, { repeat = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 8;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/** One storey, about 4.6 m wide, painted in real color so families do not share one gray tint. */
function facade(paint) {
  const wall = makeCanvas(256, 192);
  const glow = makeCanvas(256, 192);
  const g = wall.getContext('2d');
  const e = glow.getContext('2d');
  e.fillStyle = '#000';
  e.fillRect(0, 0, 256, 192);
  paint(g, e);
  return { map: canvasTexture(wall), emissiveMap: canvasTexture(glow) };
}

function windowRect(g, e, x, y, w, h, { frame, glass, lit = '#ffd7a4', arch = 0 }) {
  g.fillStyle = frame;
  g.fillRect(x - 3, y - 3, w + 6, h + 6 + arch);
  if (arch) {
    g.beginPath();
    g.moveTo(x - 3, y);
    g.quadraticCurveTo(x + w / 2, y - arch - 8, x + w + 3, y);
    g.fill();
  }
  g.fillStyle = glass;
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(x + 2, y + 2, w * 0.38, h * 0.42);
  e.fillStyle = lit;
  e.fillRect(x + 1, y + 1, w - 2, h - 2);
  if (arch) {
    e.beginPath();
    e.moveTo(x, y);
    e.quadraticCurveTo(x + w / 2, y - arch, x + w, y);
    e.fill();
  }
}

function gothicPaint(g) {
  g.fillStyle = '#e6ded0';
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#d4cbb8';
  for (let y = 0; y < 192; y += 24) g.fillRect(0, y, 256, 2);
  for (let x = 0; x < 256; x += 48) g.fillRect(x, 0, 2, 192);
  return (e) => {
    windowRect(g, e, 28, 36, 42, 108, { frame: '#cfc4b0', glass: '#243038', arch: 28 });
    windowRect(g, e, 108, 36, 42, 108, { frame: '#cfc4b0', glass: '#243038', arch: 28 });
    windowRect(g, e, 186, 36, 42, 108, { frame: '#cfc4b0', glass: '#243038', arch: 28 });
  };
}

function stonePaint(g, e) {
  g.fillStyle = '#d9d2c4';
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#c9c0af';
  for (let y = 18; y < 192; y += 28) g.fillRect(0, y, 256, 2);
  g.fillStyle = '#c3b9a8';
  g.fillRect(0, 176, 256, 16);
  windowRect(g, e, 22, 40, 48, 96, { frame: '#eee7db', glass: '#2a3340' });
  windowRect(g, e, 104, 40, 48, 96, { frame: '#eee7db', glass: '#2a3340' });
  windowRect(g, e, 186, 40, 48, 96, { frame: '#eee7db', glass: '#2a3340' });
}

function libraryPaint(g, e) {
  g.fillStyle = '#e3d9c8';
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#b7aa96';
  g.fillRect(0, 0, 256, 14);
  g.fillRect(0, 168, 256, 24);
  windowRect(g, e, 16, 32, 96, 120, { frame: '#f3ece2', glass: '#314155' });
  windowRect(g, e, 142, 32, 96, 120, { frame: '#f3ece2', glass: '#314155' });
  g.fillStyle = '#f7f1e8';
  g.fillRect(108, 24, 12, 150);
}

function brickPaint(g, e) {
  g.fillStyle = '#8d4638';
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#f0e6da';
  for (let y = 0; y < 192; y += 12) {
    g.fillRect(0, y, 256, 2);
    const shift = (y / 12) % 2 ? 16 : 0;
    for (let x = -16 + shift; x < 256; x += 32) g.fillRect(x, y, 2, 12);
  }
  windowRect(g, e, 24, 34, 40, 78, { frame: '#f4efe8', glass: '#1c2832' });
  windowRect(g, e, 108, 34, 40, 78, { frame: '#f4efe8', glass: '#1c2832' });
  windowRect(g, e, 190, 34, 40, 78, { frame: '#f4efe8', glass: '#1c2832' });
  g.fillStyle = '#f4efe8';
  g.fillRect(0, 168, 256, 10);
}

function centerPaint(g, e) {
  g.fillStyle = '#c6b59a';
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#b7a488';
  g.fillRect(0, 150, 256, 42);
  windowRect(g, e, 18, 28, 64, 100, { frame: '#efe6d6', glass: '#31404a' });
  windowRect(g, e, 96, 28, 64, 100, { frame: '#efe6d6', glass: '#31404a' });
  windowRect(g, e, 174, 28, 64, 100, { frame: '#efe6d6', glass: '#31404a' });
}

function glassPaint(g, e) {
  g.fillStyle = '#8fb4cc';
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#d5e2ea';
  for (let x = 0; x <= 256; x += 32) g.fillRect(x, 0, 3, 192);
  for (let y = 0; y <= 192; y += 48) g.fillRect(0, y, 256, 4);
  g.fillStyle = '#5e8eac';
  for (let x = 6; x < 256; x += 32) {
    for (let y = 8; y < 192; y += 48) g.fillRect(x, y, 22, 32);
  }
  e.fillStyle = '#d7ecff';
  for (let x = 8; x < 256; x += 32) {
    for (let y = 10; y < 180; y += 48) e.fillRect(x, y, 18, 26);
  }
}

function arenaPaint(g, e) {
  g.fillStyle = '#3e4650';
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#2c333b';
  for (let y = 0; y < 192; y += 28) g.fillRect(0, y, 256, 3);
  g.fillStyle = '#0c2340';
  g.fillRect(0, 78, 256, 22);
  g.fillStyle = '#f2f5f8';
  g.fillRect(0, 100, 256, 4);
  windowRect(g, e, 20, 28, 70, 36, { frame: '#9aa3ad', glass: '#1a222c', lit: '#ffe1b0' });
  windowRect(g, e, 150, 28, 70, 36, { frame: '#9aa3ad', glass: '#1a222c', lit: '#ffe1b0' });
  windowRect(g, e, 40, 120, 50, 28, { frame: '#9aa3ad', glass: '#141a22' });
  windowRect(g, e, 160, 120, 50, 28, { frame: '#9aa3ad', glass: '#141a22' });
}

function concretePaint(g, e) {
  g.fillStyle = '#b9b7b0';
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#a8a69f';
  for (let y = 0; y < 192; y += 16) g.fillRect(0, y, 256, 1);
  windowRect(g, e, 12, 48, 232, 36, { frame: '#d9d7d1', glass: '#2c343c' });
  windowRect(g, e, 12, 112, 232, 36, { frame: '#d9d7d1', glass: '#2c343c' });
}

function stationPaint(g, e) {
  g.fillStyle = '#d2b48a';
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#8d5a3c';
  for (let y = 0; y < 192; y += 14) g.fillRect(0, y, 256, 2);
  g.fillStyle = '#6b442c';
  g.fillRect(0, 0, 256, 16);
  windowRect(g, e, 22, 40, 44, 90, { frame: '#f3e6d0', glass: '#243028' });
  windowRect(g, e, 106, 40, 44, 90, { frame: '#f3e6d0', glass: '#243028' });
  windowRect(g, e, 188, 40, 44, 90, { frame: '#f3e6d0', glass: '#243028' });
}

function seatingPaint(g) {
  const bands = ['#0c2340', '#f7f8fb', '#0c2340', '#f7f8fb'];
  bands.forEach((color, i) => {
    g.fillStyle = color;
    g.fillRect(0, i * 48, 128, 48);
  });
}

function fieldPaint(g) {
  g.fillStyle = '#2f9a3c';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#38a846';
  for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 16, 256);
  g.strokeStyle = '#f7f7f2';
  g.lineWidth = 3;
  for (let y = 16; y < 256; y += 28) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
}

function grassPaint(g) {
  g.fillStyle = '#2c8d38';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#37a044';
  for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 128, 8);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 40; i++) g.fillRect((i * 37) % 128, (i * 19) % 128, 2, 2);
}

const PAINTERS = {
  gothic: (g, e) => gothicPaint(g)(e),
  limestone: (g, e) => gothicPaint(g)(e),
  stone: stonePaint,
  library: libraryPaint,
  brick: brickPaint,
  center: centerPaint,
  glass: glassPaint,
  arena: arenaPaint,
  concrete: concretePaint,
  station: stationPaint,
};

export function createFacadeTextures() {
  const families = {};
  for (const [name, paint] of Object.entries(PAINTERS)) families[name] = facade(paint);
  const seats = makeCanvas(128, 192);
  seatingPaint(seats.getContext('2d'));
  const field = makeCanvas(256, 256);
  fieldPaint(field.getContext('2d'));
  const lawn = makeCanvas(128, 128);
  grassPaint(lawn.getContext('2d'));
  return {
    families,
    seating: canvasTexture(seats),
    field: canvasTexture(field),
    lawn: canvasTexture(lawn),
  };
}

function facadeMaterial(textures) {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.map,
    emissive: new THREE.Color(0xffcc88),
    emissiveMap: textures.emissiveMap,
    emissiveIntensity: 0.035,
    roughness: 0.86,
    metalness: 0.02,
  });
}

export function createMaterials(textures) {
  const families = {};
  const facadeList = [];
  for (const [name, maps] of Object.entries(textures.families)) {
    const mat = facadeMaterial(maps);
    if (name === 'glass') {
      mat.roughness = 0.28;
      mat.metalness = 0.18;
    } else if (name === 'arena') {
      mat.roughness = 0.62;
      mat.metalness = 0.14;
    } else if (name === 'brick') {
      mat.roughness = 0.93;
    }
    families[name] = mat;
    facadeList.push(mat);
  }

  return {
    families,
    facadeList,
    roof: new THREE.MeshStandardMaterial({ color: 0x3a342e, roughness: 0.94, metalness: 0.04 }),
    roofLight: new THREE.MeshStandardMaterial({ color: 0xd9d3c7, roughness: 0.78 }),
    road: new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.92 }),
    marking: new THREE.MeshStandardMaterial({ color: 0xe6d48a, roughness: 0.7 }),
    path: new THREE.MeshStandardMaterial({ color: 0xcbbfa8, roughness: 0.94 }),
    plaza: new THREE.MeshStandardMaterial({ color: 0xb7b1a6, roughness: 0.9 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x5a5348, roughness: 0.95 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb7bcc2, roughness: 0.38, metalness: 0.7 }),
    water: new THREE.MeshStandardMaterial({
      color: 0x3d7ea4,
      roughness: 0.18,
      metalness: 0.08,
      transparent: true,
      opacity: 0.88,
    }),
    pitch: new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.field, roughness: 0.9 }),
    lawn: new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.lawn, roughness: 0.96 }),
    seating: new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.seating, roughness: 0.78 }),
    lamp: new THREE.MeshStandardMaterial({
      color: 0xfff4d2,
      emissive: 0xffe2a8,
      emissiveIntensity: 0.85,
      roughness: 0.4,
    }),
    spire: new THREE.MeshStandardMaterial({ color: 0xf3eee6, roughness: 0.7 }),
    navy: new THREE.MeshStandardMaterial({ color: 0x0c2340, roughness: 0.55, metalness: 0.08 }),
    bridge: new THREE.MeshStandardMaterial({ color: 0x8d9294, roughness: 0.7, metalness: 0.2 }),
    terrain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }),
  };
}
