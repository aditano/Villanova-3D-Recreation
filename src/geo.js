/** Local metres: +X east, +Y up, +Z south. Origin at St. Thomas of Villanova Church. */

export function pointInPoly(x, z, poly) {
  let inside = false;
  const n = poly.length - 1;
  for (let i = 0, j = n - 1; i < n; i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi) inside = !inside;
    j = i;
  }
  return inside;
}

export function ringCentroid(ring) {
  let x = 0;
  let z = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    z += ring[i][1];
  }
  return [x / n, z / n];
}

/** Area-weighted centroid. Falls back to the vertex mean on a degenerate ring. */
export function areaCentroid(ring) {
  const n = ring.length > 1 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 0.05
    ? ring.length - 1
    : ring.length;
  let twice = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const cross = p[0] * q[1] - q[0] * p[1];
    twice += cross;
    cx += (p[0] + q[0]) * cross;
    cz += (p[1] + q[1]) * cross;
  }
  if (Math.abs(twice) < 1e-4) return ringCentroid(ring);
  return [cx / (3 * twice), cz / (3 * twice)];
}

export function ringRadius(ring, center) {
  const n = ring.length > 1 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 0.05
    ? ring.length - 1
    : ring.length;
  let radius = 0;
  for (let i = 0; i < n; i++) {
    radius = Math.max(radius, Math.hypot(ring[i][0] - center[0], ring[i][1] - center[1]));
  }
  return radius;
}

export function hash01(x, z) {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

export function makeTerrain(terrain) {
  if (!terrain?.data) return () => 0;
  const bin = atob(terrain.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const grid = new Int16Array(bytes.buffer);
  const { minX, minZ, step, cols, rows } = terrain;

  return function terrainHeight(x, z) {
    const fx = (x - minX) / step;
    const fz = (z - minZ) / step;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const cx0 = Math.max(0, Math.min(cols - 1, x0));
    const cz0 = Math.max(0, Math.min(rows - 1, z0));
    const cx1 = Math.max(0, Math.min(cols - 1, x0 + 1));
    const cz1 = Math.max(0, Math.min(rows - 1, z0 + 1));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const tz = Math.max(0, Math.min(1, fz - z0));
    const a = grid[cz0 * cols + cx0];
    const b = grid[cz0 * cols + cx1];
    const c = grid[cz1 * cols + cx0];
    const d = grid[cz1 * cols + cx1];
    return ((a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz) * 0.1;
  };
}

export function footprintBase(ring, yAt) {
  let min = Infinity;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) min = Math.min(min, yAt(ring[i][0], ring[i][1]));
  const [cx, cz] = ringCentroid(ring);
  return Math.min(min, yAt(cx, cz));
}
