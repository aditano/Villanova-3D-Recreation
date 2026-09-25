/**
 * Refresh the Villanova campus extract.
 *
 * Pulls buildings, roads, paths, rail, lawns, pitches, and water from the
 * Overpass API, projects them into local metres (+X east, +Y up, +Z south),
 * samples a lightweight USGS/Terrarium elevation grid, and writes
 * public/data/villanova.json.
 *
 *   node scripts/fetch-campus.mjs
 *   node scripts/fetch-campus.mjs --refresh
 *
 * The bbox is the main campus in Radnor Township: Lancaster Avenue along the
 * south, west campus / Ithan Avenue, north toward Dundale, and east through
 * the law school — stopping short of Rosemont College.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { resolveBuilding } from '../src/height-rules.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/data/villanova.json');
const CACHE = join(ROOT, 'scripts/osm-cache');

/** St. Thomas of Villanova Church, from the OSM way center. */
const LAT0 = 40.03598;
const LON0 = -75.34329;
const DEG = 111320;
const M_LAT = DEG;
const M_LON = DEG * Math.cos((LAT0 * Math.PI) / 180);

const BBOX = { south: 40.0278, west: -75.3515, north: 40.0465, east: -75.3335 };

const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const ZOOM = 15;
const GRID_STEP = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function project(lat, lon) {
  return [(lon - LON0) * M_LON, -((lat - LAT0) * M_LAT)];
}

function unproject(x, z) {
  return [LAT0 - z / M_LAT, LON0 + x / M_LON];
}

function ringArea(ring) {
  let a = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) a += ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1];
  return a / 2;
}

function ringCentroid(ring) {
  let x = 0;
  let z = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    z += ring[i][1];
  }
  return [x / n, z / n];
}

function closeRing(ring) {
  if (!ring || ring.length < 3) return null;
  const a = ring[0];
  const b = ring[ring.length - 1];
  const out = ring.map(([x, z]) => [round(x), round(z)]);
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.05) out.push([out[0][0], out[0][1]]);
  return out.length >= 4 ? out : null;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function simplify(ring, tolerance) {
  if (!ring || ring.length <= 5) return ring;
  const closed = Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 0.05;
  const pts = closed ? ring.slice(0, -1) : ring.slice();
  if (pts.length <= 4) return ring;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let far = -1;
    let best = tolerance;
    const [ax, az] = pts[lo];
    const [bx, bz] = pts[hi];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    for (let i = lo + 1; i < hi; i++) {
      const d = Math.abs(dx * (az - pts[i][1]) - dz * (ax - pts[i][0])) / len;
      if (d > best) {
        best = d;
        far = i;
      }
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([lo, far], [far, hi]);
    }
  }
  const out = pts.filter((_, i) => keep[i]).map(([x, z]) => [round(x), round(z)]);
  if (out.length < 3) return ring;
  out.push([out[0][0], out[0][1]]);
  return out;
}

function lineFromGeometry(geometry) {
  if (!geometry || geometry.length < 2) return null;
  const pts = geometry.map((g) => {
    const [x, z] = project(g.lat, g.lon);
    return [round(x), round(z)];
  });
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1];
    if (Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]) > 0.4) out.push(pts[i]);
  }
  return out.length >= 2 ? out : null;
}

function ringFromGeometry(geometry) {
  const line = lineFromGeometry(geometry);
  return closeRing(line);
}

async function overpass(name, query, refresh) {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  const cachePath = join(CACHE, `${name}.json`);
  if (!refresh && existsSync(cachePath)) {
    console.log(`  ${name}: cache`);
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  }
  let lastErr = null;
  for (let attempt = 0; attempt < ENDPOINTS.length * 3; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'villanova-3d-recreation/1.0 (campus extract)',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ data: query }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith('<')) {
        throw new Error(`${res.status} ${text.slice(0, 180).replace(/\s+/g, ' ')}`);
      }
      const json = JSON.parse(text);
      if (!json.elements) throw new Error('no elements');
      writeFileSync(cachePath, JSON.stringify(json));
      console.log(`  ${name}: ${json.elements.length} elements (${url.split('/')[2]})`);
      return json;
    } catch (err) {
      lastErr = err;
      console.log(`  ${name}: attempt ${attempt + 1} failed (${err.message})`);
      await sleep(2500 * (attempt + 1));
    }
  }
  throw new Error(`Overpass failed for ${name}: ${lastErr?.message}`);
}

function parseHeight(tags) {
  const raw = tags.height || tags['building:height'];
  if (raw) {
    const s = String(raw).trim().toLowerCase();
    const ft = s.match(/([0-9.]+)\s*'/ ) || s.match(/([0-9.]+)\s*ft/);
    if (ft) {
      const m = parseFloat(ft[1]) * 0.3048;
      if (m > 2 && m < 80) return { h: round(m), source: 'height' };
    }
    const num = s.match(/([0-9.]+)/);
    if (num) {
      const m = parseFloat(num[1]);
      if (m > 2 && m < 80) return { h: round(m), source: 'height' };
    }
  }
  const levels = parseFloat(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0 && levels < 30) {
    return { h: round(levels * 3.45 + 1.1), source: 'levels' };
  }
  return null;
}

const KIND_HEIGHT = {
  church: 20,
  chapel: 11,
  cathedral: 22,
  university: 15,
  college: 14,
  public: 12,
  dormitory: 13,
  residential: 10,
  apartments: 13,
  hotel: 12,
  stadium: 14,
  sports_hall: 18,
  sports_centre: 15,
  train_station: 7,
  transportation: 7,
  parking: 11,
  garage: 9,
  house: 7,
  detached: 7,
  semidetached_house: 7,
  terrace: 8,
  roof: 4,
  industrial: 8,
  warehouse: 7,
  service: 6,
  commercial: 10,
  retail: 7,
  office: 12,
  hospital: 14,
  school: 12,
  kindergarten: 6,
  yes: 10,
};

function buildingHeight(tags, name) {
  const parsed = parseHeight(tags);
  if (parsed) return parsed;
  const kind = tags.building || 'yes';
  let h = KIND_HEIGHT[kind] ?? 10;
  if (/church/i.test(name) && !/monastery/i.test(name)) h = Math.max(h, 20);
  if (/monastery/i.test(name)) h = 12;
  if (/pavilion|arena/i.test(name)) h = Math.max(h, 18);
  if (/stadium/i.test(name)) h = Math.max(h, 14);
  if (/garage|parking/i.test(name)) h = Math.max(h, 10);
  return { h, source: 'default' };
}

function adjustDefaultHeight(name, fam, area, h, source, id = 0) {
  if (source !== 'default') return h;
  const n = name.toLowerCase();
  if (n === 'falvey memorial library' || n === 'old falvey hall') return 17;
  if (n === 'connelly center') return 12;
  if (n === 'dougherty hall' || n === 'corr hall' || n === 'vasey hall') return 14;
  if (n.includes('mullen center')) return 12;
  if (area > 2500 && fam === 'stone') return Math.max(h, 14);
  if (area > 4500 && fam === 'concrete') return Math.max(h, 14);
  if (!name) {
    const steps = 3 + (id % 4);
    return Math.max(h, round(steps * 3.2 + (area > 600 ? 1.5 : 0)));
  }
  return h;
}

function familyFor(tags, name, id = 0) {
  const n = name.toLowerCase();
  const kind = tags.building || '';
  if (/church|chapel/.test(kind) || /church|chapel|tolentine|alumni hall|garey|corr hall/.test(n)) return 'limestone';
  if (/pavilion|arena|stadium|athletic|davis center|talley/.test(n) || /stadium|sports/.test(kind)) return 'arena';
  if (/station/.test(n) || kind === 'train_station') return 'station';
  if (kind === 'parking' || kind === 'garage' || /garage|parking/.test(n)) return 'concrete';
  if (/falvey|mendel|bartley|connelly|law|library|science|dougherty|vasey|driscoll|white hall|ceer|engineering/.test(n)) {
    return 'stone';
  }
  if (kind === 'university' || kind === 'college' || kind === 'office') return 'stone';
  if (kind === 'dormitory' || kind === 'residential' || kind === 'apartments' || kind === 'house') return 'brick';
  if (/hall$/.test(n)) return 'brick';
  if (!name) {
    const h = Math.abs(Math.sin(id * 12.9898));
    if (h < 0.42) return 'brick';
    if (h < 0.62) return 'concrete';
    return 'stone';
  }
  return 'stone';
}

const ROAD_CLASS = {
  motorway: 16,
  trunk: 14,
  primary: 13,
  secondary: 10,
  tertiary: 8,
  unclassified: 6,
  residential: 6,
  living_street: 5,
  service: 4.2,
  busway: 7,
};

const PATH_CLASS = {
  pedestrian: 3.2,
  footway: 1.8,
  path: 1.5,
  cycleway: 2.2,
  steps: 1.6,
  track: 2.6,
  bridleway: 1.6,
};

function inBbox(lat, lon, pad = 0) {
  return (
    lat >= BBOX.south - pad &&
    lat <= BBOX.north + pad &&
    lon >= BBOX.west - pad &&
    lon <= BBOX.east + pad
  );
}

function polylineInFrame(pts) {
  return pts.some(([x, z]) => {
    const [lat, lon] = unproject(x, z);
    return inBbox(lat, lon, 0.0004);
  });
}

function stitchOuters(members) {
  const ways = [];
  for (const m of members || []) {
    if (m.role === 'inner' || !m.geometry) continue;
    const line = lineFromGeometry(m.geometry);
    if (line) ways.push(line);
  }
  const key = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const rings = [];
  const pool = [];
  for (const w of ways) {
    if (key(w[0]) === key(w[w.length - 1]) && w.length >= 4) rings.push(w);
    else pool.push(w.slice());
  }
  const used = new Uint8Array(pool.length);
  for (let i = 0; i < pool.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = pool[i].slice();
    for (let guard = 0; guard < pool.length + 2; guard++) {
      const tail = key(chain[chain.length - 1]);
      if (tail === key(chain[0]) && chain.length >= 4) break;
      let next = -1;
      let flip = false;
      for (let j = 0; j < pool.length; j++) {
        if (used[j]) continue;
        if (key(pool[j][0]) === tail) {
          next = j;
          flip = false;
          break;
        }
        if (key(pool[j][pool[j].length - 1]) === tail) {
          next = j;
          flip = true;
          break;
        }
      }
      if (next < 0) break;
      used[next] = 1;
      const w = flip ? pool[next].slice().reverse() : pool[next];
      chain = chain.concat(w.slice(1));
    }
    if (key(chain[0]) === key(chain[chain.length - 1]) && chain.length >= 4) rings.push(chain);
  }
  let best = null;
  for (const r of rings) {
    const closed = closeRing(r);
    if (!closed) continue;
    if (!best || Math.abs(ringArea(closed)) > Math.abs(ringArea(best))) best = closed;
  }
  return best;
}

function elementRing(el) {
  if (el.type === 'way') return ringFromGeometry(el.geometry);
  if (el.type === 'relation') return stitchOuters(el.members);
  return null;
}

function elementLine(el) {
  if (el.type === 'way') return lineFromGeometry(el.geometry);
  return null;
}

const LANDMARK_RULES = [
  { id: 'church', label: 'St. Thomas of Villanova', preset: 'church', test: (n) => n === 'st. thomas of villanova church' },
  { id: 'connelly', label: 'Connelly Center', preset: null, test: (n) => n === 'connelly center' },
  { id: 'falvey', label: 'Falvey Library', preset: 'library', test: (n) => n === 'falvey memorial library' },
  { id: 'pavilion', label: 'Finneran Pavilion', preset: null, test: (n) => n === 'finneran pavilion' },
  { id: 'mendel', label: 'Mendel Hall', preset: null, test: (n) => n === 'mendel hall' },
  { id: 'tolentine', label: 'Tolentine Hall', preset: null, test: (n) => n === 'tolentine hall' },
  { id: 'bartley', label: 'Bartley Hall', preset: null, test: (n) => n === 'bartley hall' },
  { id: 'garey', label: 'Garey Hall', preset: null, test: (n) => n === 'garey hall' },
  { id: 'law', label: 'Widger School of Law', preset: null, test: (n) => n === 'charles widger school of law' },
  { id: 'alumni', label: 'Alumni Hall', preset: null, test: (n) => n === 'alumni hall' },
  { id: 'station', label: 'Villanova Station', preset: 'station', sub: 'SEPTA', test: (n) => n === 'villanova station' },
];

function lonToTileX(lon, z) {
  return ((lon + 180) / 360) * 2 ** z;
}
function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

async function fetchTile(tx, ty, refresh) {
  const dir = join(CACHE, 'terrain');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${ZOOM}-${tx}-${ty}.png`);
  if (refresh || !existsSync(path)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tx}/${ty}.png`;
    let buf = null;
    let last = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        buf = Buffer.from(await res.arrayBuffer());
        break;
      } catch (err) {
        last = err;
        await sleep(800 * (attempt + 1));
      }
    }
    if (!buf) throw new Error(`tile ${tx}/${ty}: ${last?.message}`);
    writeFileSync(path, buf);
  }
  const png = PNG.sync.read(readFileSync(path));
  const size = png.width;
  const elev = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const r = png.data[i * 4];
    const g = png.data[i * 4 + 1];
    const b = png.data[i * 4 + 2];
    elev[i] = r * 256 + g + b / 256 - 32768;
  }
  return { elev, size };
}

function sampleTiles(tiles, lat, lon) {
  const fx = lonToTileX(lon, ZOOM);
  const fy = latToTileY(lat, ZOOM);
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  const tile = tiles.get(`${tx},${ty}`);
  if (!tile) return null;
  const x = (fx - tx) * tile.size - 0.5;
  const y = (fy - ty) * tile.size - 0.5;
  const x0 = Math.max(0, Math.min(tile.size - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(tile.size - 1, Math.floor(y)));
  const x1 = Math.max(0, Math.min(tile.size - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(tile.size - 1, y0 + 1));
  const txu = Math.max(0, Math.min(1, x - x0));
  const tyv = Math.max(0, Math.min(1, y - y0));
  const a = tile.elev[y0 * tile.size + x0];
  const b = tile.elev[y0 * tile.size + x1];
  const c = tile.elev[y1 * tile.size + x0];
  const d = tile.elev[y1 * tile.size + x1];
  return (a * (1 - txu) + b * txu) * (1 - tyv) + (c * (1 - txu) + d * txu) * tyv;
}

async function buildTerrain(refresh) {
  const pad = 30;
  const [latN, lonW] = unproject(-780, -1300);
  const [latS, lonE] = unproject(900, 900);
  const minX = -780;
  const minZ = -1300;
  const maxX = 900;
  const maxZ = 900;
  const cols = Math.ceil((maxX - minX) / GRID_STEP) + 1;
  const rows = Math.ceil((maxZ - minZ) / GRID_STEP) + 1;

  const corners = [
    [BBOX.south, BBOX.west],
    [BBOX.south, BBOX.east],
    [BBOX.north, BBOX.west],
    [BBOX.north, BBOX.east],
    [latS, lonW],
    [latN, lonE],
  ];
  const txs = corners.map((c) => Math.floor(lonToTileX(c[1], ZOOM)));
  const tys = corners.map((c) => Math.floor(latToTileY(c[0], ZOOM)));
  const tx0 = Math.min(...txs);
  const tx1 = Math.max(...txs);
  const ty0 = Math.min(...tys);
  const ty1 = Math.max(...tys);

  const tiles = new Map();
  try {
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        tiles.set(`${tx},${ty}`, await fetchTile(tx, ty, refresh));
      }
    }
  } catch (err) {
    console.log(`  terrain tiles failed (${err.message}); using a gentle grade`);
    return fallbackTerrain(minX, minZ, cols, rows);
  }

  const originElev = sampleTiles(tiles, LAT0, LON0);
  if (originElev == null) return fallbackTerrain(minX, minZ, cols, rows);

  const grid = new Int16Array(cols * rows);
  let misses = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = minX + col * GRID_STEP;
      const z = minZ + row * GRID_STEP;
      const [lat, lon] = unproject(x, z);
      const elev = sampleTiles(tiles, lat, lon);
      if (elev == null) {
        misses++;
        grid[row * cols + col] = 0;
      } else {
        const rel = (elev - originElev) * 10;
        grid[row * cols + col] = Math.max(-32768, Math.min(32767, Math.round(rel)));
      }
    }
  }
  console.log(
    `  terrain ${cols}x${rows} @ ${GRID_STEP}m, datum ${originElev.toFixed(1)} m, misses ${misses}, tiles ${tiles.size}`,
  );
  const bytes = Buffer.from(grid.buffer, grid.byteOffset, grid.byteLength);
  return {
    source: 'AWS elevation-tiles terrarium (Mapzen RGB / USGS 3DEP composite)',
    zoom: ZOOM,
    datumM: round(originElev),
    minX,
    minZ,
    step: GRID_STEP,
    cols,
    rows,
    pad,
    data: bytes.toString('base64'),
  };
}

function fallbackTerrain(minX, minZ, cols, rows) {
  const grid = new Int16Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const z = minZ + row * GRID_STEP;
      const x = minX + col * GRID_STEP;
      const y = z * -0.012 + x * 0.004;
      grid[row * cols + col] = Math.round(y * 10);
    }
  }
  const bytes = Buffer.from(grid.buffer, grid.byteOffset, grid.byteLength);
  return {
    source: 'fallback gentle grade (terrarium unavailable)',
    zoom: null,
    datumM: null,
    minX,
    minZ,
    step: GRID_STEP,
    cols,
    rows,
    data: bytes.toString('base64'),
  };
}

function bboxQuery() {
  const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  return `[out:json][timeout:180];
(
  way["building"](${b});
  relation["building"](${b});
  way["highway"](${b});
  way["railway"~"^(rail|light_rail|platform)$"](${b});
  way["leisure"~"^(park|garden|pitch|stadium|recreation_ground|common|track)$"](${b});
  relation["leisure"~"^(park|garden|pitch|stadium|recreation_ground)$"](${b});
  way["landuse"~"^(grass|meadow|forest|recreation_ground|village_green|cemetery|flowerbed)$"](${b});
  relation["landuse"~"^(grass|meadow|forest|recreation_ground|village_green)$"](${b});
  way["natural"~"^(water|wood)$"](${b});
  relation["natural"~"^(water|wood)$"](${b});
  way["waterway"~"^(riverbank|dock|basin)$"](${b});
  node["railway"="station"](${b});
  node["public_transport"="station"](${b});
);
out tags geom;`;
}

function pointInRing(x, z, poly) {
  let inside = false;
  const n = poly.length - 1;
  for (let i = 0, j = n - 1; i < n; i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi) inside = !inside;
    j = i;
  }
  return inside;
}

function localFrame() {
  const corners = [
    project(BBOX.south, BBOX.west),
    project(BBOX.south, BBOX.east),
    project(BBOX.north, BBOX.west),
    project(BBOX.north, BBOX.east),
  ];
  const pad = 24;
  return {
    minX: Math.min(...corners.map((c) => c[0])) - pad,
    maxX: Math.max(...corners.map((c) => c[0])) + pad,
    minZ: Math.min(...corners.map((c) => c[1])) - pad,
    maxZ: Math.max(...corners.map((c) => c[1])) + pad,
  };
}

/** Clip a polyline to the campus frame, splitting it where it leaves the box. */
function clipPolyline(pts, box) {
  const runs = [];
  let cur = [];
  const push = (x, z) => {
    const p = [round(x), round(z)];
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.35) cur.push(p);
  };
  const seg = (a, b) => {
    let t0 = 0;
    let t1 = 1;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const p = [-dx, dx, -dz, dz];
    const q = [a[0] - box.minX, box.maxX - a[0], a[1] - box.minZ, box.maxZ - a[1]];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-12) {
        if (q[i] < 0) return null;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > t1) return null;
          if (t > t0) t0 = t;
        } else {
          if (t < t0) return null;
          if (t < t1) t1 = t;
        }
      }
    }
    return [
      [a[0] + t0 * dx, a[1] + t0 * dz],
      [a[0] + t1 * dx, a[1] + t1 * dz],
    ];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const hit = seg(pts[i], pts[i + 1]);
    if (!hit) {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
      continue;
    }
    if (!cur.length) push(hit[0][0], hit[0][1]);
    else if (Math.hypot(cur[cur.length - 1][0] - hit[0][0], cur[cur.length - 1][1] - hit[0][1]) > 1.2) {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
      push(hit[0][0], hit[0][1]);
    }
    push(hit[1][0], hit[1][1]);
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

function dedupeGreens(list) {
  const kept = [];
  const ranked = list
    .map((g) => ({ g, area: Math.abs(ringArea(g.f)), c: ringCentroid(g.f) }))
    .sort((a, b) => b.area - a.area);
  for (const item of ranked) {
    const dup = kept.some((k) => {
      const dist = Math.hypot(k.c[0] - item.c[0], k.c[1] - item.c[1]);
      const ratio = item.area / (k.area || 1);
      return dist < 25 && ratio > 0.82 && ratio < 1.18;
    });
    if (!dup) kept.push(item);
  }
  return kept.map((k) => k.g);
}

function pickQuad(greens, church) {
  if (!church) return null;
  const probes = [
    [80, 80],
    [90, 70],
    [60, 70],
    [120, 90],
  ];
  let best = null;
  for (const g of greens) {
    if (g.kind !== 'grass') continue;
    if (g.n && /cemetery|field|tract|garden|ellipse/i.test(g.n)) continue;
    const area = Math.abs(ringArea(g.f));
    if (area < 4000 || area > 80000) continue;
    const hit = probes.find(([x, z]) => pointInRing(church.x + x, church.z + z, g.f));
    if (!hit) continue;
    if (!best || area > best.area) {
      best = {
        g,
        area,
        x: church.x + hit[0],
        z: church.z + hit[1],
      };
    }
  }
  return best;
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  console.log('Fetching campus OSM…');
  const osm = await overpass('campus', bboxQuery(), refresh);
  const timestamp = osm.osm3s?.timestamp_osm_base || null;

  const buildings = [];
  const roads = [];
  const paths = [];
  const rail = [];
  const greens = [];
  const pitches = [];
  const water = [];
  const plazas = [];
  const stations = [];
  let stadium = null;

  for (const el of osm.elements) {
    const tags = el.tags || {};
    const name = tags.name || '';

    if (el.type === 'node' && (tags.railway === 'station' || tags.public_transport === 'station')) {
      if (!inBbox(el.lat, el.lon)) continue;
      const [x, z] = project(el.lat, el.lon);
      stations.push({
        id: el.id,
        name: name || 'Station',
        x: round(x),
        z: round(z),
        osm: `node/${el.id}`,
      });
      continue;
    }

    if (tags.building) {
      const ring = elementRing(el);
      if (!ring) continue;
      const simple = simplify(ring, 0.45);
      const area = Math.abs(ringArea(simple));
      if (area < 18) continue;
      const [cx, cz] = ringCentroid(simple);
      const [lat, lon] = unproject(cx, cz);
      if (!inBbox(lat, lon)) continue;
      const height = buildingHeight(tags, name);
      const kind = tags.building;
      const fam = familyFor(tags, name, el.id);
      const drafted = {
        id: el.id,
        osm: `${el.type}/${el.id}`,
        n: name,
        kind,
        h: adjustDefaultHeight(name, fam, area, height.h, height.source, el.id),
        hs: height.source,
        fam,
        f: simple,
      };
      const spec = resolveBuilding(drafted);
      buildings.push({ ...drafted, h: spec.h, hs: spec.hs, fam: spec.fam, spire: spec.spire || undefined });
      if (/stadium/i.test(name) && area > 1500) {
        stadium = { name, outer: simple, h: Math.max(height.h, 14), osm: `${el.type}/${el.id}` };
      }
      continue;
    }

    if (tags.highway && el.type === 'way') {
      const cls = tags.highway;
      if (['proposed', 'construction', 'elevator', 'corridor', 'raceway', 'services', 'platform', 'bus_stop', 'escape'].includes(cls)) {
        continue;
      }
      const line = elementLine(el);
      if (!line || !polylineInFrame(line)) continue;
      const closed =
        Math.hypot(line[0][0] - line[line.length - 1][0], line[0][1] - line[line.length - 1][1]) < 0.8 &&
        line.length >= 4;
      if ((cls === 'pedestrian' || cls === 'footway') && (tags.area === 'yes' || closed)) {
        const ring = closeRing(line);
        if (ring && Math.abs(ringArea(ring)) > 40) {
          plazas.push({ id: el.id, n: name, f: simplify(ring, 0.6) });
          continue;
        }
      }
      const traffic = {
        oneway: tags.oneway || '',
        lanes: Number(tags.lanes) || 0,
        bridge: tags.bridge === 'yes' || tags.bridge === 'viaduct',
        tunnel: tags.tunnel === 'yes' || tags.tunnel === 'building_passage',
        layer: Number(tags.layer) || 0,
      };
      if (ROAD_CLASS[cls]) {
        roads.push({ id: el.id, n: name, cls, w: ROAD_CLASS[cls], pts: line, ...traffic });
      } else if (PATH_CLASS[cls]) {
        paths.push({ id: el.id, cls, w: PATH_CLASS[cls], pts: line, ...traffic });
      }
      continue;
    }

    if (tags.railway && el.type === 'way') {
      const line = elementLine(el);
      if (!line || !polylineInFrame(line)) continue;
      rail.push({ id: el.id, n: name, cls: tags.railway, pts: line });
      continue;
    }

    const leisure = tags.leisure;
    const landuse = tags.landuse;
    const natural = tags.natural;
    if (leisure || landuse || natural === 'wood' || natural === 'water' || tags.waterway) {
      const ring = elementRing(el);
      if (!ring) continue;
      const simple = simplify(ring, 1.1);
      const area = Math.abs(ringArea(simple));
      if (area < 40 || area > 400000) continue;
      const [cx, cz] = ringCentroid(simple);
      const [lat, lon] = unproject(cx, cz);
      if (!inBbox(lat, lon, 0.0008)) continue;
      if (natural === 'water' || tags.waterway || tags.water) {
        water.push({ id: el.id, n: name, f: simple });
        continue;
      }
      if (leisure === 'pitch') {
        pitches.push({ id: el.id, n: name, sport: tags.sport || '', f: simple });
        continue;
      }
      if (leisure === 'stadium' || /stadium/i.test(name)) {
        const candidate = { name: name || 'Villanova Stadium', outer: simple, h: 15, osm: `${el.type}/${el.id}`, area };
        if (!stadium || area > (stadium.area || 0)) stadium = candidate;
        continue;
      }
      let kind = 'grass';
      if (natural === 'wood' || landuse === 'forest') kind = 'wood';
      else if (leisure === 'garden' || landuse === 'flowerbed') kind = 'garden';
      else if (landuse === 'cemetery') kind = 'cemetery';
      greens.push({ id: el.id, n: name, kind, f: simple });
    }
  }

  const frame = localFrame();
  const clipList = (list) => {
    const out = [];
    for (const item of list) {
      for (const pts of clipPolyline(item.pts, frame)) {
        if (pts.length < 2) continue;
        out.push({ ...item, pts });
      }
    }
    return out;
  };
  const clippedRoads = clipList(roads);
  const clippedPaths = clipList(paths);
  const clippedRail = clipList(rail);
  roads.length = 0;
  paths.length = 0;
  rail.length = 0;
  roads.push(...clippedRoads);
  paths.push(...clippedPaths);
  rail.push(...clippedRail);

  const dedupedGreens = dedupeGreens(greens);
  greens.length = 0;
  greens.push(...dedupedGreens);

  const landmarks = [];
  for (const rule of LANDMARK_RULES) {
    const matches = buildings.filter((b) => b.n && rule.test(b.n.toLowerCase()));
    if (!matches.length) {
      if (rule.id === 'station') {
        const node = stations.find((s) => /villanova/i.test(s.name));
        if (node) {
          landmarks.push({
            id: 'station',
            name: node.name,
            label: rule.label,
            sub: 'SEPTA',
            preset: 'station',
            x: node.x,
            z: node.z,
            h: 8,
            osm: node.osm,
          });
        }
      }
      continue;
    }
    matches.sort((a, b) => Math.abs(ringArea(b.f)) - Math.abs(ringArea(a.f)));
    const b = matches[0];
    const [x, z] = ringCentroid(b.f);
    landmarks.push({
      id: rule.id,
      name: b.n,
      label: rule.label,
      sub: rule.sub || '',
      preset: rule.preset,
      x: round(x),
      z: round(z),
      h: b.h,
      osm: b.osm,
      fam: b.fam,
    });
  }

  const church = landmarks.find((l) => l.id === 'church');
  const quadPick = pickQuad(greens, church);
  if (quadPick) {
    landmarks.push({
      id: 'quad',
      name: 'Main Quad',
      label: 'Main Quad',
      sub: 'Open lawn south of the church',
      preset: 'quad',
      x: round(quadPick.x),
      z: round(quadPick.z),
      h: 0,
      inferred: true,
      osm: `${quadPick.g.id ? 'way/' + quadPick.g.id : ''}`,
    });
  } else if (church) {
    landmarks.push({
      id: 'quad',
      name: 'Main Quad',
      label: 'Main Quad',
      sub: 'Inferred lawn south of the church',
      preset: 'quad',
      x: round(church.x),
      z: round(church.z + 55),
      h: 0,
      inferred: true,
    });
  }

  if (stadium) {
    const [x, z] = ringCentroid(stadium.outer);
    const existing = landmarks.find((l) => l.id === 'stadium');
    if (!existing) {
      landmarks.push({
        id: 'stadium',
        name: stadium.name || 'Villanova Stadium',
        label: 'Villanova Stadium',
        preset: 'stadium',
        x: round(x),
        z: round(z),
        h: stadium.h,
        osm: stadium.osm || '',
      });
    }
    let inner = null;
    let innerArea = 0;
    for (const p of pitches) {
      const [px, pz] = ringCentroid(p.f);
      if (!pointInRing(px, pz, stadium.outer)) continue;
      const a = Math.abs(ringArea(p.f));
      if (a > innerArea) {
        inner = p.f;
        innerArea = a;
      }
    }
    stadium = {
      name: stadium.name || 'Villanova Stadium',
      outer: stadium.outer,
      inner,
      h: stadium.h,
      osm: stadium.osm || '',
    };
  }

  const terrain = await buildTerrain(refresh);

  const data = {
    meta: {
      name: 'Villanova University',
      place: 'Villanova, Pennsylvania',
      axes: '+X east, +Y up, +Z south',
      origin: {
        lat: LAT0,
        lon: LON0,
        note: 'St. Thomas of Villanova Church (OSM way center)',
      },
      bbox: BBOX,
      osmTimestamp: timestamp,
      generated: new Date().toISOString(),
      copyright: '© OpenStreetMap contributors',
      license: 'Open Database License (ODbL)',
      disclaimer:
        'Procedural campus maquette from OpenStreetMap. Not photogrammetry and not an official Villanova University plan, CAD model, or facilities drawing.',
    },
    terrain,
    buildings,
    roads,
    paths,
    rail,
    greens,
    pitches,
    water,
    plazas,
    stadium,
    landmarks,
  };

  if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(data));

  const counts = {
    buildings: buildings.length,
    named: buildings.filter((b) => b.n).length,
    roads: roads.length,
    paths: paths.length,
    rail: rail.length,
    greens: greens.length,
    pitches: pitches.length,
    water: water.length,
    plazas: plazas.length,
    landmarks: landmarks.map((l) => l.id),
    stadium: stadium ? stadium.name : null,
    bytes: Buffer.byteLength(JSON.stringify(data)),
  };
  console.log(JSON.stringify(counts, null, 2));
  for (const l of landmarks) console.log(`  ${l.id}: ${l.name} @ ${l.x}, ${l.z} h=${l.h}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
