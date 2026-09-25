import { areaCentroid, pointInPoly, ringRadius } from './geo.js';
import { massingFor } from './height-rules.js';

const PRESET_ORDER = ['aerial', 'quad', 'church', 'stadium', 'library', 'pavilion', 'station', 'lancaster', 'rotate'];

function openRing(ring) {
  if (!ring?.length) return [];
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) return ring.slice(0, -1);
  return ring.slice();
}

export function makeHitTester(buildings) {
  const pads = (buildings || []).map((building) => {
    const ring = building.f;
    if (!ring || ring.length < 4) return null;
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
    return { building, minX, maxX, minZ, maxZ, f: ring };
  }).filter(Boolean);

  return function hit(x, z, ignoreId = 0) {
    for (const pad of pads) {
      if (ignoreId && pad.building.id === ignoreId) continue;
      if (x < pad.minX - 1 || x > pad.maxX + 1 || z < pad.minZ - 1 || z > pad.maxZ + 1) continue;
      if (pointInPoly(x, z, pad.f)) return pad.building;
    }
    return null;
  };
}

function buildingByName(data, name) {
  return (data.buildings || []).find((building) => building.n && building.n.toLowerCase() === name.toLowerCase()) || null;
}

function landmarkRecord(data, id) {
  return (data.landmarks || []).find((landmark) => landmark.id === id) || null;
}

/** Open lawn south of the church, inside the mapped grass and outside footprints. */
export function quadAnchor(data) {
  const church = landmarkRecord(data, 'church') || { x: 0, z: 0 };
  const hit = makeHitTester(data.buildings);
  const grasses = (data.greens || []).filter((green) => green.kind === 'grass' && green.f?.length > 3);
  let best = null;
  for (const grass of grasses) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of grass.f) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const samples = [];
    for (let z = minZ; z <= maxZ; z += 8) {
      for (let x = minX; x <= maxX; x += 8) {
        const dz = z - church.z;
        const dx = x - church.x;
        if (dz < 28 || dz > 150 || Math.hypot(dx, dz) > 190) continue;
        if (!pointInPoly(x, z, grass.f)) continue;
        if (hit(x, z)) continue;
        samples.push([x, z]);
      }
    }
    if (samples.length < 6) continue;
    const cx = samples.reduce((sum, p) => sum + p[0], 0) / samples.length;
    const cz = samples.reduce((sum, p) => sum + p[1], 0) / samples.length;
    if (!best || samples.length > best.samples.length) best = { x: cx, z: cz, samples, grass };
  }
  if (best) return { x: best.x, z: best.z, samples: best.samples };
  return { x: church.x + 70, z: church.z + 85, samples: [] };
}

function frameOf(building, landmark, terrainY) {
  const ring = building?.f;
  const center = ring ? areaCentroid(ring) : [landmark?.x || 0, landmark?.z || 0];
  const radius = ring ? Math.max(12, ringRadius(ring, center)) : 16;
  const height = building?.spire || building?.h || landmark?.h || 12;
  const ground = terrainY(center[0], center[1]);
  return {
    x: center[0],
    z: center[1],
    radius,
    height,
    ground,
    id: building?.id || 0,
    name: building?.n || landmark?.name || '',
  };
}

function clearance(hit, x, z, pad) {
  if (hit(x, z)) return false;
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    if (hit(x + Math.cos(angle) * pad, z + Math.sin(angle) * pad)) return false;
  }
  return true;
}

function sightClear(hit, eyeX, eyeZ, frame) {
  for (const t of [0.22, 0.4, 0.55]) {
    const x = eyeX + (frame.x - eyeX) * t;
    const z = eyeZ + (frame.z - eyeZ) * t;
    if (Math.hypot(x - frame.x, z - frame.z) < (frame.radius || 12) * 0.92) continue;
    if (hit(x, z)) return false;
  }
  return true;
}

function placeClear(hit, frame, terrainY, { bearing, distance, eye, aim, pad = 7, sweep = 2.8 }) {
  const bearings = [bearing];
  for (let i = 1; i <= 12; i++) {
    const delta = i * 0.18;
    if (delta > sweep) break;
    bearings.push(bearing + delta, bearing - delta);
  }
  const distances = [distance, distance * 1.2, distance * 1.45, distance * 0.84];
  for (const nextBearing of bearings) {
    for (const dist of distances) {
      const x = frame.x + Math.sin(nextBearing) * dist;
      const z = frame.z + Math.cos(nextBearing) * dist;
      const ground = terrainY(x, z);
      const y = Math.max(ground + 6, frame.ground + eye);
      if (!clearance(hit, x, z, pad)) continue;
      if (!sightClear(hit, x, z, frame)) continue;
      return {
        pos: [x, y, z],
        target: [frame.x, frame.ground + aim, frame.z],
      };
    }
  }
  const x = frame.x + Math.sin(bearing) * distance * 1.7;
  const z = frame.z + Math.cos(bearing) * distance * 1.7;
  return {
    pos: [x, Math.max(terrainY(x, z) + 8, frame.ground + eye + 24), z],
    target: [frame.x, frame.ground + aim, frame.z],
  };
}

function closestOnNamed(roads, pattern, nearX, nearZ) {
  let best = null;
  for (const road of roads || []) {
    if (!road.n || !pattern.test(road.n) || !road.pts) continue;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1];
      const b = road.pts[i];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((nearX - a[0]) * dx + (nearZ - a[1]) * dz) / len2));
      const x = a[0] + dx * t;
      const z = a[1] + dz * t;
      const distance = Math.hypot(x - nearX, z - nearZ);
      if (!best || distance < best.distance) {
        best = { x, z, dx, dz, distance, width: road.w || 12 };
      }
    }
  }
  return best;
}

export function buildViews(data, terrainY) {
  const hit = makeHitTester(data.buildings);
  const anchor = quadAnchor(data);
  const churchBuilding = buildingByName(data, 'St. Thomas of Villanova Church');
  const church = frameOf(churchBuilding, landmarkRecord(data, 'church'), terrainY);
  const library = frameOf(buildingByName(data, 'Falvey Memorial Library'), landmarkRecord(data, 'falvey'), terrainY);
  const stadiumLm = landmarkRecord(data, 'stadium');
  const stadiumRing = data.stadium?.outer;
  const stadiumCenter = stadiumRing ? areaCentroid(stadiumRing) : [stadiumLm?.x || 0, stadiumLm?.z || 0];
  const stadiumRadius = stadiumRing ? ringRadius(stadiumRing, stadiumCenter) : 80;
  const stadiumGround = terrainY(stadiumCenter[0], stadiumCenter[1]);
  const stadium = {
    x: stadiumCenter[0],
    z: stadiumCenter[1],
    radius: stadiumRadius,
    height: data.stadium?.h || 16,
    ground: stadiumGround,
    id: 0,
  };
  const pavilion = frameOf(buildingByName(data, 'Finneran Pavilion'), landmarkRecord(data, 'pavilion'), terrainY);
  const station = frameOf(buildingByName(data, 'Villanova Station'), landmarkRecord(data, 'station'), terrainY);

  const quadBearing = Math.atan2(anchor.x - church.x, anchor.z - church.z);
  // Due south. The quad anchor sits on the Tolentine axis, so a camera there
  // looks through the church at Tolentine Hall.
  const churchView = placeClear(hit, church, terrainY, {
    bearing: 0,
    distance: 80,
    eye: 18,
    aim: 12,
    pad: 4.5,
    sweep: 0.16,
  });
  churchView.fov = 40;
  const quadView = placeClear(hit, church, terrainY, {
    bearing: quadBearing,
    distance: 158,
    eye: 52,
    aim: 14,
    pad: 9,
  });

  const stadiumView = placeClear(hit, stadium, terrainY, {
    bearing: 0.42,
    distance: stadium.radius + 38,
    eye: 82,
    aim: 1.6,
    pad: 6,
  });

  const libraryBearing = Math.atan2(church.x - library.x, church.z - library.z);
  const libraryView = placeClear(hit, library, terrainY, {
    bearing: libraryBearing,
    distance: Math.max(118, library.radius * 3.3),
    eye: 32,
    aim: Math.min(10, library.height * 0.4),
    pad: 8,
  });

  const pavilionView = placeClear(hit, pavilion, terrainY, {
    bearing: Math.PI * 0.15,
    distance: Math.max(210, pavilion.radius * 2.35),
    eye: 68,
    aim: Math.max(8, pavilion.height * 0.35),
    pad: 10,
  });

  const stationView = placeClear(hit, station, terrainY, {
    bearing: 0.12,
    distance: Math.max(36, station.radius * 2.7),
    eye: 13,
    aim: 4.2,
    pad: 3.5,
  });

  const coreIds = ['church', 'quad', 'falvey', 'connelly', 'bartley', 'stadium', 'pavilion', 'garey', 'mendel', 'law'];
  const core = (data.landmarks || []).filter((landmark) => coreIds.includes(landmark.id));
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const landmark of core) {
    minX = Math.min(minX, landmark.x);
    maxX = Math.max(maxX, landmark.x);
    minZ = Math.min(minZ, landmark.z);
    maxZ = Math.max(maxZ, landmark.z);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ, 420);
  const aerial = {
    pos: [cx + span * 0.04, Math.max(96, span * 0.2), cz + span * 0.98],
    target: [cx, 16, cz + span * 0.02],
  };

  const road = closestOnNamed(data.roads, /lancaster/i, anchor.x, anchor.z + 40);
  let lancaster = aerial;
  if (road) {
    const len = Math.hypot(road.dx, road.dz) || 1;
    const fx = road.dx / len;
    const fz = road.dz / len;
    const side = road.width * 0.35 + 14;
    const candidates = [
      [road.x - fz * side - fx * 6, road.z + fx * side - fz * 6],
      [road.x + fz * side - fx * 6, road.z - fx * side - fz * 6],
    ];
    let eye = candidates[0];
    if (hit(eye[0], eye[1]) && !hit(candidates[1][0], candidates[1][1])) eye = candidates[1];
    const along = 48;
    const look = [road.x + fx * along, road.z + fz * along];
    const ground = terrainY(eye[0], eye[1]);
    lancaster = {
      pos: [eye[0], ground + 11, eye[1]],
      target: [look[0], terrainY(look[0], look[1]) + 1.3, look[1]],
    };
    if (hit(eye[0], eye[1])) {
      lancaster = {
        pos: [road.x - fz * (side + 10), terrainY(road.x, road.z) + 22, road.z + fx * (side + 10)],
        target: [road.x + fx * 30, terrainY(road.x, road.z) + 1.2, road.z + fz * 30],
      };
    }
  }

  const churchLm = landmarkRecord(data, 'church') || { x: church.x, z: church.z };
  let walk = aerial;
  if (road) {
    const dist = Math.hypot(churchLm.x - road.x, churchLm.z - road.z) || 1;
    const sx = (churchLm.x - road.x) / dist;
    const sz = (churchLm.z - road.z) / dist;
    let wx = road.x + sx * 14;
    let wz = road.z + sz * 14;
    for (let i = 0; i < 8 && hit(wx, wz); i++) {
      wx += 3;
      wz += 2;
    }
    walk = {
      pos: [wx, terrainY(wx, wz) + 1.68, wz],
      target: [churchLm.x, terrainY(churchLm.x, churchLm.z) + 9, churchLm.z],
      fov: 62,
      yaw: Math.atan2(wx - churchLm.x, wz - churchLm.z),
      walk: true,
    };
  }

  const views = {
    aerial,
    quad: quadView,
    church: churchView,
    stadium: stadiumView,
    library: libraryView,
    pavilion: pavilionView,
    station: stationView,
    lancaster,
    walk,
    rotate: aerial,
  };
  return { views, anchor, order: PRESET_ORDER.filter((name) => name !== 'rotate') };
}

function projectNdc(pos, target, fovDeg, aspect, point) {
  const fx = target[0] - pos[0];
  const fy = target[1] - pos[1];
  const fz = target[2] - pos[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  const zx = -fx / fl;
  const zy = -fy / fl;
  const zz = -fz / fl;
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl;
  xy /= xl;
  xz /= xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const dx = point[0] - pos[0];
  const dy = point[1] - pos[1];
  const dz = point[2] - pos[2];
  const cx = dx * xx + dy * xy + dz * xz;
  const cy = dx * yx + dy * yy + dz * yz;
  const cz = dx * zx + dy * zy + dz * zz;
  if (cz >= -0.4) return null;
  const f = 1 / Math.tan(((fovDeg * Math.PI) / 180) / 2);
  return { x: (cx / -cz) * (f / aspect), y: (cy / -cz) * f, z: cz };
}

function ndcDist(ndc) {
  if (!ndc) return 9;
  return Math.hypot(ndc.x, ndc.y);
}

function namedPoint(data, name, terrainY, y) {
  const building = buildingByName(data, name);
  const center = building?.f ? areaCentroid(building.f) : [0, 0];
  return [center[0], terrainY(center[0], center[1]) + y, center[1], building];
}

/** Screen-space check. A camera aimed through Tolentine at the church origin fails this. */
export function churchFramingReport(data, terrainY, view) {
  const problems = [];
  const fov = view?.fov || 42;
  const aspect = 16 / 9;
  const mass = massingFor('St. Thomas of Villanova Church') || { nave: 16.5, tip: 34 };
  const church = namedPoint(data, 'St. Thomas of Villanova Church', terrainY, mass.nave * 0.42);
  const tolentine = namedPoint(data, 'Tolentine Hall', terrainY, 8);
  const spire = [church[0], terrainY(church[0], church[2]) + mass.tip, church[2]];
  const churchNdc = projectNdc(view.pos, view.target, fov, aspect, church);
  const tolNdc = projectNdc(view.pos, view.target, fov, aspect, tolentine);
  const spireNdc = projectNdc(view.pos, view.target, fov, aspect, spire);
  const churchDist = ndcDist(churchNdc);
  const tolDist = ndcDist(tolNdc);
  if (churchDist > 0.22) problems.push(`church: St. Thomas is off center (${churchDist.toFixed(2)})`);
  if (tolDist < churchDist + 0.38) {
    problems.push(`church: Tolentine is in frame (${tolDist.toFixed(2)}) instead of St. Thomas (${churchDist.toFixed(2)})`);
  }
  if (!spireNdc || Math.abs(spireNdc.x) > 0.92 || Math.abs(spireNdc.y) > 0.92) {
    problems.push('church: spire is outside the frame');
  }
  const ring = church[3]?.f || [];
  let fill = 0;
  for (const [x, z] of ring) {
    const ndc = projectNdc(view.pos, view.target, fov, aspect, [x, church[1], z]);
    if (ndc) fill = Math.max(fill, Math.abs(ndc.x), Math.abs(ndc.y));
  }
  if (fill < 0.28) problems.push(`church: St. Thomas does not fill the frame (${fill.toFixed(2)})`);
  return { problems, churchDist, tolDist, fill };
}

/** The rejected pose: bearing 0.78 looks through the church at Tolentine. */
export function rejectedChurchPose(data, terrainY) {
  const church = namedPoint(data, 'St. Thomas of Villanova Church', terrainY, 12);
  const bearing = 0.78;
  const dist = 86;
  const x = church[0] + Math.sin(bearing) * dist;
  const z = church[2] + Math.cos(bearing) * dist;
  return {
    pos: [x, terrainY(x, z) + 22, z],
    target: [church[0], church[1], church[2]],
    fov: 36,
  };
}

export function auditViews(data, terrainY) {
  const { views, anchor } = buildViews(data, terrainY);
  const hit = makeHitTester(data.buildings);
  const problems = [];
  const expect = {
    church: { x: 0, z: 0, slack: 30 },
    stadium: { slack: 40 },
    library: { slack: 30 },
    pavilion: { slack: 40 },
    station: { slack: 30 },
  };
  const church = landmarkRecord(data, 'church');
  const byFrame = {
    church: frameOf(buildingByName(data, 'St. Thomas of Villanova Church'), church, terrainY),
    library: frameOf(buildingByName(data, 'Falvey Memorial Library'), landmarkRecord(data, 'falvey'), terrainY),
    pavilion: frameOf(buildingByName(data, 'Finneran Pavilion'), landmarkRecord(data, 'pavilion'), terrainY),
    station: frameOf(buildingByName(data, 'Villanova Station'), landmarkRecord(data, 'station'), terrainY),
  };
  const stadiumRing = data.stadium?.outer;
  if (stadiumRing) {
    const c = areaCentroid(stadiumRing);
    byFrame.stadium = { x: c[0], z: c[1], radius: ringRadius(stadiumRing, c), id: 0, ground: terrainY(c[0], c[1]), height: data.stadium.h || 16 };
  }

  for (const name of ['aerial', 'quad', 'church', 'stadium', 'library', 'pavilion', 'station', 'lancaster']) {
    const view = views[name];
    if (!view?.pos || !view?.target) {
      problems.push(`${name}: missing view`);
      continue;
    }
    const [x, y, z] = view.pos;
    const [tx, ty, tz] = view.target;
    if (![x, y, z, tx, ty, tz].every((n) => Number.isFinite(n))) {
      problems.push(`${name}: non-finite camera`);
      continue;
    }
    const overhead = name === 'aerial' && y > terrainY(x, z) + 40;
    if (hit(x, z) && !overhead) problems.push(`${name}: camera inside a building`);
    if (y < terrainY(x, z) + 3) problems.push(`${name}: camera below terrain`);
    const distance = Math.hypot(x - tx, z - tz);
    if (distance < 12) problems.push(`${name}: slam distance ${distance.toFixed(1)} m`);
    if (name !== 'aerial' && distance > 520) problems.push(`${name}: camera too far (${distance.toFixed(0)} m)`);
    const frame = byFrame[name];
    if (frame) {
      const off = Math.hypot(tx - frame.x, tz - frame.z);
      const slack = expect[name]?.slack || 24;
      if (off > slack) problems.push(`${name}: target ${off.toFixed(1)} m from landmark`);
      if (name === 'stadium') {
        const cam = Math.hypot(x - frame.x, z - frame.z);
        const rise = y - frame.ground;
        const clears = rise * frame.radius / Math.max(cam, 1);
        if (clears < (frame.height || 14) * 0.85) {
          problems.push(`${name}: sightline clipped by the bowl (clear ${clears.toFixed(1)} m)`);
        }
        if (rise / Math.max(cam, 1) < 0.4) {
          problems.push(`${name}: camera too shallow to show the field (${(rise / cam).toFixed(2)})`);
        }
        if (cam < frame.radius + 8) problems.push(`${name}: camera inside the bowl`);
      }
    }
    if (name === 'quad') {
      const lawn = Math.hypot(tx - anchor.x, tz - anchor.z);
      const toChurch = Math.hypot(tx - (church?.x || 0), tz - (church?.z || 0));
      if (lawn > 80 && toChurch > 80) problems.push('quad: target is neither the lawn nor the church');
      if (hit(x, z)) problems.push('quad: camera clipped a hall');
    }
    if (name === 'lancaster') {
      const road = closestOnNamed(data.roads, /lancaster/i, tx, tz);
      if (!road || road.distance > 18) problems.push(`lancaster: target ${road ? road.distance.toFixed(1) : '∞'} m off the avenue`);
    }
    if (name === 'station' && (distance < 24 || distance > 70)) {
      problems.push(`${name}: frame distance ${distance.toFixed(0)} m`);
    }
  }
  problems.push(...churchFramingReport(data, terrainY, views.church).problems);
  const rejected = churchFramingReport(data, terrainY, rejectedChurchPose(data, terrainY));
  if (!rejected.problems.length) problems.push('church: framing audit accepted the Tolentine-aligned pose');
  const centers = {
    library: namedPoint(data, 'Falvey Memorial Library', terrainY, 8),
    pavilion: namedPoint(data, 'Finneran Pavilion', terrainY, 10),
    station: namedPoint(data, 'Villanova Station', terrainY, 4),
  };
  for (const [name, point] of Object.entries(centers)) {
    const ndc = projectNdc(views[name].pos, views[name].target, views[name].fov || 42, 16 / 9, point);
    const off = ndcDist(ndc);
    if (off > 0.38) problems.push(`${name}: landmark is off center (${off.toFixed(2)})`);
  }
  if (byFrame.stadium) {
    const field = [byFrame.stadium.x, byFrame.stadium.ground + 2, byFrame.stadium.z];
    const off = ndcDist(projectNdc(views.stadium.pos, views.stadium.target, views.stadium.fov || 42, 16 / 9, field));
    if (off > 0.32) problems.push(`stadium: field is off center (${off.toFixed(2)})`);
  }
  const walk = views.walk;
  if (!walk?.walk) problems.push('walk pose missing');
  else {
    const eye = terrainY(walk.pos[0], walk.pos[2]) + 1.68;
    if (Math.abs(walk.pos[1] - eye) > 0.25) problems.push(`walk eye off terrain by ${(walk.pos[1] - eye).toFixed(2)}`);
    if (hit(walk.pos[0], walk.pos[2])) problems.push('walk start inside a building');
  }
  return { problems, views, anchor };
}

export { openRing, PRESET_ORDER };
