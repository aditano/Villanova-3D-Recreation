/**
 * Sanity-check the committed campus extract before a Pages build.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = join(dirname(fileURLToPath(import.meta.url)), '../public/data/villanova.json');
const data = JSON.parse(readFileSync(path, 'utf8'));

const required = ['church', 'connelly', 'falvey', 'pavilion', 'mendel', 'tolentine', 'bartley', 'garey', 'law', 'alumni', 'station', 'quad', 'stadium'];
const ids = new Set((data.landmarks || []).map((l) => l.id));
const missing = required.filter((id) => !ids.has(id));

const problems = [];
if (!data.meta?.copyright) problems.push('missing OSM copyright');
if ((data.buildings || []).length < 40) problems.push(`too few buildings (${data.buildings?.length || 0})`);
if ((data.roads || []).length < 8) problems.push(`too few roads (${data.roads?.length || 0})`);
if ((data.paths || []).length < 8) problems.push(`too few paths (${data.paths?.length || 0})`);
if (!data.terrain?.data || !data.terrain.cols) problems.push('terrain grid missing');
if (missing.length) problems.push(`landmarks missing: ${missing.join(', ')}`);
if (!data.stadium?.outer?.length) problems.push('stadium outline missing');

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

console.log(
  `ok buildings=${data.buildings.length} roads=${data.roads.length} paths=${data.paths.length} greens=${data.greens.length} landmarks=${[...ids].join(',')}`,
);
