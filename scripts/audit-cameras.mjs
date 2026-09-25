/**
 * Every preset must frame its landmark from outside the building stock.
 *   node scripts/audit-cameras.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditViews } from '../src/cameras.js';
import { makeTerrain } from '../src/geo.js';

const path = join(dirname(fileURLToPath(import.meta.url)), '../public/data/villanova.json');
const data = JSON.parse(readFileSync(path, 'utf8'));
const { problems, views, anchor } = auditViews(data, makeTerrain(data.terrain));

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const names = Object.keys(views).filter((name) => name !== 'rotate');
console.log(`ok cameras ${names.join(',')} quad@${anchor.x.toFixed(0)},${anchor.z.toFixed(0)}`);
for (const name of names) {
  const view = views[name];
  const dx = view.pos[0] - view.target[0];
  const dz = view.pos[2] - view.target[2];
  console.log(
    `  ${name}: eye (${view.pos.map((n) => n.toFixed(1)).join(', ')}) dist ${Math.hypot(dx, dz).toFixed(0)} m`,
  );
}
