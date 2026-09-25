import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { areaCentroid, footprintBase, hash01, pointInPoly, ringRadius } from './geo.js';
import { resolveBuilding } from './height-rules.js';

const SOIL = [0.1, 0.36, 0.08];
const LAWN = [0.14, 0.48, 0.1];
const WOOD = [0.05, 0.22, 0.06];
const GARDEN = [0.12, 0.42, 0.1];

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
  const roofUv = [];
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
      for (const p of tri) {
        roof.push(p[0], p[1], p[2]);
        roofUv.push(p[0] / 5.5, p[2] / 5.5);
      }
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
    roofGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roofUv, 2));
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
      const extra = Array.isArray(line.lift) ? line.lift[i] || 0 : line.bridge ? line.bridgeLift || 5.4 : 0;
      const y = yAt(x, z) + lift + extra;
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

function principalAngle(ring) {
  const [cx, cz] = areaCentroid(ring);
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const dx = ring[i][0] - cx;
    const dz = ring[i][1] - cz;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
  }
  return 0.5 * Math.atan2(2 * sxz, sxx - szz);
}

function addChurchDetail(group, ring, baseY, naveH, tipH, materials) {
  const [cx, cz] = areaCentroid(ring);
  const angle = principalAngle(ring);
  const radius = Math.max(14, ringRadius(ring, [cx, cz]));
  const length = radius * 1.45;
  const width = radius * 0.72;
  const rise = Math.min(6.5, naveH * 0.32);
  const shape = new THREE.Shape();
  shape.moveTo(-width * 0.5, 0);
  shape.lineTo(0, rise);
  shape.lineTo(width * 0.5, 0);
  const roof = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  roof.translate(0, 0, -length / 2);
  roof.rotateY(angle);
  roof.translate(cx, baseY + naveH - 0.15, cz);

  const towerH = Math.max(6, (tipH - naveH) * 0.45);
  const spireH = Math.max(8, tipH - naveH - towerH + 3.5);
  const tower = new THREE.BoxGeometry(7.4, towerH, 7.4);
  tower.translate(cx, baseY + naveH + towerH * 0.5, cz);
  const spire = new THREE.ConeGeometry(3.15, spireH, 8);
  spire.translate(cx, baseY + naveH + towerH + spireH * 0.45, cz);
  const crossV = new THREE.BoxGeometry(0.42, 4.2, 0.42);
  const crossH = new THREE.BoxGeometry(2.5, 0.4, 0.42);
  const tip = baseY + naveH + towerH + spireH;
  crossV.translate(cx, tip + 1.6, cz);
  crossH.translate(cx, tip + 2.5, cz);
  const bits = [roof, tower, spire, crossV, crossH];
  for (let i = 0; i < 4; i++) {
    const a = angle + (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pin = new THREE.ConeGeometry(0.65, 4.8, 4);
    pin.translate(cx + Math.cos(a) * width * 0.78, baseY + naveH + 2.2, cz + Math.sin(a) * width * 0.42);
    bits.push(pin);
  }
  addMesh(group, mergeGeometries(bits, false), materials.spire);
}

function addLightTowers(group, ring, yAt, material) {
  const [cx, cz] = areaCentroid(ring);
  const pts = openRing(ring);
  const picks = [];
  for (const score of [(x, z) => x + z, (x, z) => x - z, (x, z) => -x + z, (x, z) => -x - z]) {
    let best = pts[0];
    let bestScore = -Infinity;
    for (const [x, z] of pts) {
      const value = score(x - cx, z - cz);
      if (value > bestScore) {
        bestScore = value;
        best = [x, z];
      }
    }
    picks.push(best);
  }
  const poles = [];
  const heads = [];
  for (const [x, z] of picks) {
    const base = yAt(x, z);
    const pole = new THREE.CylinderGeometry(0.55, 0.75, 34, 6);
    pole.translate(x, base + 17, z);
    const head = new THREE.BoxGeometry(11, 1.8, 4.6);
    head.translate(x, base + 34.6, z);
    poles.push(pole);
    heads.push(head);
  }
  addMesh(group, mergeGeometries(poles, false), material);
  addMesh(group, mergeGeometries(heads, false), material.userData?.lamp || material);
}

function addCanopy(group, ring, baseY, material) {
  const [cx, cz] = areaCentroid(ring);
  const radius = Math.max(8, ringRadius(ring, [cx, cz]));
  const roof = new THREE.BoxGeometry(radius * 2.4, 0.45, radius * 1.5);
  roof.translate(cx, baseY + 7.4, cz);
  const posts = [];
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const post = new THREE.BoxGeometry(0.35, 7, 0.35);
    post.translate(cx + sx * radius * 0.8, baseY + 3.5, cz + sz * radius * 0.45);
    posts.push(post);
  }
  addMesh(group, mergeGeometries([roof, ...posts], false), material);
}

function sampleRing(ring, cx, cz, count) {
  const pts = openRing(ring)
    .map(([x, z]) => ({ x, z, ang: Math.atan2(x - cx, z - cz) }))
    .sort((a, b) => a.ang - b.ang);
  const unique = [];
  for (const point of pts) {
    const prev = unique[unique.length - 1];
    if (prev && Math.abs(point.ang - prev.ang) < 1e-4) continue;
    unique.push(point);
  }
  if (unique.length < 3) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const ang = -Math.PI + ((i + 0.5) / count) * Math.PI * 2;
    let hi = 0;
    while (hi < unique.length && unique[hi].ang < ang) hi++;
    const next = unique[hi % unique.length];
    const prev = unique[(hi - 1 + unique.length) % unique.length];
    let prevAng = prev.ang;
    let nextAng = next.ang;
    if (hi === 0) prevAng -= Math.PI * 2;
    if (hi === unique.length) nextAng += Math.PI * 2;
    const span = nextAng - prevAng || 1;
    const t = Math.max(0, Math.min(1, (ang - prevAng) / span));
    out.push([prev.x + (next.x - prev.x) * t, prev.z + (next.z - prev.z) * t]);
  }
  return out;
}

function pushTri(pos, uv, verts, uvs) {
  for (let i = 0; i < 3; i++) {
    pos.push(verts[i][0], verts[i][1], verts[i][2]);
    uv.push(uvs[i][0], uvs[i][1]);
  }
}

function bufferFrom(pos, uv) {
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/** Annular bowl: navy fascia, sloped seat deck, turf in the hole, goal posts. */
function buildStadium(stadium, yAt, materials) {
  if (!stadium?.outer || stadium.outer.length < 4 || !stadium.inner || stadium.inner.length < 4) return null;
  const [cx, cz] = areaCentroid(stadium.outer);
  const count = 64;
  const outer = sampleRing(stadium.outer, cx, cz, count);
  const inner = sampleRing(stadium.inner, cx, cz, count);
  if (outer.length !== count || inner.length !== count) return null;
  const base = footprintBase(stadium.outer, yAt);
  const wallH = stadium.h || 15;
  const lip = 2.4;
  const wallPos = [];
  const wallUv = [];
  const seatPos = [];
  const seatUv = [];
  const cum = [0];
  for (let i = 0; i < count; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % count];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  for (let i = 0; i < count; i++) {
    const [x0, z0] = outer[i];
    const [x1, z1] = outer[(i + 1) % count];
    const [ix0, iz0] = inner[i];
    const [ix1, iz1] = inner[(i + 1) % count];
    const u0 = cum[i] / 22;
    const u1 = cum[i + 1] / 22;
    pushTri(
      wallPos,
      wallUv,
      [[x0, base, z0], [x1, base, z1], [x1, base + wallH, z1]],
      [[u0, 0], [u1, 0], [u1, 1]],
    );
    pushTri(
      wallPos,
      wallUv,
      [[x0, base, z0], [x1, base + wallH, z1], [x0, base + wallH, z0]],
      [[u0, 0], [u1, 1], [u0, 1]],
    );
    const su0 = (i / count) * 8;
    const su1 = ((i + 1) / count) * 8;
    pushTri(
      seatPos,
      seatUv,
      [[x0, base + wallH, z0], [x1, base + wallH, z1], [ix1, base + lip, iz1]],
      [[su0, 0], [su1, 0], [su1, 4]],
    );
    pushTri(
      seatPos,
      seatUv,
      [[x0, base + wallH, z0], [ix1, base + lip, iz1], [ix0, base + lip, iz0]],
      [[su0, 0], [su1, 4], [su0, 4]],
    );
  }
  const fieldGeo = shapeSlab(stadium.inner);
  if (fieldGeo) fieldGeo.translate(0, base + 0.7, 0);
  const fascia = materials.navy.clone();
  fascia.side = THREE.DoubleSide;
  const seats = materials.seating.clone();
  seats.side = THREE.DoubleSide;
  return {
    wallGeo: bufferFrom(wallPos, wallUv),
    seatGeo: bufferFrom(seatPos, seatUv),
    fieldGeo,
    goals: goalPosts(stadium.inner, base + 0.9),
    fascia,
    seats,
  };
}

function goalPosts(ring, y) {
  const pts = openRing(ring);
  const [cx, cz] = areaCentroid(ring);
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (const [x, z] of pts) {
    const dx = x - cx;
    const dz = z - cz;
    xx += dx * dx;
    zz += dz * dz;
    xz += dx * dz;
  }
  const disc = Math.sqrt(Math.max(0, ((xx + zz) * (xx + zz)) / 4 - (xx * zz - xz * xz)));
  const lambda = (xx + zz) / 2 + disc;
  let ax = Math.abs(xz) > 1e-6 ? lambda - zz : xx >= zz ? 1 : 0;
  let az = Math.abs(xz) > 1e-6 ? xz : xx >= zz ? 0 : 1;
  const len = Math.hypot(ax, az) || 1;
  ax /= len;
  az /= len;
  let reach = 0;
  for (const [x, z] of pts) reach = Math.max(reach, (x - cx) * ax + (z - cz) * az);
  const posts = [];
  const span = Math.min(reach * 0.86, reach - 4);
  for (const sign of [-1, 1]) {
    const x = cx + ax * sign * span;
    const z = cz + az * sign * span;
    const px = -az;
    const pz = ax;
    for (const side of [-2.9, 2.9]) {
      const upright = new THREE.BoxGeometry(0.28, 9.5, 0.28);
      upright.translate(x + px * side, y + 4.75, z + pz * side);
      posts.push(upright);
    }
    const bar = new THREE.BoxGeometry(0.28, 0.22, 6.1);
    bar.rotateY(Math.atan2(px, pz));
    bar.translate(x, y + 3.05, z);
    posts.push(bar);
  }
  return mergeGeometries(posts, false);
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
        const [cx, cz] = areaCentroid(ring);
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
  slabs(
    (data.greens || []).filter((green) => green.kind === 'grass' || green.kind === 'garden'),
    materials.lawn,
    0.12,
  );
  slabs(data.pitches || [], materials.pitch, 0.3);

  addMesh(group, ribbonGeometry(data.roads || [], yAt, 0.36), materials.road, { cast: false });
  addMesh(group, ribbonGeometry(data.paths || [], yAt, 0.24), materials.path, { cast: false });
  const markings = (data.roads || [])
    .filter((road) => ['trunk', 'primary', 'secondary', 'tertiary'].includes(road.cls) && road.oneway !== 'yes' && road.oneway !== '1')
    .map((road) => ({ pts: road.pts, w: 0.18, lift: road.lift }));
  addMesh(group, ribbonGeometry(markings, yAt, 0.46), materials.marking, { cast: false });
  addMesh(group, ribbonGeometry(railingLines(data.paths || []), yAt, 0.24), materials.steel, { cast: false });
  addMesh(group, ribbonGeometry(railingLines(data.roads || []), yAt, 0.36), materials.bridge, { cast: false });

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
    const spec = resolveBuilding(b);
    const church = b.n === 'St. Thomas of Villanova Church';
    const station = b.n === 'Villanova Station';
    const height = spec.h;
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
    const fam = materials.families[spec.fam] ? spec.fam : 'stone';
    if (!buckets.has(fam)) buckets.set(fam, []);
    if (parts.wallGeo.getAttribute('position')?.count) buckets.get(fam).push(parts.wallGeo);
    else parts.wallGeo.dispose();
    if (parts.roofGeo.getAttribute('position')?.count) roofs.push(parts.roofGeo);
    else parts.roofGeo.dispose();
    blockers.push({ f: b.f, h: height });
    if (church) {
      try {
        addChurchDetail(group, b.f, base, height, spec.spire || height + 14, materials);
      } catch (err) {
        console.warn('Church spire failed', err);
      }
    }
    if (station) {
      try {
        addCanopy(group, b.f, base, materials.navy);
      } catch (err) {
        console.warn('Station canopy failed', err);
      }
    }
  }

  for (const [fam, geos] of buckets) {
    addMesh(group, mergeParts(geos), materials.families[fam]);
  }
  addMesh(group, mergeParts(roofs), materials.roof);

  const bowl = buildStadium(data.stadium, yAt, materials);
  if (bowl) {
    addMesh(group, bowl.wallGeo, bowl.fascia);
    addMesh(group, bowl.seatGeo, bowl.seats);
    addMesh(group, bowl.fieldGeo, materials.pitch, { cast: false, receive: true });
    addMesh(group, bowl.goals, materials.spire);
    try {
      materials.navy.userData.lamp = materials.lamp;
      addLightTowers(group, data.stadium.outer, yAt, materials.navy);
    } catch (err) {
      console.warn('Stadium lights failed', err);
    }
  }

  if (skipped) console.warn(`Skipped ${skipped} footprints`);
  return { group, blockers };
}

function railingLines(lines) {
  const out = [];
  for (const line of lines) {
    if (!Array.isArray(line.lift) || !line.lift.some((value) => value > 2)) continue;
    const raised = line.lift.map((value) => (value > 1.6 ? value + 1.05 : 0));
    const half = Math.max(0.8, (line.w || 2) * 0.46);
    out.push({ pts: offsetLine(line.pts, half), w: 0.16, lift: raised });
    out.push({ pts: offsetLine(line.pts, -half), w: 0.16, lift: raised });
  }
  return out;
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
