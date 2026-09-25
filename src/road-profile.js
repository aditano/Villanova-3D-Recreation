/** Carriageway cross-sections. Widths are metres, full asphalt unless noted. */

export const SURFACE = {
  asphalt: 0.07,
  curb: 0.16,
  walk: 0.11,
  mark: 0.09,
  path: 0.08,
  ballast: 0.045,
  rail: 0.15,
  platform: 0.9,
};

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
