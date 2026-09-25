import * as THREE from 'three';
import { pointInPoly } from './geo.js';
import { corridorHalf, roadProfile } from './road-profile.js';

function hash2(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function noise2(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0);
  const b = hash2(x0 + 1, z0);
  const c = hash2(x0, z0 + 1);
  const d = hash2(x0 + 1, z0 + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function sampleWear(wear, x, z) {
  const u = (x - wear.minX) / wear.spanX;
  const v = (z - wear.minZ) / wear.spanZ;
  const px = Math.max(0, Math.min(wear.size - 1, Math.round(u * (wear.size - 1))));
  const py = Math.max(0, Math.min(wear.size - 1, Math.round(v * (wear.size - 1))));
  const i = (py * wear.size + px) * 4;
  return {
    pavement: wear.pixels[i] / 255,
    path: wear.pixels[i + 1] / 255,
    ao: wear.pixels[i + 2] / 255,
    flat: wear.pixels[i + 3] / 255,
  };
}

/** Mottling only. The material color is the saturated green, so a missing bind cannot turn the lawn blue. */
function grassMaps() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f2f6ee';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1600; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const rx = 10 + Math.random() * 42;
    const ry = rx * (0.45 + Math.random() * 0.7);
    const g = 150 + Math.floor(Math.random() * 90);
    const r = 90 + Math.floor(Math.random() * 50);
    ctx.fillStyle = `rgba(${r},${g},${70 + Math.floor(Math.random() * 40)},${0.18 + Math.random() * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(${150 + Math.floor(Math.random() * 50)},${120 + Math.floor(Math.random() * 30)},${60},${0.15 + Math.random() * 0.25})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 6, 2 + Math.random() * 4);
  }
  ctx.strokeStyle = 'rgba(40,90,36,0.45)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 2800; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 5 - Math.random() * 8);
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;

  const ncan = document.createElement('canvas');
  ncan.width = 256;
  ncan.height = 256;
  const nctx = ncan.getContext('2d');
  const img = nctx.createImageData(256, 256);
  const h = (nx, ny) => Math.sin(nx * 0.71) * Math.cos(ny * 0.53) * 0.6 + Math.sin(nx * 3.1 + ny * 2.2) * 0.4;
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const i = (y * 256 + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, 128 - dx * 42));
      img.data[i + 1] = Math.max(0, Math.min(255, 128 - dy * 42));
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  nctx.putImageData(img, 0, 0);
  const normalMap = new THREE.CanvasTexture(ncan);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  return { map, normalMap };
}

function openRing(ring) {
  if (!ring?.length) return [];
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) return ring.slice(0, -1);
  return ring.slice();
}

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function stamp(data, size, minX, minZ, spanX, spanZ, x, z, radius, channel, value) {
  const cx = ((x - minX) / spanX) * (size - 1);
  const cy = ((z - minZ) / spanZ) * (size - 1);
  const rx = radius / (spanX / (size - 1));
  const ry = radius / (spanZ / (size - 1));
  const r = Math.ceil(Math.max(rx, ry));
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(size - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(size - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let xPix = x0; xPix <= x1; xPix++) {
      const dx = (xPix - cx) / (rx || 1);
      const dy = (y - cy) / (ry || 1);
      const d = Math.hypot(dx, dy);
      if (d > 1) continue;
      const i = (y * size + xPix) * 4 + channel;
      const fall = 1 - d;
      data[i] = Math.max(data[i], Math.round(value * Math.min(1, fall * 1.35)));
    }
  }
}

function walkPolyline(pts, step, fn) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      fn(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, len);
    }
  }
}

export function buildWearMap(data) {
  const { minX, minZ, step, cols, rows } = data.terrain;
  const spanX = (cols - 1) * step;
  const spanZ = (rows - 1) * step;
  const size = 1024;
  const pixels = new Uint8Array(size * size * 4);

  for (const road of data.roads || []) {
    const profile = roadProfile(road);
    const half = corridorHalf(profile);
    walkPolyline(road.pts, 6, (x, z) => {
      stamp(pixels, size, minX, minZ, spanX, spanZ, x, z, half * 0.92, 0, 255);
      stamp(pixels, size, minX, minZ, spanX, spanZ, x, z, half + 3.2, 1, 150);
      stamp(pixels, size, minX, minZ, spanX, spanZ, x, z, half + 2.4, 3, 255);
    });
  }
  for (const path of data.paths || []) {
    const half = Math.max(path.w || 1.6, 2.1) * 0.5;
    walkPolyline(path.pts, 5, (x, z) => {
      stamp(pixels, size, minX, minZ, spanX, spanZ, x, z, half, 1, 230);
      stamp(pixels, size, minX, minZ, spanX, spanZ, x, z, half + 1.6, 3, 200);
    });
  }
  if (data.stadium?.outer?.length > 3) {
    const ring = data.stadium.outer;
    let minBX = Infinity;
    let maxBX = -Infinity;
    let minBZ = Infinity;
    let maxBZ = -Infinity;
    for (const [x, z] of ring) {
      minBX = Math.min(minBX, x);
      maxBX = Math.max(maxBX, x);
      minBZ = Math.min(minBZ, z);
      maxBZ = Math.max(maxBZ, z);
    }
    const x0 = Math.max(0, Math.floor(((minBX - 2 - minX) / spanX) * (size - 1)));
    const x1 = Math.min(size - 1, Math.ceil(((maxBX + 2 - minX) / spanX) * (size - 1)));
    const y0 = Math.max(0, Math.floor(((minBZ - 2 - minZ) / spanZ) * (size - 1)));
    const y1 = Math.min(size - 1, Math.ceil(((maxBZ + 2 - minZ) / spanZ) * (size - 1)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const wx = minX + (x / (size - 1)) * spanX;
        const wz = minZ + (y / (size - 1)) * spanZ;
        if (!pointInPoly(wx, wz, ring)) continue;
        const i = (y * size + x) * 4;
        pixels[i + 3] = 255;
      }
    }
  }

  for (const pitch of data.pitches || []) {
    const [cx, cz] = centroid(pitch.f);
    const reach = Math.max(spanOf(pitch.f), 8);
    stamp(pixels, size, minX, minZ, spanX, spanZ, cx, cz, reach, 3, 255);
  }

  const meterX = spanX / (size - 1);
  const meterZ = spanZ / (size - 1);
  for (const b of data.buildings || []) {
    const ring = b.f;
    if (!ring || ring.length < 4) continue;
    let minBX = Infinity;
    let maxBX = -Infinity;
    let minBZ = Infinity;
    let maxBZ = -Infinity;
    for (const [x, z] of ring) {
      minBX = Math.min(minBX, x);
      maxBX = Math.max(maxBX, x);
      minBZ = Math.min(minBZ, z);
      maxBZ = Math.max(maxBZ, z);
    }
    const pad = 8;
    const x0 = Math.max(0, Math.floor(((minBX - pad - minX) / spanX) * (size - 1)));
    const x1 = Math.min(size - 1, Math.ceil(((maxBX + pad - minX) / spanX) * (size - 1)));
    const y0 = Math.max(0, Math.floor(((minBZ - pad - minZ) / spanZ) * (size - 1)));
    const y1 = Math.min(size - 1, Math.ceil(((maxBZ + pad - minZ) / spanZ) * (size - 1)));
    const pts = openRing(ring);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const wx = minX + (x / (size - 1)) * spanX;
        const wz = minZ + (y / (size - 1)) * spanZ;
        const inside = pointInPoly(wx, wz, ring);
        let dist = inside ? 0 : 1e9;
        if (!inside) {
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const c = pts[(i + 1) % pts.length];
            dist = Math.min(dist, distToSeg(wx, wz, a[0], a[1], c[0], c[1]));
          }
        }
        const i = (y * size + x) * 4;
        if (inside) {
          pixels[i + 3] = 255;
          pixels[i + 2] = Math.max(pixels[i + 2], 40);
        } else if (dist < 7) {
          const ao = Math.round((1 - dist / 7) * 210);
          pixels[i + 2] = Math.max(pixels[i + 2], ao);
          if (dist < 2.4) pixels[i + 1] = Math.max(pixels[i + 1], Math.round((1 - dist / 2.4) * 120));
          if (dist < 1.2) pixels[i + 3] = Math.max(pixels[i + 3], 180);
        }
      }
    }
  }

  const tex = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  void meterX;
  void meterZ;
  return { texture: tex, pixels, size, minX, minZ, spanX, spanZ };
}

function centroid(ring) {
  let x = 0;
  let z = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    z += ring[i][1];
  }
  return [x / n, z / n];
}

function spanOf(ring) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return Math.hypot(maxX - minX, maxZ - minZ) * 0.55;
}

function biomeColor(kind) {
  if (kind === 'wood') return [0.62, 0.78, 0.55];
  if (kind === 'garden') return [0.9, 1.05, 0.78];
  if (kind === 'cemetery') return [0.78, 0.84, 0.66];
  return [1, 1, 0.9];
}

export function buildGround(data, yAt) {
  const wear = buildWearMap(data);
  const { minX, minZ, step, cols, rows } = data.terrain;
  const fine = 4;
  const spanX = (cols - 1) * step;
  const spanZ = (rows - 1) * step;
  const fCols = Math.round(spanX / fine) + 1;
  const fRows = Math.round(spanZ / fine) + 1;
  const positions = new Float32Array(fCols * fRows * 3);
  const colors = new Float32Array(fCols * fRows * 3);
  const uvs = new Float32Array(fCols * fRows * 2);
  const layers = data.greens || [];

  for (let row = 0; row < fRows; row++) {
    for (let col = 0; col < fCols; col++) {
      const x = minX + (col / (fCols - 1)) * spanX;
      const z = minZ + (row / (fRows - 1)) * spanZ;
      const i = (row * fCols + col) * 3;
      const wearS = sampleWear(wear, x, z);
      const flatten = Math.min(1, Math.max(wearS.pavement, wearS.flat));
      const patch = noise2(x * 0.04, z * 0.04);
      const fine = noise2(x * 0.16, z * 0.14);
      let tint = [0.82 + patch * 0.3, 0.92 + fine * 0.16, 0.76 + (1 - patch) * 0.14];
      let inGreen = false;
      for (const layer of layers) {
        if (!pointInPoly(x, z, layer.f)) continue;
        inGreen = true;
        if (layer.kind === 'wood') tint = [0.58, 0.74, 0.55];
        else if (layer.kind === 'garden') tint = [0.95, 1.08, 0.86];
        else tint = [0.9 + patch * 0.18, 1.02 + fine * 0.1, 0.82];
      }
      if (!inGreen) {
        tint[0] *= 0.88;
        tint[1] *= 0.8;
        tint[2] *= 0.68;
      }
      const dirt = Math.min(1, wearS.path * (1 - wearS.pavement * 0.8));
      tint[0] = tint[0] * (1 - dirt) + 1.08 * dirt;
      tint[1] = tint[1] * (1 - dirt) + 0.7 * dirt;
      tint[2] = tint[2] * (1 - dirt) + 0.38 * dirt;
      const shade = 1 - wearS.ao * 0.45;
      tint[0] *= shade;
      tint[1] *= shade;
      tint[2] *= shade;
      if (wearS.pavement > 0.5) {
        const p = Math.min(1, (wearS.pavement - 0.5) / 0.45);
        tint = [
          tint[0] * (1 - p) + 0.2 * p,
          tint[1] * (1 - p) + 0.2 * p,
          tint[2] * (1 - p) + 0.18 * p,
        ];
      }
      const bump = (patch * 0.62 + fine * 0.38 - 0.48) * 0.2 * (1 - flatten);
      positions[i] = x;
      positions[i + 1] = yAt(x, z) + bump;
      positions[i + 2] = z;
      colors[i] = tint[0];
      colors[i + 1] = tint[1];
      colors[i + 2] = tint[2];
      uvs[(row * fCols + col) * 2] = x / 5.5;
      uvs[(row * fCols + col) * 2 + 1] = z / 5.5;
    }
  }
  const indices = [];
  for (let row = 0; row < fRows - 1; row++) {
    for (let col = 0; col < fCols - 1; col++) {
      const a = row * fCols + col;
      const b = a + 1;
      const c = a + fCols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const maps = grassMaps();
  const material = new THREE.MeshStandardMaterial({
    color: 0x2f8a32,
    map: maps.map,
    normalMap: maps.normalMap,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0,
    vertexColors: true,
  });
  material.normalScale = new THREE.Vector2(0.85, 0.85);

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return { mesh, wear };
}
