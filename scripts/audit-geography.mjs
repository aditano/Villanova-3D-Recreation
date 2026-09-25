/**
 * Frame, quad, and landmark placement checks for the campus extract.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quadAnchor } from '../src/cameras.js';
import { areaCentroid, pointInPoly } from '../src/geo.js';

const path = join(dirname(fileURLToPath(import.meta.url)), '../public/data/villanova.json');
const data = JSON.parse(readFileSync(path, 'utf8'));
const problems = [];

const church = (data.landmarks || []).find((landmark) => landmark.id === 'church');
if (!church) problems.push('church landmark missing');
else if (Math.hypot(church.x, church.z) > 8) problems.push(`church origin drifted ${Math.hypot(church.x, church.z).toFixed(1)} m`);

const anchor = quadAnchor(data);
if (Math.hypot(anchor.x - (church?.x || 0), anchor.z - (church?.z || 0)) < 25) {
  problems.push('main quad anchor is on top of the church');
}
const grasses = (data.greens || []).filter((green) => green.kind === 'grass');
const onLawn = grasses.some((green) => pointInPoly(anchor.x, anchor.z, green.f));
if (!onLawn) problems.push('main quad anchor is not on a mapped lawn');

const quad = (data.landmarks || []).find((landmark) => landmark.id === 'quad');
if (!quad) problems.push('quad landmark missing');
else if (!grasses.some((green) => pointInPoly(quad.x, quad.z, green.f))) {
  problems.push('quad label is not on a mapped lawn');
}

if (!data.stadium?.outer || data.stadium.outer.length < 8) problems.push('stadium outer ring missing');
else {
  const center = areaCentroid(data.stadium.outer);
  const mark = (data.landmarks || []).find((landmark) => landmark.id === 'stadium');
  if (mark && Math.hypot(mark.x - center[0], mark.z - center[1]) > 40) {
    problems.push(`stadium label ${Math.hypot(mark.x - center[0], mark.z - center[1]).toFixed(1)} m from the bowl`);
  }
  if (!pointInPoly(center[0], center[1], data.stadium.outer)) problems.push('stadium centroid falls outside the bowl');
}

const terrain = data.terrain;
if (!terrain?.cols || !terrain?.rows || !terrain?.data) problems.push('terrain grid missing');
else {
  for (const landmark of data.landmarks || []) {
    const col = (landmark.x - terrain.minX) / terrain.step;
    const row = (landmark.z - terrain.minZ) / terrain.step;
    if (col < 1 || row < 1 || col > terrain.cols - 2 || row > terrain.rows - 2) {
      problems.push(`${landmark.id} is outside the terrain grid`);
    }
  }
}

const bbox = data.meta?.bbox;
if (!bbox) problems.push('bbox missing');
else {
  const width = (bbox.north - bbox.south) * 111320;
  const height = (bbox.east - bbox.west) * 111320 * Math.cos(((bbox.north + bbox.south) / 2) * Math.PI / 180);
  if (width < 1200 || height < 1200) problems.push(`campus frame is small (${width.toFixed(0)} x ${height.toFixed(0)} m)`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`ok geography quad@${anchor.x.toFixed(1)},${anchor.z.toFixed(1)} buildings=${data.buildings.length}`);
