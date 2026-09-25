/**
 * Rendering regressions for the meshes campus.js actually draws.
 * Roof/wall alignment, window placement, life.js vehicle geometry, and box winding.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildStructures } from '../src/buildings.js';
import { carBodyGeometry, mergeBufferGeometries, vehicleYaw, wheelGeometry } from '../src/life.js';
import { addBox, chamferRing, edgesOf, MeshBuf } from '../src/meshlib.js';
import { FAMILIES } from '../src/textures.js';

const campusSrc = readFileSync(new URL('../src/campus.js', import.meta.url), 'utf8');
assert.match(campusSrc, /from '\.\/life\.js'/);
assert.doesNotMatch(campusSrc, /campus-life/);

function stubMaterials() {
  const mat = {};
  const families = {};
  for (const name of Object.keys(FAMILIES)) families[name] = mat;
  return {
    families,
    trim: mat,
    roof: mat,
    slate: mat,
    steel: mat,
    seat: mat,
    fascia: mat,
    field: mat,
    glass: mat,
    concrete: mat,
    spire: mat,
  };
}

function yExtent(geo, { verticalOnly = false } = {}) {
  const pos = geo.attributes.position;
  let min = Infinity;
  let max = -Infinity;
  let n = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i);
    const ay = pos.getY(i);
    const az = pos.getZ(i);
    const bx = pos.getX(i + 1);
    const by = pos.getY(i + 1);
    const bz = pos.getZ(i + 1);
    const cx = pos.getX(i + 2);
    const cy = pos.getY(i + 2);
    const cz = pos.getZ(i + 2);
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const ny = uz * vx - ux * vz;
    const len = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx) || 1;
    if (verticalOnly && Math.abs(ny / len) > 0.25) continue;
    min = Math.min(min, ay, by, cy);
    max = Math.max(max, ay, by, cy);
    n += 3;
  }
  assert.ok(n > 0, 'no vertices in extent');
  return { min, max };
}

function buildAt(building, y0) {
  return buildStructures({ buildings: [building] }, () => y0, stubMaterials());
}

const hall = {
  n: 'Sample Hall',
  h: 14,
  fam: 'stone',
  f: [[0, 0], [28, 0], [28, 12], [0, 12], [0, 0]],
};
const house = {
  n: 'Sample House',
  h: 6,
  fam: 'stone',
  f: [[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]],
};

for (const y0 of [14, 0, -11]) {
  const flat = buildAt(hall, y0);
  const walls = flat.group.getObjectByName('walls:stone');
  const roof = flat.group.getObjectByName('roof-membrane');
  assert.ok(walls && roof, `flat parts at ${y0}`);
  const wallY = yExtent(walls.geometry, { verticalOnly: true });
  const roofY = yExtent(roof.geometry);
  assert.ok(
    Math.abs(wallY.max - roofY.min) < 0.2,
    `flat eaves y0=${y0} wall ${wallY.max.toFixed(2)} roof ${roofY.min.toFixed(2)}`,
  );
  assert.ok(wallY.max > y0 + 10, `flat walls reach the roof at y0=${y0}: ${wallY.max}`);
  assert.ok(Math.abs(roofY.max - roofY.min) < 0.05, 'flat roof is level');

  const pitched = buildAt(house, y0);
  const pitchedWalls = pitched.group.getObjectByName('walls:stone');
  const slate = pitched.group.getObjectByName('roof-slate');
  assert.ok(pitchedWalls && slate, `pitched parts at ${y0}`);
  const shaft = yExtent(pitchedWalls.geometry, { verticalOnly: true });
  const slateY = yExtent(slate.geometry);
  assert.ok(
    Math.abs(shaft.max - slateY.min) < 0.15,
    `pitched eaves y0=${y0} shaft ${shaft.max.toFixed(2)} eave ${slateY.min.toFixed(2)}`,
  );
  assert.ok(slateY.max > slateY.min + 1, 'pitched roof has a rise');
  assert.ok(shaft.min > y0 && shaft.min < y0 + 3, `pitched walls spring from terrain ${y0}, got ${shaft.min}`);
}

function signedOutward(x, z, edges) {
  let best = Infinity;
  let signed = 0;
  for (const edge of edges) {
    const vx = x - edge.ax;
    const vz = z - edge.az;
    const t = Math.max(0, Math.min(edge.len, vx * edge.dx + vz * edge.dz));
    const px = edge.ax + edge.dx * t;
    const pz = edge.az + edge.dz * t;
    const ox = x - px;
    const oz = z - pz;
    const dist = Math.hypot(ox, oz);
    if (dist < best) {
      best = dist;
      signed = ox * edge.nx + oz * edge.nz >= 0 ? dist : -dist;
    }
  }
  return signed;
}

const glazed = buildAt(hall, 6);
const glass = glazed.group.getObjectByName('window-glass');
assert.ok(glass && glass.count > 8, `windows ${glass?.count}`);
const shell = edgesOf(chamferRing(hall.f, hall.h > 8 ? 1.05 : 0.62));
const matrix = new THREE.Matrix4();
const point = new THREE.Vector3();
for (let i = 0; i < glass.count; i++) {
  glass.getMatrixAt(i, matrix);
  point.setFromMatrixPosition(matrix);
  const dist = signedOutward(point.x, point.z, shell);
  assert.ok(dist > 0.05 && dist < 0.4, `window ${i} is ${dist.toFixed(3)} m outside the wall`);
  assert.ok(point.y > 6 && point.y < 20, `window ${i} height ${point.y}`);
}

function triangleCount(geo) {
  const index = geo.getIndex();
  return (index ? index.count : geo.getAttribute('position').count) / 3;
}

const bodyA = new THREE.BoxGeometry(4.15, 0.72, 1.72);
const bodyB = new THREE.BoxGeometry(2.15, 0.62, 1.52);
const bodyTris = triangleCount(bodyA) + triangleCount(bodyB);
assert.ok(bodyA.index && bodyA.index.count > bodyA.getAttribute('position').count, 'box primitive is indexed');
bodyA.dispose();
bodyB.dispose();
const body = carBodyGeometry();
assert.equal(body.getAttribute('position').count / 3, bodyTris, 'car merge dropped or invented triangles');
assert.equal(body.getAttribute('normal').count, body.getAttribute('position').count);
body.computeBoundingBox();
const bodySize = new THREE.Vector3();
body.boundingBox.getSize(bodySize);
assert.ok(Math.abs(bodySize.x - 4.15) < 0.02, `body length ${bodySize.x}`);
assert.ok(bodySize.x > bodySize.z * 2, 'body length stays on local X');

const cyl = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10);
const wheelTris = triangleCount(cyl) * 4;
assert.ok(cyl.index, 'cylinder primitive is indexed');
cyl.dispose();
const wheels = wheelGeometry();
assert.equal(wheels.getAttribute('position').count / 3, wheelTris, 'wheel merge dropped triangles');
{
  const pos = wheels.getAttribute('position');
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (x < 0.9 || z < 0) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, pos.getY(i));
    maxY = Math.max(maxY, pos.getY(i));
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const spanZ = maxZ - minZ;
  assert.ok(spanX > 0.6 && spanY > 0.6, `wheel diameter ${spanX.toFixed(2)} x ${spanY.toFixed(2)}`);
  assert.ok(spanZ < 0.3 && spanZ < spanX * 0.5, `wheel axle should be lateral, thickness ${spanZ.toFixed(2)}`);
}

const indexed = new THREE.BoxGeometry(1, 2, 3);
const indexedTris = triangleCount(indexed);
indexed.dispose();
const merged = mergeBufferGeometries([new THREE.BoxGeometry(1, 2, 3)]);
assert.equal(merged.getAttribute('position').count / 3, indexedTris);

function outwardScore(geo) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  geo.computeBoundingBox();
  const center = geo.boundingBox.getCenter(new THREE.Vector3());
  let bad = 0;
  let total = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const centroid = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (let k = 0; k < 3; k++) {
      centroid.x += pos.getX(i + k);
      centroid.y += pos.getY(i + k);
      centroid.z += pos.getZ(i + k);
      normal.x += nrm.getX(i + k);
      normal.y += nrm.getY(i + k);
      normal.z += nrm.getZ(i + k);
    }
    centroid.multiplyScalar(1 / 3);
    if (normal.lengthSq() < 1e-10) continue;
    normal.normalize();
    total += 1;
    if (centroid.clone().sub(center).dot(normal) <= 0.05) bad += 1;
  }
  assert.ok(total >= 12, `box triangles ${total}`);
  assert.equal(bad, 0, `${bad} inward faces`);
}

const box = new MeshBuf();
addBox(box, 3, -4, 8, 4, 6, 2, 0.7);
outwardScore(box.toGeometry());
const axisBox = new MeshBuf();
addBox(axisBox, 0, 0, 0, 2, 2, 2, 0);
outwardScore(axisBox.toGeometry());

function lengthAxis(dirX, dirZ) {
  const object = new THREE.Object3D();
  object.rotation.set(0, vehicleYaw(dirX, dirZ), 0);
  object.updateMatrix();
  return new THREE.Vector3(1, 0, 0).applyMatrix4(object.matrix);
}

for (const [dirX, dirZ, label] of [
  [1, 0, 'east'],
  [-1, 0, 'west'],
  [0, 1, 'south'],
  [0, -1, 'north'],
  [3, 4, 'southeast'],
  [-5, 2, 'northwest'],
]) {
  const axis = lengthAxis(dirX, dirZ);
  const len = Math.hypot(dirX, dirZ);
  const dot = (axis.x * dirX + axis.z * dirZ) / len;
  assert.ok(dot > 0.999, `${label} length axis dot ${dot} (axis ${axis.x.toFixed(3)}, ${axis.z.toFixed(3)})`);
}

console.log(`ok rendering eaves windows=${glass.count} bodyTris=${bodyTris} wheelTris=${wheelTris}`);
