/**
 * Named halls must exist and pick up an authored or tagged height.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBuilding } from '../src/height-rules.js';

const path = join(dirname(fileURLToPath(import.meta.url)), '../public/data/villanova.json');
const data = JSON.parse(readFileSync(path, 'utf8'));
const problems = [];

const required = [
  ['St. Thomas of Villanova Church', { fam: 'gothic', min: 14, spire: 26 }],
  ['Falvey Memorial Library', { fam: 'library', min: 16 }],
  ['Connelly Center', { fam: 'center', min: 12 }],
  ['Finneran Pavilion', { fam: 'arena', min: 20 }],
  ['Mendel Hall', { fam: 'stone', min: 15 }],
  ['Tolentine Hall', { fam: 'gothic', min: 14 }],
  ['Bartley Hall', { fam: 'stone', min: 12 }],
  ['Garey Hall', { fam: 'gothic', min: 14 }],
  ['Charles Widger School of Law', { fam: 'glass', min: 12 }],
  ['Alumni Hall', { fam: 'gothic', min: 11 }],
  ['Villanova Station', { fam: 'station', min: 6 }],
];

for (const [name, expect] of required) {
  const building = (data.buildings || []).find((item) => item.n === name);
  if (!building) {
    problems.push(`missing ${name}`);
    continue;
  }
  const spec = resolveBuilding(building);
  if (spec.fam !== expect.fam) problems.push(`${name} family ${spec.fam} (wanted ${expect.fam})`);
  if (spec.h < expect.min) problems.push(`${name} height ${spec.h} < ${expect.min}`);
  if (expect.spire && spec.spire < expect.spire) problems.push(`${name} spire ${spec.spire} < ${expect.spire}`);
}

const authored = (data.buildings || []).filter((building) => resolveBuilding(building).hs === 'authored' || building.hs === 'authored').length;
const tagged = (data.buildings || []).filter((building) => building.hs === 'height' || building.hs === 'levels').length;
if (authored + tagged < 15) problems.push(`only ${authored + tagged} halls have a real height source`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`ok coverage halls=${required.length} authored-or-tagged=${authored + tagged}`);
