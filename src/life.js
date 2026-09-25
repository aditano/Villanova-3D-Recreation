import * as THREE from 'three';
import { hash01, pointInPoly } from './geo.js';
import { SURFACE, roadProfile } from './road-profile.js';

function densify(pts, step) {
  const out = [];
  if (!pts?.length) return out;
  out.push(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function carBody() {
  const body = new THREE.BoxGeometry(4.15, 0.72, 1.72);
  body.translate(0, 0.72, 0);
  const cabin = new THREE.BoxGeometry(2.15, 0.62, 1.52);
  cabin.translate(-0.15, 1.28, 0);
  const geo = BufferGeometryUtilsMerge([body, cabin]);
  return geo;
}

function BufferGeometryUtilsMerge(geos) {
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    g.computeVertexNormals();
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos[(o + i) * 3] = p.getX(i);
      pos[(o + i) * 3 + 1] = p.getY(i);
      pos[(o + i) * 3 + 2] = p.getZ(i);
      nrm[(o + i) * 3] = n.getX(i);
      nrm[(o + i) * 3 + 1] = n.getY(i);
      nrm[(o + i) * 3 + 2] = n.getZ(i);
    }
    o += p.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return geo;
}

function wheelGeo() {
  const geo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10);
  geo.rotateZ(Math.PI / 2);
  const positions = [];
  const normals = [];
  for (const [x, z] of [
    [1.25, 0.78],
    [1.25, -0.78],
    [-1.25, 0.78],
    [-1.25, -0.78],
  ]) {
    const g = geo.clone();
    g.translate(x, 0.32, z);
    g.computeVertexNormals();
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    g.dispose();
  }
  geo.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return out;
}

const COLORS = [0xf2f2f0, 0xc5c8cc, 0x8d9398, 0x1d3557, 0x6e2430, 0xd8d2c4, 0x2c2f33];

function insideBuildings(x, z, buildings) {
  for (const b of buildings) {
    if (pointInPoly(x, z, b.f)) return true;
  }
  return false;
}

function placeInstances(mesh, items) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    p.set(it.x, it.y, it.z);
    q.setFromAxisAngle(up, it.yaw || 0);
    s.set(it.sx || 1, it.sy || 1, it.sz || 1);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (it.color != null) {
      color.setHex(it.color);
      mesh.setColorAt(i, color);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function buildLife(data, yAt, materials) {
  const group = new THREE.Group();
  group.name = 'life';
  const buildings = data.buildings || [];
  const cars = [];
  const movers = [];
  let trunk = null;
  let trunkLen = 0;

  for (const road of data.roads || []) {
    const profile = roadProfile(road);
    const pts = densify(road.pts, 4);
    if (pts.length < 2) continue;
    const half = profile.asphalt / 2;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if ((road.cls === 'trunk' || road.cls === 'primary') && len > trunkLen) {
      trunk = { pts, half, len };
      trunkLen = len;
    }
    const arterial = profile.kind === 'arterial' || profile.kind === 'highway' || profile.kind === 'collector';
    const spacing = arterial ? 46 : 16;
    let acc = arterial ? 8 : 3;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      acc += seg;
      if (acc < spacing) continue;
      acc = 0;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const sl = seg || 1;
      const dirx = dx / sl;
      const dirz = dz / sl;
      const side = i % 2 === 0 ? 1 : -1;
      const lat = arterial ? half * 0.46 * side : (half - 1.15) * side;
      const x = b[0] - dirz * lat;
      const z = b[1] + dirx * lat;
      if (insideBuildings(x, z, buildings)) continue;
      if (!arterial && hash01(x, z) < 0.42) continue;
      const yaw = Math.atan2(dirx * side, dirz * side);
      const y = yAt(x, z) + SURFACE.asphalt;
      const color = COLORS[Math.floor(hash01(x + 3, z) * COLORS.length) % COLORS.length];
      if (cars.length < 640) cars.push({ x, y, z, yaw, color, sx: 0.92 + hash01(z, x) * 0.16 });
    }
  }

  if (trunk) {
    for (let k = 0; k < 7; k++) {
      const d0 = (k / 7) * trunk.len;
      movers.push({ d: d0, speed: 7 + (k % 3) * 1.6, side: k % 2 === 0 ? 1 : -1, color: COLORS[k % COLORS.length] });
    }
  }

  const reserved = cars.length;
  const total = reserved + movers.length;
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.35, envMapIntensity: 0.45 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.7, metalness: 0.15 });
  const bodyMesh = new THREE.InstancedMesh(carBody(), bodyMat, Math.max(1, total));
  const wheelMesh = new THREE.InstancedMesh(wheelGeo(), wheelMat, Math.max(1, total));
  bodyMesh.count = total;
  wheelMesh.count = total;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  wheelMesh.castShadow = false;
  if (total > 0) {
    placeInstances(bodyMesh, cars.concat(movers.map(() => ({ x: 0, y: -50, z: 0, color: 0xffffff }))));
    placeInstances(wheelMesh, cars.concat(movers.map(() => ({ x: 0, y: -50, z: 0 }))));
  }
  group.add(bodyMesh);
  group.add(wheelMesh);

  const people = [];
  for (const path of data.paths || []) {
    const pts = densify(path.pts, 18);
    for (let i = 1; i < pts.length && people.length < 48; i += 2) {
      const x = pts[i][0];
      const z = pts[i][1];
      if (hash01(x, z) < 0.55) continue;
      if (insideBuildings(x, z, buildings)) continue;
      people.push({ x, y: yAt(x, z) + 0.9, z, yaw: hash01(z, x) * 6.2, sx: 0.42, sy: 0.9 + hash01(x, z) * 0.15, sz: 0.28 });
    }
  }
  const personGeo = new THREE.CapsuleGeometry(0.5, 1, 3, 6);
  const personMesh = new THREE.InstancedMesh(personGeo, materials.skin, Math.max(1, people.length));
  personMesh.count = people.length;
  if (people.length) placeInstances(personMesh, people);
  personMesh.castShadow = true;
  group.add(personMesh);

  const lamps = [];
  for (const road of data.roads || []) {
    const profile = roadProfile(road);
    if (profile.kind !== 'arterial' && profile.kind !== 'collector') continue;
    const pts = densify(road.pts, 8);
    let acc = 12;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      acc += seg;
      if (acc < 36) continue;
      acc = 0;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const sl = seg || 1;
      const side = lamps.length % 2 === 0 ? 1 : -1;
      const lat = profile.asphalt / 2 + profile.curb + 0.45;
      const x = b[0] - (dz / sl) * lat * side;
      const z = b[1] + (dx / sl) * lat * side;
      if (insideBuildings(x, z, buildings)) continue;
      if (lamps.length < 220) lamps.push({ x, y: yAt(x, z) + 4.1, z });
    }
  }
  const pole = new THREE.CylinderGeometry(0.08, 0.11, 8.2, 6);
  const lampMesh = new THREE.InstancedMesh(pole, materials.steel, Math.max(1, lamps.length));
  lampMesh.count = lamps.length;
  if (lamps.length) placeInstances(lampMesh, lamps);
  const headGeo = new THREE.BoxGeometry(0.7, 0.16, 0.28);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xf4efe4,
    emissive: 0xffe2b4,
    emissiveIntensity: 0.08,
    roughness: 0.4,
  });
  const heads = new THREE.InstancedMesh(headGeo, headMat, Math.max(1, lamps.length));
  heads.count = lamps.length;
  if (lamps.length) {
    placeInstances(
      heads,
      lamps.map((l) => ({ x: l.x, y: l.y + 4.05, z: l.z })),
    );
  }
  group.add(lampMesh);
  group.add(heads);

  const trees = [];
  const pitches = data.pitches || [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const b of buildings) {
    for (const [x, z] of b.f) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  const landmarks = data.landmarks || [];
  for (let x = minX - 10; x < maxX + 20 && trees.length < 420; x += 17) {
    for (let z = minZ - 10; z < maxZ + 20 && trees.length < 420; z += 17) {
      const jx = x + (hash01(x, z) - 0.5) * 8;
      const jz = z + (hash01(z, x) - 0.5) * 8;
      if (hash01(jx + 9, jz) < 0.35) continue;
      if (insideBuildings(jx, jz, buildings)) continue;
      let nearRoad = false;
      for (const road of data.roads || []) {
        const profile = roadProfile(road);
        const reach = profile.asphalt / 2 + profile.walk + 1.2;
        for (let i = 1; i < road.pts.length; i += 2) {
          const a = road.pts[i];
          if (Math.hypot(a[0] - jx, a[1] - jz) < reach) {
            nearRoad = true;
            break;
          }
        }
        if (nearRoad) break;
      }
      if (nearRoad) continue;
      if (landmarks.some((lm) => Math.hypot(lm.x - jx, lm.z - jz) < 16)) continue;
      if (pitches.some((p) => pointInPoly(jx, jz, p.f))) continue;
      const s = 2.4 + hash01(jx, jz) * 2.8;
      trees.push({ x: jx, y: yAt(jx, jz) + s * 0.85, z: jz, sx: s, sy: s * 0.85, sz: s, dark: hash01(jz, jx) > 0.5 });
    }
  }
  const canopy = new THREE.IcosahedronGeometry(1, 1);
  const darkTrees = trees.filter((t) => t.dark);
  const lightTrees = trees.filter((t) => !t.dark);
  const addCanopy = (list, mat) => {
    const mesh = new THREE.InstancedMesh(canopy, mat, Math.max(1, list.length));
    mesh.count = list.length;
    if (list.length) placeInstances(mesh, list);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  addCanopy(lightTrees, materials.tree);
  addCanopy(darkTrees, materials.treeDark);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 5);
  const trunks = new THREE.InstancedMesh(trunkGeo, materials.trunk, Math.max(1, trees.length));
  trunks.count = trees.length;
  if (trees.length) {
    placeInstances(
      trunks,
      trees.map((t) => ({ x: t.x, y: t.y - t.sy * 0.85, z: t.z, sx: 1, sy: t.sy * 0.9, sz: 1 })),
    );
  }
  trunks.castShadow = false;
  group.add(trunks);

  const dummy = new THREE.Object3D();
  function pointAlong(pts, dist) {
    let left = dist;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-4;
      if (left <= seg) {
        const t = left / seg;
        return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / seg, dz: (b[1] - a[1]) / seg };
      }
      left -= seg;
    }
    const b = pts[pts.length - 1];
    const a = pts[pts.length - 2];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { x: b[0], z: b[1], dx: (b[0] - a[0]) / seg, dz: (b[1] - a[1]) / seg };
  }

  function syncCar(index, item) {
    dummy.position.set(item.x, item.y, item.z);
    dummy.rotation.set(0, item.yaw, 0);
    dummy.scale.set(item.sx || 1, 1, 1);
    dummy.updateMatrix();
    bodyMesh.setMatrixAt(index, dummy.matrix);
    wheelMesh.setMatrixAt(index, dummy.matrix);
    if (item.color != null) {
      bodyMesh.setColorAt(index, new THREE.Color(item.color));
    }
  }

  cars.forEach((car, i) => syncCar(i, car));
  bodyMesh.instanceMatrix.needsUpdate = true;
  wheelMesh.instanceMatrix.needsUpdate = true;
  if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;

  return {
    group,
    update(dt, night) {
      headMat.emissiveIntensity = 0.05 + night * 1.35;
      if (!trunk || !movers.length) return;
      movers.forEach((mv, k) => {
        mv.d = (mv.d + dt * mv.speed) % trunk.len;
        const p = pointAlong(trunk.pts, mv.d);
        const lat = trunk.half * 0.42 * mv.side;
        const x = p.x - p.dz * lat;
        const z = p.z + p.dx * lat;
        const yaw = Math.atan2(p.dx * mv.side, p.dz * mv.side);
        syncCar(reserved + k, { x, y: yAt(x, z) + SURFACE.asphalt, z, yaw, color: mv.color, sx: 1 });
      });
      bodyMesh.instanceMatrix.needsUpdate = true;
      wheelMesh.instanceMatrix.needsUpdate = true;
      if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
    },
  };
}
