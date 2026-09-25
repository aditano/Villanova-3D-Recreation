/**
 * Campus-scale street audit. Checks the committed extract, not a live city.
 * Lancaster, Ithan, the station rail corridor, and the footbridges students use.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotateCrossings } from '../src/crossings.js';
import { polylineLength } from '../src/motion.js';
import { roadLengthByName } from '../src/traffic.js';

const path = join(dirname(fileURLToPath(import.meta.url)), '../public/data/villanova.json');
const data = JSON.parse(readFileSync(path, 'utf8'));
annotateCrossings(data);

const problems = [];
const lancaster = roadLengthByName(data.roads, /lancaster/i);
const ithan = roadLengthByName(data.roads, /ithan/i);
if (lancaster < 1500) problems.push(`Lancaster Avenue only ${lancaster.toFixed(0)} m in frame`);
if (ithan < 1500) problems.push(`Ithan Avenue only ${ithan.toFixed(0)} m in frame`);

const station = (data.landmarks || []).find((landmark) => landmark.id === 'station');
if (!station) problems.push('Villanova Station landmark missing');
else {
  let best = Infinity;
  for (const line of data.rail || []) {
    if (line.cls !== 'rail') continue;
    for (const [x, z] of line.pts || []) best = Math.min(best, Math.hypot(x - station.x, z - station.z));
  }
  if (best > 30) problems.push(`rail ballast ${best.toFixed(1)} m from Villanova Station`);
}

const bridges = [...(data.paths || []), ...(data.roads || [])].filter((line) => line.bridge && Array.isArray(line.lift));
const footBridges = (data.paths || []).filter((line) => line.bridge);
if (footBridges.length < 2) problems.push(`expected student footbridges, found ${footBridges.length}`);
const ithanBridge = (data.roads || []).some((road) => road.bridge && /ithan/i.test(road.n || ''));
if (!ithanBridge) problems.push('Ithan Avenue does not bridge the rail corridor');

let foot = 0;
for (const line of data.paths || []) foot += polylineLength(line.pts || []);
if (foot < 4000) problems.push(`campus footways only ${foot.toFixed(0)} m`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(
  `ok streets lancaster=${lancaster.toFixed(0)}m ithan=${ithan.toFixed(0)}m foot=${foot.toFixed(0)}m bridges=${bridges.length} footbridges=${footBridges.length}`,
);
