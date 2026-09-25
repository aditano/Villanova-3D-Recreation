/** Carriageway cross-sections. Widths are metres, full asphalt unless noted. */

export const SURFACE = {
  asphalt: 0.2,
  curb: 0.34,
  walk: 0.16,
  mark: 0.26,
  path: 0.14,
  ballast: 0.1,
  rail: 0.22,
  platform: 0.9,
};

/** Height added where annotateCrossings lifted a polyline over the rail. */
export function pointLift(pts, lifts, x, z) {
  if (!lifts || !pts || pts.length < 2) return 0;
  let best = 0;
  let bestD = 6;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + dx * t;
    const pz = a[1] + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < bestD) {
      bestD = d;
      const l0 = lifts[Math.min(i - 1, lifts.length - 1)] || 0;
      const l1 = lifts[Math.min(i, lifts.length - 1)] || 0;
      best = l0 + (l1 - l0) * t;
    }
  }
  return best;
}

/**
 * @param {{cls?: string, w?: number}} road
 */
export function roadProfile(road) {
  const cls = road.cls || 'service';
  const tagged = Number(road.w) || 6;
  if (cls === 'motorway') {
    return { kind: 'highway', asphalt: Math.max(tagged, 15), curb: 0.2, walk: 0, shoulder: 1.8, center: 'double', edge: true, lanes: 2 };
  }
  if (cls === 'trunk' || cls === 'primary') {
    return { kind: 'arterial', asphalt: Math.max(tagged, 13.4), curb: 0.36, walk: 2.55, shoulder: 0, center: 'double', edge: true, lanes: 2 };
  }
  if (cls === 'secondary' || cls === 'tertiary') {
    return { kind: 'collector', asphalt: Math.max(tagged, 8.6), curb: 0.3, walk: 1.9, shoulder: 0, center: 'single', edge: true, lanes: 1 };
  }
  if (cls === 'residential' || cls === 'unclassified' || cls === 'living_street') {
    return { kind: 'street', asphalt: Math.max(tagged, 6.5), curb: 0.24, walk: 1.6, shoulder: 0, center: false, edge: true, lanes: 0 };
  }
  return { kind: 'drive', asphalt: Math.max(tagged, 5.6), curb: 0.2, walk: 1.25, shoulder: 0, center: false, edge: false, lanes: 0 };
}

export function corridorHalf(profile) {
  return profile.asphalt / 2 + profile.curb + profile.walk + (profile.shoulder || 0);
}
