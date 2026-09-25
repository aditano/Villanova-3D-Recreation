import * as THREE from 'three';
import { footprintBase, pointInPoly, ringCentroid } from './geo.js';
import { massingFor, resolveBuilding } from './height-rules.js';
import {
  MeshBuf,
  addBox,
  appendGeometry,
  chamferRing,
  edgesOf,
  footprintSpan,
  framePoint,
  insetRing,
  orientedFrame,
  shapeCap,
  wallQuad,
} from './meshlib.js';
import { FAMILIES } from './textures.js';

const SHADE_LOW = [0.76, 0.74, 0.7];
const SHADE_HIGH = [1, 0.99, 0.97];
const NAVY = new THREE.Color(0x00205b);
const SEAT_WHITE = new THREE.Color(0xf4f4f0);

function shapeAreaXZ(ring) {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function classify(b) {
  const mass = massingFor(b.n);
  if (mass) return mass.kind;
  const name = (b.n || '').toLowerCase();
  if (b.fam === 'arena' || name.includes('arena') || name.includes('pavilion')) return 'arena';
  if (name.includes('garage') || name.includes('parking') || b.fam === 'concrete') return 'garage';
  if (b.h <= 6.5) return 'house';
  if (b.fam === 'brick') return 'dorm';
  if (b.h >= 11) return 'hall';
  return 'block';
}

const FAMILY_ALIAS = {
  gothic: 'limestone',
  library: 'limestone',
  center: 'stone',
  stone: 'stone',
  brick: 'brick',
  glass: 'glass',
  arena: 'arena',
  station: 'station',
  concrete: 'concrete',
};

function familyName(b, kind) {
  const mass = massingFor(b.n);
  if (mass?.family && FAMILIES[mass.family]) return mass.family;
  if (kind === 'church' || kind === 'gothic' || kind === 'library') return 'limestone';
  if (kind === 'pavilion' || kind === 'arena') return 'arena';
  if (kind === 'station') return 'station';
  if (kind === 'garage') return 'concrete';
  if (kind === 'law') return 'glass';
  const aliased = FAMILY_ALIAS[b.fam];
  if (aliased && FAMILIES[aliased]) return aliased;
  if (FAMILIES[b.fam]) return b.fam;
  return 'stone';
}

function band(buf, edges, y0, y1, push0, push1) {
  for (const edge of edges) {
    wallQuad(buf, edge, y0, y1, push0, push1, 0, edge.len / 1.6, 0, 1);
  }
}

function shadeWalls(buf, edges, y0, y1, spec) {
  const v1 = Math.max(0.2, (y1 - y0) / spec.floor);
  for (const edge of edges) {
    wallQuad(buf, edge, y0, y1, 0, 0, 0, edge.len / spec.bay, 0, v1, [SHADE_LOW, SHADE_LOW, SHADE_HIGH, SHADE_HIGH]);
  }
}

function collectWindows(edge, y0, y1, spec, acc, stride) {
  if (edge.len < 2.3 || acc.glass.length > 11000) return;
  const floors = Math.max(1, Math.floor((y1 - y0) / spec.floor + 0.2));
  const bays = Math.max(1, Math.floor(edge.len / spec.bay));
  const step = Math.max(1, stride | 0);
  const pointed = !!spec.pointed;
  for (let f = 0; f < floors; f++) {
    const base = y0 + f * spec.floor;
    if (base + spec.floor * 0.84 > y1 + 0.08) break;
    const gw = Math.min(spec.bay * spec.winW, edge.len * 0.72);
    const gh = spec.floor * (pointed ? 0.62 : 0.5);
    const gy = base + spec.floor * (pointed ? 0.56 : 0.52);
    const sillY = base + spec.floor * (pointed ? 0.2 : 0.24);
    const headY = gy + gh * 0.5 + 0.1;
    for (let bay = 0; bay < bays; bay += step) {
      if (acc.glass.length > 11000) return;
      const t = (bay + 0.5) / bays;
      const along = t * edge.len;
      if (along < 0.7 || edge.len - along < 0.7) continue;
      const x = edge.ax + edge.dx * along + edge.nx * 0.02;
      const z = edge.az + edge.dz * along + edge.nz * 0.02;
      const yaw = Math.atan2(edge.nx, edge.nz);
      const out = 0.52;
      // Walls are solid quads. Keep the pane on the outside face, inside the projecting frame.
      const pane = 0.14;
      acc.glass.push({
        x: x + edge.nx * pane,
        y: gy,
        z: z + edge.nz * pane,
        yaw,
        sx: gw * 0.76,
        sy: gh * 0.9,
        sz: 0.12,
      });
      acc.sill.push({
        x: x + edge.nx * out,
        y: sillY,
        z: z + edge.nz * out,
        yaw,
        sx: gw + 0.7,
        sy: 0.3,
        sz: 0.82,
      });
      acc.sill.push({
        x: x + edge.nx * (out - 0.04),
        y: headY,
        z: z + edge.nz * (out - 0.04),
        yaw,
        sx: gw + 0.55,
        sy: pointed ? 0.22 : 0.28,
        sz: 0.68,
      });
      const jamb = gw * 0.46;
      for (const side of [-1, 1]) {
        acc.sill.push({
          x: x + edge.dx * jamb * side + edge.nx * (out - 0.02),
          y: gy,
          z: z + edge.dz * jamb * side + edge.nz * (out - 0.02),
          yaw,
          sx: 0.24,
          sy: gh + 0.42,
          sz: 0.62,
        });
      }
      acc.sill.push({
        x: x + edge.nx * 0.06,
        y: gy,
        z: z + edge.nz * 0.06,
        yaw,
        sx: 0.09,
        sy: gh * 0.88,
        sz: 0.22,
      });
      if (pointed) {
        acc.sill.push({
          x: x + edge.nx * out,
          y: headY + 0.46,
          z: z + edge.nz * out,
          yaw,
          sx: gw * 0.58,
          sy: 0.38,
          sz: 0.52,
        });
        acc.sill.push({
          x: x + edge.nx * (out + 0.02),
          y: headY + 0.86,
          z: z + edge.nz * (out + 0.02),
          yaw,
          sx: gw * 0.26,
          sy: 0.46,
          sz: 0.4,
        });
      }
    }
  }
}

function punch(edges, y0, y1, spec, acc, stride) {
  for (const edge of edges) collectWindows(edge, y0, y1, spec, acc, stride);
}

function addPiers(trim, edges, y0, y1, spec) {
  const span = Math.max(0.4, y1 - y0);
  for (const edge of edges) {
    if (edge.len < spec.bay * 2.4) continue;
    const bays = Math.max(2, Math.floor(edge.len / spec.bay));
    const every = bays > 12 ? 3 : 2;
    const yaw = Math.atan2(edge.nx, edge.nz);
    for (let bay = every; bay < bays; bay += every) {
      const along = (bay / bays) * edge.len;
      if (along < 1.1 || edge.len - along < 1.1) continue;
      const x = edge.ax + edge.dx * along + edge.nx * 0.34;
      const z = edge.az + edge.dz * along + edge.nz * 0.34;
      addBox(trim, x, (y0 + y1) / 2, z, 0.36, span, 0.5, yaw);
    }
  }
}

function addQuoins(trim, edges, y0, y1) {
  const span = Math.max(0.4, y1 - y0);
  const seen = new Set();
  for (const edge of edges) {
    if (edge.len < 2.2) continue;
    const yaw = Math.atan2(edge.nx, edge.nz);
    for (const along of [0.62, Math.max(0.62, edge.len - 0.62)]) {
      const x = edge.ax + edge.dx * along + edge.nx * 0.26;
      const z = edge.az + edge.dz * along + edge.nz * 0.26;
      const key = `${Math.round(x * 2)}:${Math.round(z * 2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      addBox(trim, x, (y0 + y1) / 2, z, 0.78, span * 0.99, 0.52, yaw);
    }
  }
}

function capRoof(membrane, ring, y, inset = 0.45) {
  const inner = insetRing(ring, inset);
  appendGeometry(membrane, shapeCap(inner, y));
}

function addPitched(wall, slate, frame, yEave, rise) {
  const overhang = 1.28;
  const hl = frame.length / 2;
  const hw = frame.width / 2;
  const hip = frame.length / frame.width < 1.35;
  const ridge = hip ? Math.max(0.5, hl - hw) : hl + overhang;
  const yR = yEave + rise;
  const eaveU = hl + overhang;
  const quadUV = [0, 0, (eaveU * 2) / 2.5, 0, (ridge * 2) / 2.5, (hw + overhang) / 2.5, 0, (hw + overhang) / 2.5];
  const slope = (pOuter, sign) => {
    const a = framePoint(frame, -eaveU, pOuter, yEave);
    const b = framePoint(frame, eaveU, pOuter, yEave);
    const c = framePoint(frame, ridge, 0, yR);
    const d = framePoint(frame, -ridge, 0, yR);
    if (sign > 0) slate.quad(b, a, d, c, quadUV);
    else slate.quad(a, b, c, d, quadUV);
  };
  slope(-(hw + overhang), -1);
  slope(hw + overhang, 1);
  const gable = (u, flip) => {
    const l = framePoint(frame, u, -hw, yEave);
    const r = framePoint(frame, u, hw, yEave);
    const t = framePoint(frame, u < 0 ? -ridge : ridge, 0, yR);
    const col = [SHADE_HIGH, SHADE_HIGH, SHADE_HIGH];
    if (flip) wall.tri(r, l, t, null, col);
    else wall.tri(l, r, t, null, col);
  };
  if (hip) {
    const end = (uEave, uRidge) => {
      const eL = framePoint(frame, uEave, -(hw + overhang), yEave);
      const eR = framePoint(frame, uEave, hw + overhang, yEave);
      const t = framePoint(frame, uRidge, 0, yR);
      if (uEave < 0) slate.tri(eL, t, eR);
      else slate.tri(eR, t, eL);
    };
    end(-eaveU, -ridge);
    end(eaveU, ridge);
  } else {
    gable(-hl, false);
    gable(hl, true);
  }
}

function addRibs(trim, edges, y0, y1, spacing) {
  for (const edge of edges) {
    const count = Math.max(1, Math.floor(edge.len / spacing));
    const yaw = Math.atan2(edge.nx, edge.nz);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const along = t * edge.len;
      const x = edge.ax + edge.dx * along + edge.nx * 0.16;
      const z = edge.az + edge.dz * along + edge.nz * 0.16;
      addBox(trim, x, (y0 + y1) / 2, z, 0.16, y1 - y0, 0.28, yaw);
    }
  }
}

/** `y0` and `eave` are absolute elevations. `eave` is the wall top and the roof spring line. */
function stackShell(parts, ring, y0, eave, spec, acc, opts = {}) {
  const { walls, trim } = parts;
  const edges = edgesOf(ring);
  if (edges.length < 3) return null;
  const height = Math.max(0.4, eave - y0);
  const baseH = Math.min(opts.baseH ?? 1.05, Math.max(0.6, height * 0.16));
  const parapet = opts.pitched ? 0 : opts.parapet ?? 1.15;
  const cornice = opts.pitched ? 0 : opts.cornice ?? 0.95;
  const shaftTop = eave - parapet - cornice;
  const shaftBase = y0 + baseH;
  band(trim, edges, y0 - 0.4, shaftBase, 0.05, opts.basePush ?? 0.16);
  shadeWalls(walls, edges, shaftBase, Math.max(shaftBase + 0.4, shaftTop), spec);
  if (!opts.pitched && opts.belts !== false) {
    let y = shaftBase + spec.floor;
    while (y < shaftTop - 0.35) {
      band(trim, edges, y - 0.07, y + 0.06, 0.07, 0.07);
      y += spec.floor;
    }
  }
  if (!opts.pitched) {
    band(trim, edges, shaftTop, shaftTop + cornice, 0.28, opts.cornicePush ?? 1.2);
    shadeWalls(walls, edges, shaftTop + cornice, eave, spec);
  }
  const stride = opts.stride ?? (opts.sparse ? 2 : 1);
  if (opts.windows !== false) punch(edges, shaftBase, shaftTop, spec, acc, stride);
  if (opts.piers) addPiers(trim, edges, shaftBase, shaftTop, spec);
  if (opts.quoins) addQuoins(trim, edges, y0, eave);
  if (opts.ribs) addRibs(trim, edges, shaftBase, eave, opts.ribSpacing ?? 2.5);
  return { edges, shaftBase, shaftTop };
}

function buildStock(b, yAt, parts, acc, kind) {
  const fam = familyName(b, kind);
  const spec = FAMILIES[fam];
  const articulate = kind === 'gothic' || kind === 'hall' || kind === 'dorm' || kind === 'center' || kind === 'block';
  const ring = chamferRing(b.f, kind === 'house' ? 0.48 : b.h > 8 ? 1.05 : 0.62);
  const y0 = footprintBase(b.f, yAt);
  const frame = orientedFrame(ring);
  const footprintArea = Math.abs(shapeAreaXZ(ring));
  const rectangular = footprintArea > frame.length * frame.width * 0.62;
  const pitched =
    rectangular &&
    (kind === 'gothic' || kind === 'house' || kind === 'dorm' || (kind === 'block' && b.h < 11 && frame.width < 22));
  const rise = pitched ? Math.min(5.2, Math.max(2.2, frame.width * 0.26)) : 0;
  const eave = y0 + (pitched ? Math.max(4.2, b.h - rise) : b.h);
  const walls = parts.walls[fam];
  const shell = stackShell({ ...parts, walls }, ring, y0, eave, spec, acc, {
    pitched,
    ribs: kind === 'arena' || kind === 'garage',
    sparse: kind === 'arena' || kind === 'garage',
    belts: kind !== 'arena' && kind !== 'garage',
    stride: kind === 'garage' ? 2 : 1,
    ribSpacing: kind === 'garage' ? 4.8 : 2.6,
    piers: articulate,
    quoins: articulate,
    cornicePush: kind === 'gothic' || kind === 'hall' ? 1.45 : 1.15,
    basePush: 0.28,
    baseH: 1.2,
  });
  if (pitched) addPitched(walls, parts.slate, frame, eave, rise);
  else {
    capRoof(parts.membrane, ring, eave + 0.06, -1.12);
    if (shell?.edges) band(parts.trim, shell.edges, eave - 0.2, eave + 0.2, 0.1, 1.05);
    if (b.h >= 9 && frame.length > 16) {
      const [cx, cz] = ringCentroid(ring);
      addBox(parts.mech, cx, eave + 0.7, cz, Math.min(8, frame.length * 0.18), 1.15, Math.min(5, frame.width * 0.22), 0.4);
    }
  }
}

function buildLibrary(b, yAt, parts, acc) {
  const fam = familyName(b, 'library');
  const spec = FAMILIES[fam];
  const ring = chamferRing(b.f, 0.9);
  const y0 = footprintBase(b.f, yAt);
  const split = y0 + Math.max(6.5, b.h * 0.58);
  const walls = parts.walls[fam];
  const edges = edgesOf(ring);
  stackShell({ ...parts, walls }, ring, y0, split, spec, acc, {
    parapet: 0.2,
    cornice: 0.55,
    cornicePush: 1.15,
    basePush: 0.32,
    piers: true,
    quoins: true,
  });
  const upper = insetRing(ring, 2.8);
  stackShell({ ...parts, walls }, upper, split, y0 + b.h, spec, acc, {
    baseH: 0.15,
    parapet: 0.7,
    cornice: 0.42,
    cornicePush: 0.7,
    quoins: true,
  });
  capRoof(parts.membrane, upper, y0 + b.h + 0.05, -0.85);
  let south = edges[0];
  for (const edge of edges) {
    if ((edge.az + edge.bz) / 2 > (south.az + south.bz) / 2) south = edge;
  }
  if (south && south.len > 8) {
    const cols = Math.min(6, Math.max(3, Math.floor(south.len / 6)));
    const yaw = Math.atan2(south.nx, south.nz);
    for (let i = 1; i <= cols; i++) {
      const along = (i / (cols + 1)) * south.len;
      const x = south.ax + south.dx * along + south.nx * 1.5;
      const z = south.az + south.dz * along + south.nz * 1.5;
      addBox(parts.trim, x, y0 + 2.6, z, 0.62, 4.6, 0.62, yaw);
    }
    wallQuad(parts.trim, south, y0 + 4.85, y0 + 5.45, 1.15, 1.7, 0, south.len / 1.4, 0, 1);
  }
}

function buildLaw(b, yAt, parts, acc) {
  const spec = FAMILIES.glass;
  const ring = chamferRing(b.f, 0.7);
  const y0 = footprintBase(b.f, yAt);
  const walls = parts.walls.glass;
  stackShell({ ...parts, walls }, ring, y0, y0 + b.h, spec, acc, {
    baseH: 1.45,
    basePush: 0.22,
    belts: false,
    cornicePush: 0.2,
    parapet: 0.45,
  });
  const lid = insetRing(ring, -1.55);
  appendGeometry(parts.membrane, shapeCap(lid, y0 + b.h + 0.12));
  const [cx, cz] = ringCentroid(ring);
  addBox(parts.mech, cx, y0 + b.h + 1.3, cz, 14, 2.2, 8, 0.2);
}

function rectRing(frame, halfL, halfW) {
  const pts = [-1, 1].flatMap((su) => [-1, 1].map((sp) => {
    const [x, , z] = framePoint(frame, su * halfL, sp * halfW, 0);
    return [x, z];
  }));
  // order around the rectangle
  const ordered = [
    framePoint(frame, -halfL, -halfW, 0),
    framePoint(frame, halfL, -halfW, 0),
    framePoint(frame, halfL, halfW, 0),
    framePoint(frame, -halfL, halfW, 0),
  ].map(([x, , z]) => [x, z]);
  ordered.push([ordered[0][0], ordered[0][1]]);
  void pts;
  return ordered;
}

function buildChurch(b, yAt, parts, acc) {
  const spec = { ...FAMILIES.limestone, bay: 3.6, floor: 5.6, winW: 0.4, winH: 0.62, pointed: true };
  const mass = massingFor(b.n);
  const ring = chamferRing(b.f, 0.55);
  const y0 = footprintBase(b.f, yAt);
  const nave = mass.nave;
  const ridge = mass.clerestory;
  const walls = parts.walls.limestone;
  const edges = edgesOf(ring);
  stackShell({ ...parts, walls }, ring, y0, y0 + nave, spec, acc, {
    pitched: true,
    belts: false,
    baseH: 1.35,
    basePush: 0.32,
    quoins: true,
  });
  const frame = orientedFrame(ring);
  const overhang = 1.15;
  const hl = frame.length / 2;
  const hw = frame.width / 2;
  const tower = 4.6;
  const yE = y0 + nave;
  const yR = y0 + nave + Math.min(9.2, Math.max(ridge - nave, frame.width * 0.2));
  const slopeSide = (pSign) => {
    for (const [u0, u1] of [[-hl - overhang, -tower], [tower, hl + overhang]]) {
      const p = pSign * (hw + overhang);
      const a = framePoint(frame, u0, p, yE);
      const b = framePoint(frame, u1, p, yE);
      const c = framePoint(frame, u1, 0, yR);
      const d = framePoint(frame, u0, 0, yR);
      if (pSign > 0) parts.slate.quad(b, a, d, c);
      else parts.slate.quad(a, b, c, d);
    }
  };
  slopeSide(-1);
  slopeSide(1);
  for (const u of [-hl, hl]) {
    const l = framePoint(frame, u, -hw, yE);
    const r = framePoint(frame, u, hw, yE);
    const t = framePoint(frame, u, 0, yR);
    walls.tri(u < 0 ? l : r, u < 0 ? r : l, t, null, [SHADE_HIGH, SHADE_HIGH, SHADE_HIGH]);
  }
  for (const edge of edges) {
    if (edge.len < 8) continue;
    const count = Math.max(2, Math.floor(edge.len / 7.2));
    const yaw = Math.atan2(edge.nx, edge.nz);
    for (let i = 0; i < count; i++) {
      const along = ((i + 0.5) / count) * edge.len;
      const x = edge.ax + edge.dx * along + edge.nx * 0.7;
      const z = edge.az + edge.dz * along + edge.nz * 0.7;
      addBox(parts.trim, x, y0 + nave * 0.48, z, 1.45, nave * 0.9, 3.4, yaw);
      addBox(parts.trim, x + edge.nx * 0.4, y0 + nave * 0.94, z + edge.nz * 0.4, 0.62, 2.4, 0.85, yaw);
    }
  }
  const [cx, cz] = ringCentroid(ring);
  const towerRing = rectRing({ ...frame, cx, cz, ux: frame.ux, uz: frame.uz, px: frame.px, pz: frame.pz }, 3.5, 3.5);
  const tEdges = edgesOf(towerRing);
  shadeWalls(walls, tEdges, y0 + nave - 0.2, y0 + 23.2, FAMILIES.limestone);
  band(parts.trim, tEdges, y0 + 22.4, y0 + 23.5, 0.18, 0.42);
  const tipY = y0 + mass.tip;
  const baseY = y0 + 23.4;
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    corners.push([cx + Math.cos(a) * 3.15, baseY, cz + Math.sin(a) * 3.15]);
  }
  const tip = [cx, tipY, cz];
  for (let i = 0; i < 8; i++) {
    const a = corners[i];
    const c = corners[(i + 1) % 8];
    parts.spire.tri(a, c, tip);
  }
  addBox(parts.trim, cx, tipY + 0.85, cz, 0.18, 1.7, 0.18);
  addBox(parts.trim, cx, tipY + 1.45, cz, 0.95, 0.16, 0.16);
  let south = null;
  for (const edge of edges) {
    const mz = (edge.az + edge.bz) / 2;
    if (!south || mz > south.mz) south = { edge, mz };
  }
  if (south && south.edge.len > 6) {
    const edge = south.edge;
    const yaw = Math.atan2(edge.nx, edge.nz);
    const mid = edge.len * 0.5;
    const doorX = edge.ax + edge.dx * mid + edge.nx * 1.7;
    const doorZ = edge.az + edge.dz * mid + edge.nz * 1.7;
    addBox(parts.trim, doorX - edge.dx * 2.4, y0 + 3.4, doorZ - edge.dz * 2.4, 0.85, 6.8, 0.9, yaw);
    addBox(parts.trim, doorX + edge.dx * 2.4, y0 + 3.4, doorZ + edge.dz * 2.4, 0.85, 6.8, 0.9, yaw);
    addBox(parts.trim, doorX, y0 + 7.1, doorZ, 5.6, 0.5, 0.85, yaw);
    addBox(parts.trim, doorX, y0 + 8.4, doorZ, 2.2, 2.2, 0.7, yaw);
    const rose = new THREE.TorusGeometry(1.85, 0.18, 8, 22);
    rose.rotateY(Math.atan2(edge.nx, edge.nz));
    rose.translate(doorX + edge.nx * 0.35, y0 + 11.6, doorZ + edge.nz * 0.35);
    appendGeometry(parts.trim, rose);
    for (const spoke of [0, Math.PI / 2]) {
      const bar = new THREE.BoxGeometry(3.3, 0.12, 0.12);
      bar.rotateZ(spoke);
      bar.rotateY(yaw);
      bar.translate(doorX + edge.nx * 0.4, y0 + 11.6, doorZ + edge.nz * 0.4);
      appendGeometry(parts.trim, bar);
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const px = cx + Math.cos(a) * 4.15;
    const pz = cz + Math.sin(a) * 4.15;
    addBox(parts.trim, px, y0 + 24.3, pz, 0.7, 2.3, 0.7);
    parts.spire.tri([px - 0.45, y0 + 25.4, pz - 0.45], [px + 0.45, y0 + 25.4, pz - 0.45], [px, y0 + 27.1, pz]);
    parts.spire.tri([px + 0.45, y0 + 25.4, pz - 0.45], [px + 0.45, y0 + 25.4, pz + 0.45], [px, y0 + 27.1, pz]);
    parts.spire.tri([px + 0.45, y0 + 25.4, pz + 0.45], [px - 0.45, y0 + 25.4, pz + 0.45], [px, y0 + 27.1, pz]);
    parts.spire.tri([px - 0.45, y0 + 25.4, pz + 0.45], [px - 0.45, y0 + 25.4, pz - 0.45], [px, y0 + 27.1, pz]);
  }
}

function buildPavilion(b, yAt, parts, acc) {
  const spec = FAMILIES.arena;
  const mass = massingFor(b.n);
  const ring = chamferRing(b.f, 0.4);
  const y0 = footprintBase(b.f, yAt);
  const walls = parts.walls.arena;
  const edges = edgesOf(ring);
  const wallTop = Math.max(14, b.h - mass.arch * 0.55);
  stackShell({ ...parts, walls }, ring, y0, y0 + wallTop, spec, acc, {
    ribs: true,
    sparse: true,
    belts: false,
    windows: false,
    parapet: 0.25,
    cornice: 0.2,
    ribSpacing: 2.35,
  });
  const frame = orientedFrame(ring);
  const strips = 8;
  const hl = frame.length / 2 + 0.8;
  const hw = frame.width / 2 + 0.6;
  for (let i = 0; i < strips; i++) {
    const t0 = -0.5 + i / strips;
    const t1 = -0.5 + (i + 1) / strips;
    const arch = (t) => Math.sin((t + 0.5) * Math.PI);
    const yA = y0 + wallTop + mass.arch * arch(t0);
    const yB = y0 + wallTop + mass.arch * arch(t1);
    const u0 = t0 * frame.length;
    const u1 = t1 * frame.length;
    parts.membrane.quad(
      framePoint(frame, u0, -hw, yA),
      framePoint(frame, u1, -hw, yB),
      framePoint(frame, u1, hw, yB),
      framePoint(frame, u0, hw, yA),
      [i / strips, 0, (i + 1) / strips, 0, (i + 1) / strips, hw / 4, i / strips, hw / 4],
    );
  }
  void hl;
  const [ex, , ez] = framePoint(frame, -frame.length / 2 - 2.2, 0, 0);
  const yaw = Math.atan2(frame.ux, frame.uz);
  addBox(parts.glass, ex, y0 + 4.2, ez, 8, 7.2, 14, yaw);
}

function buildStation(b, yAt, parts, acc, data) {
  buildStock(b, yAt, parts, acc, 'house');
  const [cx, cz] = ringCentroid(b.f);
  const y0 = footprintBase(b.f, yAt);
  let best = null;
  let bestD = 1e9;
  for (const line of data.rail || []) {
    if (!line.pts || line.pts.length < 2 || line.cls === 'platform') continue;
    for (let i = 1; i < line.pts.length; i++) {
      const a = line.pts[i - 1];
      const c = line.pts[i];
      const dx = c[0] - a[0];
      const dz = c[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      let t = ((cx - a[0]) * dx + (cz - a[1]) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const x = a[0] + dx * t;
      const z = a[1] + dz * t;
      const d = Math.hypot(cx - x, cz - z);
      if (d < bestD) {
        bestD = d;
        const len = Math.hypot(dx, dz) || 1;
        best = { x, z, dx: dx / len, dz: dz / len };
      }
    }
  }
  if (!best) return;
  const side = Math.sign((cx - best.x) * best.dz - (cz - best.z) * best.dx) || 1;
  const nx = -best.dz * side;
  const nz = best.dx * side;
  const yaw = Math.atan2(best.dx, best.dz);
  const px = best.x + nx * 3.4;
  const pz = best.z + nz * 3.4;
  const py = yAt(px, pz) + 0.9;
  addBox(parts.concrete, px, py, pz, 72, 0.28, 4.4, yaw);
  for (let i = -3; i <= 3; i++) {
    const x = px + best.dx * i * 10;
    const z = pz + best.dz * i * 10;
    addBox(parts.trim, x, py + 2.5, z, 0.22, 4.6, 0.22);
  }
  addBox(parts.membrane, px, py + 4.7, pz, 68, 0.12, 5.2, yaw);
}

function buildBowl(stadium, yAt, parts) {
  if (!stadium?.outer || stadium.outer.length < 4 || !stadium.inner || stadium.inner.length < 4) return;
  const inner = stadium.inner;
  const frame = orientedFrame(inner);
  const y0 = footprintBase(inner, yAt);
  const fieldY = y0 + 0.2;
  const hl = frame.length / 2;
  const hw = frame.width / 2;
  parts.field.quad(
    framePoint(frame, -hl, -hw, fieldY),
    framePoint(frame, hl, -hw, fieldY),
    framePoint(frame, hl, hw, fieldY),
    framePoint(frame, -hl, hw, fieldY),
    [0, 0, 1, 0, 1, 1, 0, 1],
  );
  const edges = edgesOf(inner);
  const rows = 26;
  const tread = 0.8;
  const rise = 0.46;
  for (const edge of edges) {
    for (let r = 0; r < rows; r++) {
      const push0 = 1.1 + r * tread;
      const push1 = push0 + tread * 0.92;
      const ySeat = fieldY + 1.5 + r * rise;
      const navyBand = Math.floor(r / 3) % 2 === 0;
      const stripe = navyBand ? [NAVY.r, NAVY.g, NAVY.b] : [SEAT_WHITE.r, SEAT_WHITE.g, SEAT_WHITE.b];
      wallQuad(parts.seats, edge, ySeat - rise, ySeat, push0, push0, 0, edge.len / 6, 0, 1, stripe);
      wallQuad(parts.seats, edge, ySeat, ySeat + 0.08, push0, push1, 0, edge.len / 6, 0, 1, stripe);
    }
    const back = 1.1 + rows * tread;
    const top = fieldY + 1.5 + rows * rise;
    wallQuad(parts.fascia, edge, top, top + 2.4, back, back + 0.9, 0, edge.len / 8, 0, 1);
  }
  const outerEdges = edgesOf(stadium.outer);
  const lip = fieldY + 1.5 + rows * rise + 1.2;
  for (const edge of outerEdges) {
    wallQuad(parts.fascia, edge, y0 - 0.3, lip, 0, 0.15, 0, edge.len / 6, 0, (lip - y0) / 4, null);
    wallQuad(parts.concrete, edge, lip - 0.2, lip, 0.15, 3.2, 0, edge.len / 4, 0, 1);
  }
  const goalYaw = Math.atan2(frame.ux, frame.uz);
  for (const end of [-1, 1]) {
    const u = end * (hl - 1.6);
    for (const side of [-1, 1]) {
      const [x, , z] = framePoint(frame, u, side * 2.82, 0);
      addBox(parts.mech, x, fieldY + 5.6, z, 0.16, 11.2, 0.16, goalYaw);
    }
    const [bx, , bz] = framePoint(frame, u, 0, 0);
    addBox(parts.mech, bx, fieldY + 3.15, bz, 0.14, 0.14, 5.7, goalYaw);
  }
  const span = footprintSpan(stadium.outer);
  const corners = [
    [span.minX, span.minZ],
    [span.maxX, span.minZ],
    [span.maxX, span.maxZ],
    [span.minX, span.maxZ],
  ];
  for (const [x, z] of corners) {
    const y = yAt(x, z);
    addBox(parts.mech, x, y + 16, z, 0.7, 32, 0.7);
    addBox(parts.mech, x, y + 31.2, z, 6.5, 0.5, 2.2);
  }
  const [px, , pz] = framePoint(frame, 0, hw + 8, 0);
  addBox(parts.fascia, px, fieldY + 16, pz, 28, 5.5, 8, goalYaw);
}

function meshFrom(buf, material, { cast = true, receive = true } = {}) {
  const geo = buf.toGeometry();
  if (!geo) return null;
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function makeInstances(geo, material, items) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    p.set(it.x, it.y, it.z);
    q.setFromAxisAngle(up, it.yaw || 0);
    s.set(it.sx, it.sy, it.sz);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildStructures(data, yAt, materials) {
  const group = new THREE.Group();
  group.name = 'structures';
  const parts = {
    walls: {},
    trim: new MeshBuf(),
    membrane: new MeshBuf(),
    slate: new MeshBuf(),
    mech: new MeshBuf(),
    seats: new MeshBuf(),
    fascia: new MeshBuf(),
    field: new MeshBuf(),
    glass: new MeshBuf(),
    concrete: new MeshBuf(),
    spire: new MeshBuf(),
  };
  for (const name of Object.keys(FAMILIES)) parts.walls[name] = new MeshBuf();
  const acc = { glass: [], sill: [] };
  const blockers = [];
  const buildings = [...(data.buildings || [])].sort((a, b) => {
    const named = (b.n ? 1 : 0) - (a.n ? 1 : 0);
    if (named) return named;
    const ac = a.f?.length ? ringCentroid(a.f) : [0, 0];
    const bc = b.f?.length ? ringCentroid(b.f) : [0, 0];
    return ac[0] * ac[0] + ac[1] * ac[1] - (bc[0] * bc[0] + bc[1] * bc[1]);
  });

  for (const b of buildings) {
    if (!b.f || b.f.length < 4) continue;
    const resolved = resolveBuilding(b);
    const building = { ...b, h: resolved.h, fam: resolved.fam, spire: resolved.spire || b.spire || 0 };
    blockers.push({ f: building.f, h: building.h });
    const kind = classify(building);
    try {
      if (kind === 'church') buildChurch(building, yAt, parts, acc);
      else if (kind === 'pavilion') buildPavilion(building, yAt, parts, acc);
      else if (kind === 'station') buildStation(building, yAt, parts, acc, data);
      else if (kind === 'library') buildLibrary(building, yAt, parts, acc);
      else if (kind === 'law') buildLaw(building, yAt, parts, acc);
      else buildStock(building, yAt, parts, acc, kind);
    } catch (err) {
      console.warn('Building failed', b.n || b.id, err);
    }
  }

  try {
    buildBowl(data.stadium, yAt, parts);
  } catch (err) {
    console.warn('Stadium failed', err);
  }

  for (const [name, buf] of Object.entries(parts.walls)) {
    const mesh = meshFrom(buf, materials.families[name]);
    if (mesh) {
      mesh.name = `walls:${name}`;
      group.add(mesh);
    }
  }
  const staticMeshes = [
    [parts.trim, materials.trim, { name: 'trim' }],
    [parts.membrane, materials.roof, { name: 'roof-membrane' }],
    [parts.slate, materials.slate, { name: 'roof-slate' }],
    [parts.mech, materials.steel, { name: 'mech' }],
    [parts.seats, materials.seat, { name: 'seats' }],
    [parts.fascia, materials.fascia, { name: 'fascia' }],
    [parts.field, materials.field, { cast: false, name: 'field' }],
    [parts.glass, materials.glass, { name: 'curtain' }],
    [parts.concrete, materials.concrete, { cast: false, name: 'concrete' }],
    [parts.spire, materials.spire, { name: 'spire' }],
  ];
  for (const [buf, mat, opts] of staticMeshes) {
    const mesh = meshFrom(buf, mat, opts);
    if (mesh) {
      mesh.name = opts?.name || '';
      group.add(mesh);
    }
  }

  const glassMesh = makeInstances(new THREE.BoxGeometry(1, 1, 1), materials.glass, acc.glass);
  const sillMesh = makeInstances(new THREE.BoxGeometry(1, 1, 1), materials.trim, acc.sill);
  if (glassMesh) {
    glassMesh.name = 'window-glass';
    group.add(glassMesh);
  }
  if (sillMesh) {
    sillMesh.castShadow = true;
    group.add(sillMesh);
  }

  return { group, blockers, windows: acc.glass.length };
}

export function pitchInsideStadium(pitch, stadium) {
  if (!stadium?.outer || !pitch?.f) return false;
  const [x, z] = ringCentroid(pitch.f);
  return pointInPoly(x, z, stadium.outer);
}
