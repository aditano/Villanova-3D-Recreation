import { polylineLength } from './motion.js';

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentHit(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) {
    const denom = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
    if (Math.abs(denom) < 1e-9) return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / denom;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  }
  return null;
}

function railSegments(data) {
  const segs = [];
  for (const line of data.rail || []) {
    if (line.cls !== 'rail' || !line.pts) continue;
    for (let i = 1; i < line.pts.length; i++) segs.push([line.pts[i - 1], line.pts[i]]);
  }
  return segs;
}

function markLine(line, rails) {
  const pts = line.pts;
  if (!pts || pts.length < 2 || line.lift) return;
  const dist = pts.map(() => Infinity);
  let crossings = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    for (const [c, d] of rails) {
      const hit = segmentHit(pts[i], pts[i + 1], c, d);
      if (!hit) continue;
      crossings += 1;
      for (let k = 0; k < pts.length; k++) {
        dist[k] = Math.min(dist[k], Math.hypot(pts[k][0] - hit[0], pts[k][1] - hit[1]));
      }
    }
  }
  if (!crossings && !line.bridge) return;
  const span = polylineLength(pts);
  line.bridge = true;
  if (!crossings || span < 58) {
    line.lift = pts.map(() => line.bridgeLift || 5.5);
    return;
  }
  line.lift = dist.map((d) => {
    if (!Number.isFinite(d) || d > 34) return 0;
    const t = 1 - d / 34;
    return 5.7 * t * t;
  });
}

/** Lift roads and footways that cross the rail corridor so the station bridges read as decks. */
export function annotateCrossings(data) {
  const rails = railSegments(data);
  for (const line of data.roads || []) markLine(line, rails);
  for (const line of data.paths || []) markLine(line, rails);
  return data;
}
