/**
 * Ambient cars and pedestrians. Not a transit model and not live positions.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotateCrossings } from '../src/crossings.js';
import { makePath, samplePath } from '../src/motion.js';
import { advanceAgent, buildSegments, chooseNext, createCampusSim, normalizeOneway } from '../src/traffic.js';

const path = join(dirname(fileURLToPath(import.meta.url)), '../public/data/villanova.json');
const data = JSON.parse(readFileSync(path, 'utf8'));
annotateCrossings(data);

assert.equal(normalizeOneway('yes', 'residential'), 'yes');
assert.equal(normalizeOneway('', 'motorway'), 'yes');
assert.equal(normalizeOneway('', 'trunk'), 'no');
assert.equal(normalizeOneway('-1', 'primary'), '-1');

const arc = makePath([[0, 0], [10, 0], [10, 10]]);
const mid = samplePath(arc, 15);
assert.ok(Math.abs(mid.x - 10) < 1e-6 && Math.abs(mid.z - 5) < 1e-6);

const oneWay = buildSegments([
  { id: 1, n: 'Test', cls: 'motorway', w: 12, oneway: 'yes', pts: [[0, 0], [40, 0], [80, 0]] },
], { cars: true, minLength: 5, snap: 2 });
assert.equal(oneWay.length, 2);
assert.equal(oneWay.filter((segment) => segment.a[0] < segment.b[0]).length, 2);

const twoWay = buildSegments([
  { id: 2, n: 'East Lancaster Avenue', cls: 'trunk', w: 14, pts: [[0, 0], [50, 10], [100, 20]] },
], { cars: true, minLength: 5, snap: 2 });
assert.ok(twoWay.some((segment) => segment.reverse));
assert.ok(twoWay.every((segment) => segment.name === 'East Lancaster Avenue'));

const dead = { s: { next: [], reverse: { id: 'back' }, name: 'Lane' }, seed: 1, hops: 0 };
assert.equal(chooseNext(dead).id, 'back');
const named = {
  s: {
    name: 'East Lancaster Avenue',
    next: [{ name: 'Side' }, { name: 'East Lancaster Avenue' }],
    reverse: null,
  },
  seed: 0,
  hops: 0,
};
assert.equal(chooseNext(named).name, 'East Lancaster Avenue');

const leader = { s: twoWay[0], d: 0.2, speed: 8, velocity: 8, seed: 1, hops: 0, followGap: 8, lateral: -2 };
const pose = advanceAgent(leader, 0.5, 40);
assert.ok(pose && Number.isFinite(pose.x));
assert.ok(leader.d > 0.2);
const stopped = { s: twoWay[0], d: 0.5, speed: 8, velocity: 8, seed: 2, hops: 0, followGap: 8, lateral: -2 };
advanceAgent(stopped, 0.5, 3);
assert.ok(stopped.d < 0.52, `queued car crept to ${stopped.d}`);

const sim = createCampusSim(data, { cars: 70, peds: 64 });
const counts = sim.counts();
assert.ok(counts.carSegments > 40, `car segments ${counts.carSegments}`);
assert.ok(counts.pedSegments > 40, `ped segments ${counts.pedSegments}`);
assert.ok(counts.cars >= 40, `cars ${counts.cars}`);
assert.ok(counts.peds >= 30, `peds ${counts.peds}`);
assert.ok(counts.lancasterCars >= 8, `lancaster cars ${counts.lancasterCars}`);
assert.ok(counts.bridgeSegments >= 2, `bridge segments ${counts.bridgeSegments}`);
assert.ok(counts.bridgePeds >= 4, `bridge peds ${counts.bridgePeds}`);

for (let i = 0; i < 600; i++) sim.step(0.05);
for (const agent of [...sim.cars, ...sim.peds]) {
  const at = sim.pose(agent);
  assert.ok(at && Number.isFinite(at.x) && Number.isFinite(at.z) && Number.isFinite(at.heading));
  assert.ok(agent.d >= 0 && agent.d <= 1);
}
const queues = new Map();
for (const agent of sim.cars) {
  if (!queues.has(agent.s)) queues.set(agent.s, []);
  queues.get(agent.s).push(agent);
}
for (const queue of queues.values()) {
  const ordered = [...queue].sort((a, b) => b.d - a.d);
  for (let i = 1; i < ordered.length; i++) {
    const gap = (ordered[i - 1].d - ordered[i].d) * ordered[i].s.length;
    assert.ok(gap > -0.05, `negative gap ${gap}`);
  }
}

console.log(`ok campus-life ${JSON.stringify(counts)}`);
