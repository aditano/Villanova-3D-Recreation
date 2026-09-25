import * as THREE from 'three';
import { MeshBuf } from './meshlib.js';
import { SURFACE, corridorHalf, roadProfile } from './road-profile.js';

function densify(pts, step) {
  if (!pts || pts.length < 2) return [];
  const out = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.4) continue;
    const n = Math.max(1, Math.ceil(len / step));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out.length >= 2 ? out : [];
}

function extendEnds(pts, dist) {
  if (pts.length < 2 || dist <= 0) return pts;
  const a = pts[0];
  const b = pts[1];
  const c = pts[pts.length - 2];
  const d = pts[pts.length - 1];
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const cd = Math.hypot(d[0] - c[0], d[1] - c[1]) || 1;
  return [
    [a[0] - ((b[0] - a[0]) / ab) * dist, a[1] - ((b[1] - a[1]) / ab) * dist],
    ...pts,
    [d[0] + ((d[0] - c[0]) / cd) * dist, d[1] + ((d[1] - c[1]) / cd) * dist],
  ];
}

function buildMiters(pts) {
  const n = pts.length;
  const segN = [];
  for (let i = 0; i < n - 1; i++) {
    let dx = pts[i + 1][0] - pts[i][0];
    let dz = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    segN.push([-dz, dx, dx, dz]);
  }
  const out = [];
  let along = 0;
  for (let i = 0; i < n; i++) {
    let nx;
    let nz;
    if (i === 0) {
      nx = segN[0][0];
      nz = segN[0][1];
    } else if (i === n - 1) {
      nx = segN[n - 2][0];
      nz = segN[n - 2][1];
    } else {
      nx = segN[i - 1][0] + segN[i][0];
      nz = segN[i - 1][1] + segN[i][1];
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      const denom = nx * segN[i][0] + nz * segN[i][1];
      const scale = Math.abs(denom) > 0.42 ? 1 / denom : Math.sign(denom || 1) * 2.3;
      const s = Math.max(-2.3, Math.min(2.3, scale));
      nx *= s;
      nz *= s;
    }
    out.push({ x: pts[i][0], z: pts[i][1], nx, nz, along });
    if (i < n - 1) along += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return out;
}

function place(miters, dist, yAt, lift) {
  return miters.map((m) => {
    const x = m.x + m.nx * dist;
    const z = m.z + m.nz * dist;
    return [x, yAt(x, z) + lift, z, m.along];
  });
}

function uvOf(p) {
  return [p[0] * 0.16, p[2] * 0.16];
}

function ribbon(buf, chain, d0, d1, yAt, lift) {
  if (chain.length < 2) return;
  const a = place(chain, d0, yAt, lift);
  const b = place(chain, d1, yAt, lift);
  for (let i = 0; i < chain.length - 1; i++) {
    const a0 = uvOf(a[i]);
    const a1 = uvOf(a[i + 1]);
    const b1 = uvOf(b[i + 1]);
    const b0 = uvOf(b[i]);
    buf.quad(a[i], a[i + 1], b[i + 1], b[i], [a0[0], a0[1], a1[0], a1[1], b1[0], b1[1], b0[0], b0[1]]);
  }
}

function vertical(buf, chain, dist, yAt, lift0, lift1) {
  if (chain.length < 2 || Math.abs(lift1 - lift0) < 0.01) return;
  const a = place(chain, dist, yAt, lift0);
  const b = place(chain, dist, yAt, lift1);
  for (let i = 0; i < chain.length - 1; i++) {
    buf.quad(a[i], a[i + 1], b[i + 1], b[i]);
  }
}

function marking(buf, chain, dist, half, yAt, lift, dash) {
  const a = place(chain, dist - half, yAt, lift);
  const b = place(chain, dist + half, yAt, lift);
  for (let i = 0; i < chain.length - 1; i++) {
    const mid = (chain[i].along + chain[i + 1].along) * 0.5;
    if (dash) {
      const phase = mid % dash.period;
      if (phase > dash.length) continue;
    }
    buf.quad(a[i], a[i + 1], b[i + 1], b[i]);
  }
}

function disc(buf, x, z, radius, yAt, lift) {
  const segs = 18;
  const cy = yAt(x, z) + lift;
  const center = [x, cy, z];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const p = (a) => {
      const px = x + Math.cos(a) * radius;
      const pz = z + Math.sin(a) * radius;
      return [px, yAt(px, pz) + lift, pz];
    };
    buf.tri(center, p(a0), p(a1));
  }
}

function turnAngle(pts, i) {
  if (i <= 0 || i >= pts.length - 1) return Math.PI;
  const ax = pts[i][0] - pts[i - 1][0];
  const az = pts[i][1] - pts[i - 1][1];
  const bx = pts[i + 1][0] - pts[i][0];
  const bz = pts[i + 1][1] - pts[i][1];
  const la = Math.hypot(ax, az) || 1;
  const lb = Math.hypot(bx, bz) || 1;
  const dot = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)));
  return Math.acos(dot);
}

function paintCarriageway(asphalt, concrete, curb, white, yellow, pts, profile, yAt) {
  const chain = buildMiters(pts);
  const half = profile.asphalt / 2;
  const curbOuter = half + profile.curb;
  const walkOuter = curbOuter + profile.walk;
  const shoulderOuter = walkOuter + (profile.shoulder || 0);
  ribbon(asphalt, chain, -half, half, yAt, SURFACE.asphalt);
  if (profile.curb > 0.05) {
    vertical(curb, chain, half, yAt, SURFACE.asphalt, SURFACE.curb);
    vertical(curb, chain, -half, yAt, SURFACE.asphalt, SURFACE.curb);
    ribbon(curb, chain, half, curbOuter, yAt, SURFACE.curb);
    ribbon(curb, chain, -curbOuter, -half, yAt, SURFACE.curb);
  }
  if (profile.walk > 0.2) {
    ribbon(concrete, chain, curbOuter, walkOuter, yAt, SURFACE.walk);
    ribbon(concrete, chain, -walkOuter, -curbOuter, yAt, SURFACE.walk);
  }
  if (profile.shoulder > 0.2) {
    ribbon(concrete, chain, walkOuter, shoulderOuter, yAt, SURFACE.asphalt + 0.01);
    ribbon(concrete, chain, -shoulderOuter, -walkOuter, yAt, SURFACE.asphalt + 0.01);
  }
  if (profile.edge) {
    marking(white, chain, half - 0.32, 0.14, yAt, SURFACE.mark);
    marking(white, chain, -(half - 0.32), 0.14, yAt, SURFACE.mark);
  }
  if (profile.center === 'double') {
    marking(yellow, chain, 0.18, 0.12, yAt, SURFACE.mark);
    marking(yellow, chain, -0.18, 0.12, yAt, SURFACE.mark);
  } else if (profile.center === 'single') {
    marking(yellow, chain, 0, 0.08, yAt, SURFACE.mark, { period: 9, length: 3.2 });
  }
  if (profile.lanes >= 2) {
    const lane = half * 0.5;
    marking(white, chain, lane, 0.06, yAt, SURFACE.mark, { period: 8, length: 2.6 });
    marking(white, chain, -lane, 0.06, yAt, SURFACE.mark, { period: 8, length: 2.6 });
  }
  return chain;
}

function crosswalk(white, x, z, dx, dz, half, yAt) {
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const nx = -uz;
  const nz = ux;
  const bars = Math.max(4, Math.floor((half * 2) / 0.85));
  for (let i = 0; i < bars; i++) {
    const t = (i + 0.5) / bars - 0.5;
    const cx = x + nx * t * half * 2;
    const cz = z + nz * t * half * 2;
    const along = 0.42;
    const across = half * 2 / bars * 0.55;
    const y = yAt(cx, cz) + SURFACE.mark;
    const p = (da, dc) => [cx + ux * da + nx * dc, y, cz + uz * da + nz * dc];
    white.quad(p(-along, -across), p(along, -across), p(along, across), p(-along, across));
  }
}

export function buildTransport(data, yAt, materials) {
  const group = new THREE.Group();
  group.name = 'transport';
  const asphalt = new MeshBuf();
  const concrete = new MeshBuf();
  const curb = new MeshBuf();
  const white = new MeshBuf();
  const yellow = new MeshBuf();
  const pathBuf = new MeshBuf();
  const ballast = new MeshBuf();
  const steel = new MeshBuf();
  const junctions = new Map();

  const touch = (x, z, profile, sharp) => {
    const key = `${Math.round(x / 8)}:${Math.round(z / 8)}`;
    let cell = junctions.get(key);
    if (!cell) {
      cell = { x: 0, z: 0, n: 0, r: 0, walk: 0, sharp: false };
      junctions.set(key, cell);
    }
    cell.x += x;
    cell.z += z;
    cell.n += 1;
    cell.r = Math.max(cell.r, profile.asphalt / 2 + 1.2);
    cell.walk = Math.max(cell.walk, corridorHalf(profile) + 0.8);
    cell.sharp = cell.sharp || sharp;
  };

  for (const road of data.roads || []) {
    if (!road.pts || road.pts.length < 2) continue;
    const profile = roadProfile(road);
    const dense = densify(road.pts, 7);
    if (dense.length < 2) continue;
    const grown = extendEnds(dense, Math.min(8, profile.asphalt * 0.45));
    paintCarriageway(asphalt, concrete, curb, white, yellow, grown, profile, yAt);
    touch(dense[0][0], dense[0][1], profile, true);
    touch(dense[dense.length - 1][0], dense[dense.length - 1][1], profile, true);
    for (let i = 1; i < dense.length - 1; i++) {
      if (turnAngle(dense, i) > 0.55) touch(dense[i][0], dense[i][1], profile, true);
    }
  }

  for (const cell of junctions.values()) {
    if (cell.n < 2 && !cell.sharp) continue;
    const x = cell.x / cell.n;
    const z = cell.z / cell.n;
    if (cell.walk > cell.r + 0.4) disc(concrete, x, z, cell.walk, yAt, SURFACE.walk - 0.02);
    disc(asphalt, x, z, cell.r, yAt, SURFACE.asphalt - 0.012);
  }

  for (const path of data.paths || []) {
    if (!path.pts || path.pts.length < 2) continue;
    const width = Math.max(path.w || 1.6, 2.15);
    const dense = densify(path.pts, 5);
    if (dense.length < 2) continue;
    ribbon(pathBuf, buildMiters(extendEnds(dense, 0.6)), -width / 2, width / 2, yAt, SURFACE.path);
  }

  const ties = [];
  const poles = [];
  for (const line of data.rail || []) {
    if (!line.pts || line.pts.length < 2) continue;
    const dense = densify(line.pts, line.cls === 'platform' ? 4 : 8);
    if (dense.length < 2) continue;
    if (line.cls === 'platform') {
      ribbon(concrete, buildMiters(dense), -1.7, 1.7, yAt, SURFACE.platform);
      continue;
    }
    const main = line.cls === 'rail';
    const half = main ? 4.1 : 2.3;
    const chain = buildMiters(dense);
    ribbon(ballast, chain, -half, half, yAt, SURFACE.ballast);
    const gauge = main ? 0.75 : 0.62;
    ribbon(steel, chain, gauge - 0.06, gauge + 0.06, yAt, SURFACE.rail);
    ribbon(steel, chain, -gauge - 0.06, -gauge + 0.06, yAt, SURFACE.rail);
    if (!main) continue;
    let nextTie = 0;
    let nextPole = 12;
    for (let i = 1; i < dense.length; i++) {
      const a = dense[i - 1];
      const b = dense[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let walked = 0;
      while (walked + nextTie <= len) {
        const t = (walked + nextTie) / len;
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[1] + (b[1] - a[1]) * t;
        const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
        ties.push([x, yAt(x, z) + 0.08, z, yaw]);
        if (ties.length > 4500) break;
        walked += nextTie;
        nextTie = 2.4;
      }
      nextTie = Math.max(0, nextTie - (len - walked));
      walked = 0;
      while (walked + nextPole <= len && poles.length < 280) {
        const t = (walked + nextPole) / len;
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[1] + (b[1] - a[1]) * t;
        const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
        poles.push([x, yAt(x, z), z, yaw]);
        walked += nextPole;
        nextPole = 48;
      }
      nextPole = Math.max(0, nextPole - (len - walked));
      if (ties.length > 4500) break;
    }
  }

  const arterials = (data.roads || []).filter((r) => roadProfile(r).kind === 'arterial');
  let crosses = 0;
  for (const road of data.roads || []) {
    const profile = roadProfile(road);
    if (profile.kind === 'arterial' || profile.kind === 'highway') continue;
    if (!road.pts || road.pts.length < 2 || crosses > 28) continue;
    const ends = [road.pts[0], road.pts[road.pts.length - 1]];
    for (const end of ends) {
      let best = null;
      let bestD = 11;
      for (const art of arterials) {
        for (let i = 1; i < art.pts.length; i++) {
          const a = art.pts[i - 1];
          const b = art.pts[i];
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const l2 = dx * dx + dz * dz || 1;
          let t = ((end[0] - a[0]) * dx + (end[1] - a[1]) * dz) / l2;
          t = Math.max(0, Math.min(1, t));
          const x = a[0] + dx * t;
          const z = a[1] + dz * t;
          const d = Math.hypot(end[0] - x, end[1] - z);
          if (d < bestD) {
            bestD = d;
            best = { x, z, dx, dz, half: roadProfile(art).asphalt / 2 };
          }
        }
      }
      if (best) {
        crosswalk(white, best.x, best.z, best.dx, best.dz, best.half, yAt);
        crosses += 1;
        break;
      }
    }
  }

  const add = (buf, material, shadows = false) => {
    const geo = buf.toGeometry();
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.castShadow = shadows;
    group.add(mesh);
  };
  for (const mat of [materials.asphalt, materials.concrete, materials.curb, materials.paint, materials.yellow, materials.gravel, materials.ballast]) {
    mat.side = THREE.DoubleSide;
  }
  add(concrete, materials.concrete);
  add(asphalt, materials.asphalt);
  add(curb, materials.curb, true);
  add(pathBuf, materials.gravel);
  add(ballast, materials.ballast);
  add(steel, materials.steel);
  add(white, materials.paint);
  add(yellow, materials.yellow);

  if (ties.length) {
    const geo = new THREE.BoxGeometry(2.35, 0.12, 0.28);
    const mesh = new THREE.InstancedMesh(geo, materials.trunk, ties.length);
    const dummy = new THREE.Object3D();
    ties.forEach((t, i) => {
      dummy.position.set(t[0], t[1], t[2]);
      dummy.rotation.y = t[3];
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (poles.length) {
    const geo = new THREE.CylinderGeometry(0.12, 0.16, 8.5, 6);
    geo.translate(0, 4.25, 0);
    const mesh = new THREE.InstancedMesh(geo, materials.steel, poles.length);
    const dummy = new THREE.Object3D();
    poles.forEach((t, i) => {
      dummy.position.set(t[0], t[1], t[2]);
      dummy.rotation.y = t[3];
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = true;
    group.add(mesh);
  }

  return { group };
}
