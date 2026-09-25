/** Arc-length paths keep cars and pedestrians at a steady speed through uneven OSM vertices. */

export function makePath(points) {
  const source = points.filter((v, i) => !i || Math.hypot(v[0] - points[i - 1][0], v[1] - points[i - 1][1]) > 0.05);
  const lengths = [0];
  for (let i = 1; i < source.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(source[i][0] - source[i - 1][0], source[i][1] - source[i - 1][1]));
  }
  return { points: source, lengths, length: lengths.at(-1) || 0 };
}

export function samplePath(path, distance, offset = 0) {
  if (!path || path.points.length < 2 || !(path.length > 0)) return null;
  const d = Math.max(0, Math.min(path.length, distance));
  let lo = 1;
  let hi = path.lengths.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (path.lengths[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  const a = path.points[lo - 1];
  const b = path.points[lo];
  const len = path.lengths[lo] - path.lengths[lo - 1] || 1;
  const t = (d - path.lengths[lo - 1]) / len;
  const dx = (b[0] - a[0]) / len;
  const dz = (b[1] - a[1]) / len;
  return {
    x: a[0] + (b[0] - a[0]) * t + dz * offset,
    z: a[1] + (b[1] - a[1]) * t - dx * offset,
    heading: Math.atan2(dx, dz),
  };
}

export function polylineLength(pts) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return n;
}
