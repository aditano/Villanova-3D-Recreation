import * as THREE from 'three';
import { pointInPoly, ringCentroid } from './geo.js';

export function openRing(ring) {
  if (!ring?.length) return [];
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) return ring.slice(0, -1);
  return ring.slice();
}

export function shapeArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Shape space is (x, -z). Outers are CCW. */
export function toShapePoints(ring) {
  const pts = openRing(ring).map(([x, z]) => [x, -z]);
  if (pts.length < 3) return null;
  if (shapeArea(pts) < 0) pts.reverse();
  return pts;
}

export function chamferRing(ring, amount) {
  const pts = openRing(ring);
  const n = pts.length;
  if (n < 4 || !(amount > 0)) {
    const copy = pts.slice();
    if (copy.length) copy.push([copy[0][0], copy[0][1]]);
    return copy.length >= 4 ? copy : ring;
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const d1 = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]) || 1;
    const d2 = Math.hypot(next[0] - curr[0], next[1] - curr[1]) || 1;
    const a = Math.min(amount, d1 * 0.32, d2 * 0.32);
    if (a < 0.04) {
      out.push([curr[0], curr[1]]);
      continue;
    }
    out.push([curr[0] + ((prev[0] - curr[0]) / d1) * a, curr[1] + ((prev[1] - curr[1]) / d1) * a]);
    out.push([curr[0] + ((next[0] - curr[0]) / d2) * a, curr[1] + ((next[1] - curr[1]) / d2) * a]);
  }
  if (out.length < 3) return ring;
  out.push([out[0][0], out[0][1]]);
  return out;
}

export function outwardNormal(ax, az, bx, bz, ring) {
  let dx = bx - ax;
  let dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  let nx = -dz;
  let nz = dx;
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  if (pointInPoly(mx + nx * 0.55, mz + nz * 0.55, ring)) {
    nx = -nx;
    nz = -nz;
  }
  return { ax, az, bx, bz, dx, dz, nx, nz, len };
}

export function edgesOf(ring) {
  const pts = openRing(ring);
  const edges = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const edge = outwardNormal(a[0], a[1], b[0], b[1], ring);
    if (edge.len >= 0.35) edges.push(edge);
  }
  return edges;
}

export function insetRing(ring, dist) {
  const pts = openRing(ring);
  const n = pts.length;
  if (n < 3) return ring;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const n1 = outwardNormal(prev[0], prev[1], curr[0], curr[1], ring);
    const n2 = outwardNormal(curr[0], curr[1], next[0], next[1], ring);
    let nx = n1.nx + n2.nx;
    let nz = n1.nz + n2.nz;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    out.push([curr[0] - nx * dist, curr[1] - nz * dist]);
  }
  out.push([out[0][0], out[0][1]]);
  return out;
}

/** Longest-edge frame. `u` runs along the long axis, `p` across it. */
export function orientedFrame(ring) {
  const pts = openRing(ring);
  let best = 0;
  let ux = 1;
  let uz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > best) {
      best = len;
      ux = (b[0] - a[0]) / len;
      uz = (b[1] - a[1]) / len;
    }
  }
  const px = -uz;
  const pz = ux;
  let minU = Infinity;
  let maxU = -Infinity;
  let minP = Infinity;
  let maxP = -Infinity;
  for (const [x, z] of pts) {
    const u = x * ux + z * uz;
    const p = x * px + z * pz;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minP = Math.min(minP, p);
    maxP = Math.max(maxP, p);
  }
  const cu = (minU + maxU) / 2;
  const cp = (minP + maxP) / 2;
  return {
    cx: cu * ux + cp * px,
    cz: cu * uz + cp * pz,
    ux,
    uz,
    px,
    pz,
    length: Math.max(1, maxU - minU),
    width: Math.max(1, maxP - minP),
  };
}

export function framePoint(frame, u, p, y) {
  return [frame.cx + frame.ux * u + frame.px * p, y, frame.cz + frame.uz * u + frame.pz * p];
}

export class MeshBuf {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.col = [];
    this.useColor = false;
  }

  tri(a, b, c, uv, color) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    if (uv) this.uv.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5]);
    else this.uv.push(0, 0, 1, 0, 1, 1);
    if (color) {
      this.useColor = true;
      const c0 = color[0] || [1, 1, 1];
      const c1 = color[1] || c0;
      const c2 = color[2] || c0;
      this.col.push(...c0, ...c1, ...c2);
    } else if (this.useColor) {
      this.col.push(1, 1, 1, 1, 1, 1, 1, 1, 1);
    }
  }

  quad(p0, p1, p2, p3, uv, color) {
    const u = uv || [0, 0, 1, 0, 1, 1, 0, 1];
    const c0 = Array.isArray(color?.[0]) ? color[0] : color;
    const c1 = Array.isArray(color?.[0]) ? color[1] : color;
    const c2 = Array.isArray(color?.[0]) ? color[2] : color;
    const c3 = Array.isArray(color?.[0]) ? color[3] : color;
    this.tri(p0, p1, p2, [u[0], u[1], u[2], u[3], u[4], u[5]], c0 ? [c0, c1, c2] : null);
    this.tri(p0, p2, p3, [u[0], u[1], u[4], u[5], u[6], u[7]], c0 ? [c0, c2, c3] : null);
  }

  toGeometry() {
    if (this.pos.length < 9) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.useColor && this.col.length === this.pos.length) {
      geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    }
    geo.computeVertexNormals();
    return geo;
  }
}

/** Face normal points along the outward normal. U grows from A to B, V grows up. */
export function wallQuad(buf, edge, y0, y1, push0, push1, u0, u1, v0, v1, color) {
  const { ax, az, bx, bz, dx, dz, nx, nz } = edge;
  const leftx = -dz;
  const leftz = dx;
  const aligned = leftx * nx + leftz * nz >= 0;
  const a = aligned ? [ax, az] : [bx, bz];
  const b = aligned ? [bx, bz] : [ax, az];
  const ua = aligned ? u0 : u1;
  const ub = aligned ? u1 : u0;
  const p = (pt, y, push) => [pt[0] + nx * push, y, pt[1] + nz * push];
  const c = color || null;
  buf.quad(
    p(a, y0, push0),
    p(b, y0, push0),
    p(b, y1, push1),
    p(a, y1, push1),
    [ua, v0, ub, v0, ub, v1, ua, v1],
    c,
  );
}

export function shapeCap(ring, y) {
  const outer = toShapePoints(ring);
  if (!outer) return null;
  const shape = new THREE.Shape();
  shape.moveTo(outer[0][0], outer[0][1]);
  for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i][0], outer[i][1]);
  let geo;
  try {
    geo = new THREE.ShapeGeometry(shape);
  } catch {
    return null;
  }
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / 4.5;
    uv[i * 2 + 1] = pos.getZ(i) / 4.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

export function appendGeometry(buf, geo, color) {
  if (!geo) return;
  const pos = geo.attributes.position;
  const index = geo.index;
  const tri = (ia, ib, ic) => {
    const p = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
    buf.tri(p(ia), p(ib), p(ic), null, color ? [color, color, color] : null);
    const last = (buf.uv.length / 2) - 3;
    buf.uv[last * 2] = pos.getX(ia) / 4.5;
    buf.uv[last * 2 + 1] = pos.getZ(ia) / 4.5;
    buf.uv[(last + 1) * 2] = pos.getX(ib) / 4.5;
    buf.uv[(last + 1) * 2 + 1] = pos.getZ(ib) / 4.5;
    buf.uv[(last + 2) * 2] = pos.getX(ic) / 4.5;
    buf.uv[(last + 2) * 2 + 1] = pos.getZ(ic) / 4.5;
  };
  if (index) {
    for (let i = 0; i < index.count; i += 3) tri(index.getX(i), index.getX(i + 1), index.getX(i + 2));
  } else {
    for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
  }
  geo.dispose();
}

export function addBox(buf, cx, cy, cz, sx, sy, sz, yaw = 0) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const p = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
  const v = [
    p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, hy, -hz), p(-hx, hy, -hz),
    p(-hx, -hy, hz), p(hx, -hy, hz), p(hx, hy, hz), p(-hx, hy, hz),
  ];
  const face = (a, b, c, d) => buf.quad(v[a], v[b], v[c], v[d]);
  // CCW seen from outside. FrontSide materials cull the previous inward winding.
  face(0, 3, 2, 1);
  face(5, 6, 7, 4);
  face(4, 7, 3, 0);
  face(1, 2, 6, 5);
  face(3, 7, 6, 2);
  face(4, 0, 1, 5);
}

export function footprintSpan(ring) {
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
  return { minX, maxX, minZ, maxZ, half: Math.max(maxX - minX, maxZ - minZ) / 2 };
}

export { ringCentroid };
