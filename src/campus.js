import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildStructures, pitchInsideStadium } from './buildings.js';
import { ringCentroid } from './geo.js';
import { buildGround } from './ground.js';
import { buildLife } from './life.js';
import { shapeCap } from './meshlib.js';
import { buildTransport } from './roads.js';

function mergeParts(geos) {
  const usable = geos.filter((g) => g && g.getAttribute('position')?.count);
  if (!usable.length) return null;
  if (usable.length === 1) return usable[0];
  const merged = mergeGeometries(usable, false);
  for (const g of usable) g.dispose();
  return merged;
}

function addMesh(group, geo, material, { cast = false, receive = true } = {}) {
  if (!geo) return;
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  group.add(mesh);
}

function addSlabs(group, items, yAt, material, lift, skip) {
  const geos = [];
  for (const item of items || []) {
    if (skip?.(item)) continue;
    const ring = item.f || item;
    if (!ring || ring.length < 4) continue;
    try {
      const [cx, cz] = ringCentroid(ring);
      const geo = shapeCap(ring, yAt(cx, cz) + lift);
      if (geo) geos.push(geo);
    } catch (err) {
      console.warn('Slab failed', err);
    }
  }
  addMesh(group, mergeParts(geos), material);
}

export function buildCampus(data, yAt, materials) {
  const group = new THREE.Group();
  group.name = 'campus';

  const ground = buildGround(data, yAt);
  group.add(ground.mesh);

  addSlabs(group, data.water, yAt, materials.water, 0.06);
  addSlabs(group, data.plazas, yAt, materials.concrete, 0.05);
  addSlabs(group, data.pitches, yAt, materials.pitch, 0.1, (pitch) => pitchInsideStadium(pitch, data.stadium));

  const transport = buildTransport(data, yAt, materials);
  group.add(transport.group);

  const structures = buildStructures(data, yAt, materials);
  group.add(structures.group);

  const life = buildLife(data, yAt, materials);
  group.add(life.group);

  return {
    group,
    blockers: structures.blockers,
    update: (dt, night) => life.update(dt, night),
  };
}
