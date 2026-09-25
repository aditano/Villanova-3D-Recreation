import * as THREE from 'three';

function canvasTexture(canvas, { repeat = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 8;
  return tex;
}

/** One storey of a maquette facade: pier, two windows, a floor line. Grayscale so material.color tints it. */
export function createFacadeTextures() {
  const w = 128;
  const h = 128;
  const wall = document.createElement('canvas');
  wall.width = w;
  wall.height = h;
  const g = wall.getContext('2d');
  g.fillStyle = '#e6e1d8';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#cfc8bc';
  g.fillRect(0, h - 8, w, 8);
  g.fillStyle = '#d5cfc4';
  g.fillRect(6, 0, 5, h);
  g.fillRect(w - 11, 0, 5, h);

  const glow = document.createElement('canvas');
  glow.width = w;
  glow.height = h;
  const e = glow.getContext('2d');
  e.fillStyle = '#000';
  e.fillRect(0, 0, w, h);

  const windows = [
    [22, 28, 36, 62],
    [70, 28, 36, 62],
  ];
  for (const [x, y, ww, hh] of windows) {
g.fillStyle = '#1c2228';
  g.fillRect(x, y, ww, hh);
  g.fillStyle = '#2a3138';
    g.fillRect(x + 3, y + 3, ww - 6, hh * 0.42);
    e.fillStyle = '#ffd8a8';
    e.fillRect(x + 2, y + 2, ww - 4, hh - 4);
  }

  const stripes = document.createElement('canvas');
  stripes.width = 64;
  stripes.height = 32;
  const s = stripes.getContext('2d');
  s.fillStyle = '#3d6844';
  s.fillRect(0, 0, 64, 32);
  s.fillStyle = '#4a7850';
  s.fillRect(0, 0, 32, 32);

  return {
    map: canvasTexture(wall, { repeat: true }),
    emissiveMap: canvasTexture(glow, { repeat: true }),
    pitchMap: canvasTexture(stripes, { repeat: true }),
  };
}

const FAMILY = {
  limestone: { color: 0xd8d2c6, roughness: 0.84 },
  stone: { color: 0xc3bcb1, roughness: 0.88 },
  brick: { color: 0x8a6256, roughness: 0.92 },
  concrete: { color: 0xa8a69f, roughness: 0.94 },
  arena: { color: 0x747980, roughness: 0.8, metalness: 0.06 },
  station: { color: 0xb6a48c, roughness: 0.86 },
};

export function createMaterials(textures) {
  const families = {};
  const facadeList = [];
  for (const [name, spec] of Object.entries(FAMILY)) {
    const mat = new THREE.MeshStandardMaterial({
      color: spec.color,
      map: textures.map,
      emissive: new THREE.Color(0xffe1b8),
      emissiveMap: textures.emissiveMap,
      emissiveIntensity: 0.045,
      roughness: spec.roughness,
      metalness: spec.metalness ?? 0.02,
    });
    families[name] = mat;
    facadeList.push(mat);
  }

  return {
    families,
    facadeList,
    roof: new THREE.MeshStandardMaterial({ color: 0x2a2e32, roughness: 0.96, metalness: 0.04, side: THREE.DoubleSide }),
    road: new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.93 }),
    path: new THREE.MeshStandardMaterial({ color: 0x3c3832, roughness: 0.96 }),
    plaza: new THREE.MeshStandardMaterial({ color: 0x34322e, roughness: 0.9 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x262320, roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 0.42, metalness: 0.62 }),
    water: new THREE.MeshStandardMaterial({
      color: 0x24343c,
      roughness: 0.22,
      metalness: 0.12,
      transparent: true,
      opacity: 0.9,
    }),
    pitch: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.pitchMap,
      roughness: 0.92,
    }),
    spire: new THREE.MeshStandardMaterial({ color: 0xe4ddd2, roughness: 0.72 }),
    terrain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }),
  };
}
