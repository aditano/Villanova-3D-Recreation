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

/** Soft multi-scale blotches. No directional strokes — those tile at walk distance. */
function grassMaps() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d7e6c8';
  ctx.fillRect(0, 0, size, size);
  const blot = (count, minR, maxR, alpha) => {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const rx = minR + Math.random() * (maxR - minR);
      const ry = rx * (0.55 + Math.random() * 0.9);
      const g = 120 + Math.floor(Math.random() * 110);
      const r = 50 + Math.floor(Math.random() * 70);
      const b = 40 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha * (0.55 + Math.random() * 0.45)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  blot(28, 90, 220, 0.35);
  blot(80, 28, 80, 0.4);
  blot(220, 8, 24, 0.45);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;

  const nSize = 256;
  const ncan = document.createElement('canvas');
  ncan.width = nSize;
  ncan.height = nSize;
  const nctx = ncan.getContext('2d');
  const img = nctx.createImageData(nSize, nSize);
  const hgt = new Float32Array(nSize * nSize);
  for (let y = 0; y < nSize; y++) {
    for (let x = 0; x < nSize; x++) {
      const nx = x / nSize;
      const ny = y / nSize;
      hgt[y * nSize + x] =
        Math.sin(nx * 18.0) * Math.cos(ny * 14.0) * 0.35 +
        Math.sin(nx * 47.0 + ny * 31.0) * 0.4 +
        Math.sin(nx * 9.0 + 2.0) * Math.sin(ny * 7.0) * 0.45;
    }
  }
  for (let y = 0; y < nSize; y++) {
    for (let x = 0; x < nSize; x++) {
      const hl = hgt[y * nSize + ((x - 1 + nSize) % nSize)];
      const hr = hgt[y * nSize + ((x + 1) % nSize)];
      const hd = hgt[((y + 1) % nSize) * nSize + x];
      const hu = hgt[((y - 1 + nSize) % nSize) * nSize + x];
      const dx = (hl - hr) * 3.2;
      const dy = (hd - hu) * 3.2;
      const i = (y * nSize + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, 128 + dx * 70));
      img.data[i + 1] = Math.max(0, Math.min(255, 128 + dy * 70));
      img.data[i + 2] = 210;
      img.data[i + 3] = 255;
    }
  }
  nctx.putImageData(img, 0, 0);
  const normalMap = new THREE.CanvasTexture(ncan);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  return { map, normalMap };
}

function grassCardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 128);
  for (let i = 0; i < 18; i++) {
    const x = 6 + (i / 17) * 52;
    const lean = (i % 2 === 0 ? 1 : -1) * (4 + (i % 4));
    const g = 90 + (i % 5) * 22;
    ctx.strokeStyle = `rgba(${28 + (i % 3) * 12},${g},${24 + (i % 4) * 8},0.92)`;
    ctx.lineWidth = i % 3 === 0 ? 2.2 : 1.3;
    ctx.beginPath();
    ctx.moveTo(x, 126);
    ctx.quadraticCurveTo(x + lean * 0.4, 70, x + lean, 6 + (i % 5) * 4);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
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
        } else if (dist < 10) {
          const ao = Math.round(Math.pow(1 - dist / 10, 1.35) * 245);
          pixels[i + 2] = Math.max(pixels[i + 2], ao);
          if (dist < 2.8) pixels[i + 1] = Math.max(pixels[i + 1], Math.round((1 - dist / 2.8) * 140));
          if (dist < 1.4) pixels[i + 3] = Math.max(pixels[i + 3], 200);
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
      const broad = noise2(x * 0.011, z * 0.01);
      const patch = noise2(x * 0.042, z * 0.038);
      const mid = noise2(x * 0.12, z * 0.11);
      const fine = noise2(x * 0.33, z * 0.29);
      let tint = [
        0.7 + broad * 0.28 + patch * 0.16,
        0.84 + mid * 0.2 + fine * 0.1,
        0.58 + (1 - broad) * 0.16,
      ];
      let inGreen = false;
      for (const layer of layers) {
        if (!pointInPoly(x, z, layer.f)) continue;
        inGreen = true;
        if (layer.kind === 'wood') tint = [0.58, 0.74, 0.55];
        else if (layer.kind === 'garden') tint = [0.95, 1.08, 0.86];
        else tint = [0.78 + broad * 0.22 + patch * 0.12, 0.98 + mid * 0.14, 0.7 + (1 - patch) * 0.1];
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
      const shade = 1 - wearS.ao * 0.68;
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
      const bump = (broad * 0.45 + patch * 0.35 + mid * 0.2 - 0.5) * 0.34 * (1 - flatten);
      positions[i] = x;
      positions[i + 1] = yAt(x, z) + bump;
      positions[i + 2] = z;
      colors[i] = tint[0];
      colors[i + 1] = tint[1];
      colors[i + 2] = tint[2];
      uvs[(row * fCols + col) * 2] = x / 16;
      uvs[(row * fCols + col) * 2 + 1] = z / 16;
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
  material.normalScale = new THREE.Vector2(1.25, 1.25);

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  const tufts = buildTufts(data, yAt, wear);
  return { mesh, wear, tufts };
}

function buildTufts(data, yAt, wear) {
  const buildings = data.buildings || [];
  const pads = [];
  for (const b of buildings) {
    if (!b.f || b.f.length < 4) continue;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of b.f) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    pads.push({ f: b.f, minX, maxX, minZ, maxZ });
  }
  const blocked = (x, z) => {
    for (const pad of pads) {
      if (x < pad.minX || x > pad.maxX || z < pad.minZ || z > pad.maxZ) continue;
      if (pointInPoly(x, z, pad.f)) return true;
    }
    return false;
  };
  const items = [];
  const minX = -70;
  const maxX = 260;
  const minZ = -40;
  const maxZ = 240;
  const step = 2.55;
  for (let x = minX; x <= maxX && items.length < 3800; x += step) {
    for (let z = minZ; z <= maxZ && items.length < 3800; z += step) {
      const jx = x + (hash2(x, z) - 0.5) * step * 0.85;
      const jz = z + (hash2(z + 4, x) - 0.5) * step * 0.85;
      if (Math.abs(jx) < 15 && jz > -8 && jz < 76) continue;
      const wearS = sampleWear(wear, jx, jz);
      if (wearS.pavement > 0.32 || wearS.flat > 0.5 || wearS.path > 0.5) continue;
      if (blocked(jx, jz)) continue;
      const h = 0.42 + hash2(jx + 1.7, jz) * 0.48;
      items.push({
        x: jx,
        y: yAt(jx, jz) + 0.02,
        z: jz,
        sx: 0.75 + hash2(jz, jx) * 0.45,
        sy: h,
        sz: 1,
        yaw: hash2(jx, jz + 2) * Math.PI,
      });
    }
  }
  const geo = new THREE.PlaneGeometry(0.62, 1, 1, 3);
  geo.translate(0, 0.5, 0);
  const colors = [];
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = 0.45 + y * 0.85;
    colors.push(0.72 * k, k, 0.48 * k);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({
    map: grassCardTexture(),
    color: 0x3c9a3c,
    roughness: 1,
    metalness: 0,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    vertexColors: true,
    envMapIntensity: 0,
  });
  const group = new THREE.Group();
  group.name = 'tufts';
  const place = (yawOffset) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    mesh.count = items.length;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      p.set(it.x, it.y, it.z);
      q.setFromAxisAngle(up, it.yaw + yawOffset);
      s.set(it.sx, it.sy, it.sz);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  };
  place(0);
  place(Math.PI / 2);
  return group;
}
