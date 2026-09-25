import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { footprintBase, hash01, pointInPoly, ringCentroid } from './geo.js';

const SOIL = [0.16, 0.17, 0.15];
const LAWN = [0.22, 0.31, 0.24];
const WOOD = [0.13, 0.2, 0.15];
const GARDEN = [0.17, 0.26, 0.2];

function openRing(ring) {
  if (!ring?.length) return [];
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) return ring.slice(0, -1);
  return ring.slice();
}

function shapeArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Shape space is (x, -z). Outers are CCW; holes are CW. */
function toShapePoints(ring, hole) {
  const pts = openRing(ring).map(([x, z]) => [x, -z]);
  if (pts.length < 3) return null;
  const positive = shapeArea(pts) > 0;
  if (positive === Boolean(hole)) pts.reverse();
  return pts;
}

function addContour(path, pts) {
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
}

function extrudeRing(ring, holes, height) {
  const outer = toShapePoints(ring, false);
  if (!outer) return null;
  const shape = new THREE.Shape();
  addContour(shape, outer);
  for (const hole of holes || []) {
    const pts = toShapePoints(hole, true);
    if (!pts) continue;
    const path = new THREE.Path();
    addContour(path, pts);
    shape.holes.push(path);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(2.4, height), bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function shapeSlab(ring) {
  const outer = toShapePoints(ring, false);
  if (!outer) return null;
  const shape = new THREE.Shape();
  addContour(shape, outer);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / 7;
    uv[i * 2 + 1] = pos.getZ(i) / 7;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function splitWallRoof(geo) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.attributes.position;
  const wall = [];
  const wallUv = [];
  const roof = [];
  for (let i = 0; i < pos.count; i += 3) {
    const tri = [];
    for (let k = 0; k < 3; k++) tri.push([pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)]);
    const [a, b, c] = tri;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const horiz = Math.hypot(nx, nz);
    if (ny < -0.35 * (horiz + Math.abs(ny))) continue;
    const flat = ny > horiz * 1.4;
    if (flat) {
      for (const p of tri) roof.push(p[0], p[1], p[2]);
      continue;
    }
    const len = horiz || 1;
    const tx = -nz / len;
    const tz = nx / len;
    for (const p of tri) {
      wall.push(p[0], p[1], p[2]);
      wallUv.push((p[0] * tx + p[2] * tz) / 4.6, p[1] / 3.5);
    }
  }
  const wallGeo = new THREE.BufferGeometry();
  if (wall.length) {
    wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3));
    wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wallUv, 2));
    wallGeo.computeVertexNormals();
  }
  const roofGeo = new THREE.BufferGeometry();
  if (roof.length) {
    roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roof, 3));
    roofGeo.computeVertexNormals();
  }
  if (src !== geo) src.dispose();
  geo.dispose();
  return { wallGeo, roofGeo };
}

function mergeParts(geos) {
  const usable = geos.filter((g) => g && g.getAttribute('position')?.count);
  if (!usable.length) return null;
  if (usable.length === 1) return usable[0];
  const merged = mergeGeometries(usable, false);
  for (const g of usable) g.dispose();
  return merged;
}

function addMesh(group, geo, material, { cast = true, receive = true } = {}) {
  if (!geo) return;
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  group.add(mesh);
}

function ribbonGeometry(lines, yAt, lift) {
  const pos = [];
  const uv = [];
  for (const line of lines) {
    const pts = line.pts;
    const width = line.w;
    if (!pts || pts.length < 2 || !(width > 0)) continue;
    const left = [];
    const right = [];
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      let dx = next[0] - prev[0];
      let dz = next[1] - prev[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const [x, z] = pts[i];
      const y = yAt(x, z) + lift;
      left.push([x - dz * width * 0.5, y, z + dx * width * 0.5]);
      right.push([x + dz * width * 0.5, y, z - dx * width * 0.5]);
      if (i) dist += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      left[i].d = dist;
      right[i].d = dist;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = left[i];
      const b = right[i];
      const c = left[i + 1];
      const d = right[i + 1];
      const push = (p, q, r) => {
        pos.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
        uv.push(p.d * 0.08, 0, q.d * 0.08, 1, r.d * 0.08, 0);
      };
      push(a, b, c);
      pos.push(b[0], b[1], b[2], d[0], d[1], d[2], c[0], c[1], c[2]);
      uv.push(b.d * 0.08, 1, d.d * 0.08, 1, c.d * 0.08, 0);
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

function polyBounds(ring) {
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
  return { minX, maxX, minZ, maxZ };
}

function colorAt(x, z, layers) {
  let tint = SOIL;
  for (const layer of layers) {
    if (x < layer.minX || x > layer.maxX || z < layer.minZ || z > layer.maxZ) continue;
    if (pointInPoly(x, z, layer.f)) tint = layer.color;
  }
  const n = (hash01(x, z) - 0.5) * 0.06;
  return [tint[0] + n, tint[1] + n * 0.8, tint[2] + n * 0.5];
}

function buildTerrainMesh(terrain, yAt, greens) {
  const { minX, minZ, step, cols, rows } = terrain;
  const layers = greens.map((g) => {
    const b = polyBounds(g.f);
    let color = LAWN;
    if (g.kind === 'wood') color = WOOD;
    else if (g.kind === 'garden') color = GARDEN;
    else if (g.kind === 'cemetery') color = [0.2, 0.22, 0.18];
    return { ...b, f: g.f, color };
  });
  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = minX + col * step;
      const z = minZ + row * step;
      const i = (row * cols + col) * 3;
      positions[i] = x;
      positions[i + 1] = yAt(x, z);
      positions[i + 2] = z;
      const c = colorAt(x, z, layers);
      colors[i] = c[0];
      colors[i + 1] = c[1];
      colors[i + 2] = c[2];
    }
  }
  const indices = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function insetRing(ring, scale) {
  const [cx, cz] = ringCentroid(ring);
  const pts = openRing(ring).map(([x, z]) => [cx + (x - cx) * scale, cz + (z - cz) * scale]);
  pts.push([pts[0][0], pts[0][1]]);
  return pts;
}

function addChurchSpires(group, ring, baseY, naveH, tipH, material) {
  const [cx, cz] = ringCentroid(ring);
  const spireH = Math.max(14, tipH - naveH);
  const cone = new THREE.ConeGeometry(3.6, spireH, 7);
  cone.translate(cx, baseY + naveH + spireH * 0.5, cz);
  const shaft = new THREE.BoxGeometry(6.4, 7.5, 6.4);
  shaft.translate(cx, baseY + naveH + 3.2, cz);
  const pinnacles = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pin = new THREE.ConeGeometry(0.7, 5.5, 4);
    pin.translate(cx + Math.cos(a) * 9.5, baseY + naveH + 2.6, cz + Math.sin(a) * 9.5);
    pinnacles.push(pin);
  }
  const geo = mergeGeometries([cone, shaft, ...pinnacles], false);
  addMesh(group, geo, material);
}

function buildStadium(stadium, yAt, materials) {
  if (!stadium?.outer || stadium.outer.length < 4) return null;
  const hole = stadium.inner?.length >= 4 ? stadium.inner : insetRing(stadium.outer, 0.58);
  let geo = null;
  try {
    geo = extrudeRing(stadium.outer, [hole], stadium.h || 14);
  } catch (err) {
    console.warn('Stadium bowl failed', err);
    return null;
  }
  if (!geo) return null;
  const base = footprintBase(stadium.outer, yAt);
  geo.translate(0, base, 0);
  return splitWallRoof(geo);
}

export function buildCampus(data, yAt, materials) {
  const group = new THREE.Group();
  group.name = 'campus';

  const ground = new THREE.Mesh(buildTerrainMesh(data.terrain, yAt, data.greens || []), materials.terrain);
  ground.receiveShadow = true;
  ground.name = 'terrain';
  group.add(ground);

  const slabs = (rings, material, lift) => {
    const geos = [];
    for (const item of rings) {
      const ring = item.f || item;
      try {
        const geo = shapeSlab(ring);
        if (!geo) continue;
        const [cx, cz] = ringCentroid(ring);
        geo.translate(0, yAt(cx, cz) + lift, 0);
        geos.push(geo);
      } catch (err) {
        console.warn('Slab failed', err);
      }
    }
    addMesh(group, mergeParts(geos), material, { cast: false, receive: true });
  };

  slabs(data.water || [], materials.water, 0.15);
  slabs(data.plazas || [], materials.plaza, 0.12);
  slabs(data.pitches || [], materials.pitch, 0.22);

  addMesh(group, ribbonGeometry(data.roads || [], yAt, 0.32), materials.road, { cast: false });
  addMesh(group, ribbonGeometry(data.paths || [], yAt, 0.2), materials.path, { cast: false });

  const railLines = [];
  const steelLines = [];
  for (const line of data.rail || []) {
    const platform = line.cls === 'platform';
    railLines.push({ pts: line.pts, w: platform ? 2.4 : line.cls === 'light_rail' ? 3.2 : 4.4 });
    if (line.cls === 'rail' && line.pts?.length > 1) {
      steelLines.push({ pts: offsetLine(line.pts, 0.72), w: 0.16 });
      steelLines.push({ pts: offsetLine(line.pts, -0.72), w: 0.16 });
    }
  }
  addMesh(group, ribbonGeometry(railLines, yAt, 0.16), materials.rail, { cast: false });
  addMesh(group, ribbonGeometry(steelLines, yAt, 0.28), materials.steel, { cast: false });

  const buckets = new Map();
  const roofs = [];
  const blockers = [];
  let skipped = 0;

  for (const b of data.buildings || []) {
    const church = b.n === 'St. Thomas of Villanova Church';
    const height = church ? Math.min(16.5, b.h) : b.h;
    let geo = null;
    try {
      geo = extrudeRing(b.f, [], height);
    } catch (err) {
      skipped++;
      console.warn('Building failed', b.n || b.id, err);
      continue;
    }
    if (!geo) {
      skipped++;
      continue;
    }
    const base = footprintBase(b.f, yAt);
    geo.translate(0, base, 0);
    const parts = splitWallRoof(geo);
    const fam = materials.families[b.fam] ? b.fam : 'stone';
    if (!buckets.has(fam)) buckets.set(fam, []);
    if (parts.wallGeo.getAttribute('position')?.count) buckets.get(fam).push(parts.wallGeo);
    else parts.wallGeo.dispose();
    if (parts.roofGeo.getAttribute('position')?.count) roofs.push(parts.roofGeo);
    else parts.roofGeo.dispose();
    blockers.push({ f: b.f, h: height });
    if (church) {
      try {
        addChurchSpires(group, b.f, base, height, Math.max(b.h, height + 14), materials.spire);
      } catch (err) {
        console.warn('Church spire failed', err);
      }
    }
  }

  for (const [fam, geos] of buckets) {
    addMesh(group, mergeParts(geos), materials.families[fam]);
  }
  addMesh(group, mergeParts(roofs), materials.roof);

  const bowl = buildStadium(data.stadium, yAt, materials);
  if (bowl) {
    const fam = materials.families.arena;
    addMesh(group, bowl.wallGeo.getAttribute('position')?.count ? bowl.wallGeo : null, fam);
    addMesh(group, bowl.roofGeo.getAttribute('position')?.count ? bowl.roofGeo : null, materials.roof);
  }

  if (skipped) console.warn(`Skipped ${skipped} footprints`);
  return { group, blockers };
}

function offsetLine(pts, amount) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    out.push([pts[i][0] - dz * amount, pts[i][1] + dx * amount]);
  }
  return out;
}
