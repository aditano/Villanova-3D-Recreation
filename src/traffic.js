import { makePath, polylineLength, samplePath } from './motion.js';

const CAR_CLASS = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
]);

const RANK = {
  motorway: 5,
  motorway_link: 5,
  trunk: 5,
  trunk_link: 5,
  primary: 5,
  primary_link: 4,
  secondary: 4,
  secondary_link: 4,
  tertiary: 3,
  tertiary_link: 3,
  unclassified: 3,
  residential: 3,
  living_street: 3,
};

export function normalizeOneway(value, cls) {
  const raw = String(value || '').trim();
  if (raw === 'yes' || raw === '1' || raw === '-1' || raw === 'no' || raw === 'reversible') return raw;
  if (cls === 'motorway' || cls === 'motorway_link') return 'yes';
  return 'no';
}

function nodeKey(p, snap) {
  return `${Math.round(p[0] / snap)},${Math.round(p[1] / snap)}`;
}

function vertexLift(line, index) {
  if (!line) return 0;
  if (Array.isArray(line.lift)) return line.lift[index] || 0;
  if (line.bridge) return line.bridgeLift || 5.4;
  return 0;
}

/**
 * Directed edges for cars or pedestrians.
 * `lines` use campus JSON shape: { pts, cls, n, w, oneway, bridge, lift }.
 */
export function buildSegments(lines, { cars = false, minLength = 6, snap = 2.5, blocked = null } = {}) {
  const segments = [];
  for (const line of lines || []) {
    if (cars && !CAR_CLASS.has(line.cls)) continue;
    if (line.tunnel) continue;
    const pts = line.pts;
    if (!pts || pts.length < 2) continue;
    const oneway = cars ? normalizeOneway(line.oneway, line.cls) : 'no';
    const rank = cars ? RANK[line.cls] || 3 : 3;
    const offset = cars ? Math.min(3.4, Math.max(1.65, (line.w || 6) * 0.2)) : 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < minLength) continue;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (blocked?.(mid[0], mid[1])) continue;
      const lift = Math.max(vertexLift(line, i - 1), vertexLift(line, i));
      const base = {
        rank,
        length,
        name: line.n || '',
        offset,
        lift,
        bridge: lift > 1.2 || !!line.bridge,
        cls: line.cls || 'footway',
        id: line.id,
      };
      if (oneway !== '-1') segments.push({ ...base, a, b, path: makePath([a, b]) });
      if (oneway !== 'yes' && oneway !== '1') segments.push({ ...base, a: b, b: a, length, path: makePath([b, a]) });
    }
  }
  const junctions = new Map();
  for (const segment of segments) {
    const key = nodeKey(segment.a, snap);
    if (!junctions.has(key)) junctions.set(key, []);
    junctions.get(key).push(segment);
  }
  for (const segment of segments) {
    const outgoing = junctions.get(nodeKey(segment.b, snap)) || [];
    segment.next = outgoing.filter((next) => nodeKey(next.b, snap) !== nodeKey(segment.a, snap));
    segment.reverse = outgoing.find((next) => nodeKey(next.b, snap) === nodeKey(segment.a, snap)) || null;
  }
  return segments;
}

export function chooseNext(agent) {
  const choices = agent.s.next || [];
  if (!choices.length) return agent.s.reverse || null;
  const named = agent.s.name ? choices.filter((next) => next.name === agent.s.name) : [];
  const pool = named.length ? named : choices;
  agent.hops = (agent.hops + 1) >>> 0;
  return pool[(agent.seed + agent.hops) % pool.length];
}

export function advanceAgent(agent, dt, gap = Infinity) {
  let distance = agent.speed * dt;
  if (Number.isFinite(gap)) {
    const available = Math.max(0, gap - (agent.followGap || 7));
    const desired = Math.min(agent.speed, Math.sqrt(2 * 3.2 * available));
    const k = 1 - Math.exp(-3 * dt);
    agent.velocity += (desired - agent.velocity) * k;
    distance = Math.min(available, Math.max(0, agent.velocity) * dt);
  }
  agent.d += distance / agent.s.length;
  let guard = 0;
  while (agent.d > 1 && guard++ < 4) {
    const extra = (agent.d - 1) * agent.s.length;
    const next = chooseNext(agent);
    if (!next) {
      agent.d = 1;
      agent.velocity = 0;
      break;
    }
    agent.s = next;
    agent.d = extra / next.length;
  }
  if (agent.d > 1) agent.d = 1;
  return samplePath(agent.s.path, agent.d * agent.s.length, agent.lateral || 0);
}

function spawn(segments, count, { stride, frac, speed, lateral, followGap, bias }) {
  if (!segments.length || count < 1) return [];
  const preferred = bias ? segments.filter(bias) : [];
  const pool = preferred.length ? preferred : segments;
  const agents = [];
  for (let i = 0; i < count; i++) {
    const fromBias = preferred.length && i / count < (bias ? 0.62 : 0);
    const source = fromBias ? preferred : segments;
    const segment = source[(i * stride) % source.length];
    agents.push({
      s: segment,
      d: (i * frac) % 1,
      speed: speed(i, segment),
      velocity: speed(i, segment),
      seed: i * 17 + 3,
      hops: 0,
      lateral: lateral(i, segment),
      followGap,
      gap: Infinity,
    });
  }
  return agents;
}

export function createCampusSim(data, { blocked = null, cars = 70, peds = 64 } = {}) {
  const carSegments = buildSegments(data.roads, { cars: true, minLength: 7, snap: 3, blocked });
  const pedSegments = buildSegments(data.paths, { cars: false, minLength: 3.5, snap: 3.5, blocked });
  const lancaster = (segment) => /lancaster/i.test(segment.name || '');
  const bridge = (segment) => segment.bridge;
  const carAgents = spawn(carSegments, Math.min(cars, Math.max(carSegments.length, 0)), {
    stride: 47,
    frac: 0.618,
    speed: (i, segment) => (segment.rank >= 5 ? 8.5 : 5.5) + (i % 5) * 0.45,
    lateral: (_i, segment) => -segment.offset,
    followGap: 8,
    bias: lancaster,
  });
  const pedAgents = spawn(pedSegments, Math.min(peds, Math.max(pedSegments.length, 0)), {
    stride: 31,
    frac: 0.713,
    speed: (i) => 1.05 + (i % 4) * 0.18,
    lateral: (i) => (i % 2 ? 0.55 : -0.55),
    followGap: 1.4,
    bias: bridge,
  });
  // Keep a few walkers on the quad paths even when bridges exist.
  return {
    carSegments,
    pedSegments,
    cars: carAgents,
    peds: pedAgents,
    step(dt) {
      const safe = Math.min(0.05, Math.max(0, dt));
      const queues = new Map();
      for (const agent of carAgents) {
        if (!queues.has(agent.s)) queues.set(agent.s, []);
        queues.get(agent.s).push(agent);
      }
      for (const queue of queues.values()) {
        queue.sort((a, b) => b.d - a.d);
        queue.forEach((agent, index) => {
          agent.gap = index ? (queue[index - 1].d - agent.d) * agent.s.length : Infinity;
        });
      }
      for (const agent of carAgents) advanceAgent(agent, safe, agent.gap);
      const foot = new Map();
      for (const agent of pedAgents) {
        if (!foot.has(agent.s)) foot.set(agent.s, []);
        foot.get(agent.s).push(agent);
      }
      for (const queue of foot.values()) {
        queue.sort((a, b) => b.d - a.d);
        queue.forEach((agent, index) => {
          agent.gap = index ? (queue[index - 1].d - agent.d) * agent.s.length : Infinity;
        });
      }
      for (const agent of pedAgents) advanceAgent(agent, safe, agent.gap);
    },
    pose(agent) {
      const p = samplePath(agent.s.path, agent.d * agent.s.length, agent.lateral || 0);
      if (!p) return null;
      return { ...p, lift: agent.s.lift || 0, bridge: agent.s.bridge, name: agent.s.name };
    },
    counts() {
      return {
        carSegments: carSegments.length,
        pedSegments: pedSegments.length,
        cars: carAgents.length,
        peds: pedAgents.length,
        lancasterCars: carAgents.filter((agent) => lancaster(agent.s)).length,
        bridgePeds: pedAgents.filter((agent) => bridge(agent.s)).length,
        bridgeSegments: pedSegments.filter(bridge).length + carSegments.filter(bridge).length,
      };
    },
  };
}

export function roadLengthByName(roads, pattern) {
  let n = 0;
  for (const road of roads || []) {
    if (road.n && pattern.test(road.n)) n += polylineLength(road.pts || []);
  }
  return n;
}
