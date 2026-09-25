import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvasTexture(canvas, { color = true, repeat = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function heightToNormal(height, w, h, strength) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hl = height[y * w + ((x - 1 + w) % w)];
      const hr = height[y * w + ((x + 1) % w)];
      const hd = height[((y + 1) % h) * w + x];
      const hu = height[((y - 1 + h) % h) * w + x];
      let nx = (hl - hr) * strength;
      let ny = (hd - hu) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * One floor, one bay. UVs are metres / bay by metres / floor, so the painted
 * opening lands on the modelled sill.
 * Glass sits in v 0.34–0.78, sill at 0.30, head at 0.80.
 */
export const FAMILIES = {
  limestone: { bay: 3.05, floor: 3.62, winW: 0.36, winH: 0.5, wall: 'ashlar', base: '#ddd6c8', mortar: '#b9b2a4', trim: '#f3eee4', glass: '#243440', blockW: 46, blockH: 28 },
  stone: { bay: 3.28, floor: 3.48, winW: 0.46, winH: 0.46, wall: 'ashlar', base: '#cfc6b8', mortar: '#a79e92', trim: '#e6dfd2', glass: '#1d2a34', blockW: 40, blockH: 24 },
  brick: { bay: 3.12, floor: 3.32, winW: 0.44, winH: 0.44, wall: 'brick', base: '#8d4d3f', mortar: '#d5cfc4', trim: '#e7e0d4', glass: '#1a242c', blockW: 18, blockH: 8 },
  concrete: { bay: 4.4, floor: 3.15, winW: 0.62, winH: 0.22, wall: 'panel', base: '#b7b5ae', mortar: '#8e8c86', trim: '#d5d3cc', glass: '#2a3338', blockW: 64, blockH: 36 },
  arena: { bay: 6.4, floor: 3.1, winW: 0.18, winH: 0.1, wall: 'rib', base: '#6e757c', mortar: '#4c535a', trim: '#c5ccd2', glass: '#1c242c', blockW: 8, blockH: 22 },
  station: { bay: 2.7, floor: 3.2, winW: 0.42, winH: 0.4, wall: 'brick', base: '#7d5848', mortar: '#d9d1c4', trim: '#efe6d6', glass: '#243038', blockW: 16, blockH: 8 },
  glass: { bay: 3.55, floor: 3.55, winW: 0.78, winH: 0.58, wall: 'curtain', base: '#c8c4bc', mortar: '#8d9294', trim: '#eceae4', glass: '#8eafc4', blockW: 20, blockH: 20 },
};

function paintWall(ctx, hgt, w, h, spec, rand) {
  const { wall, base, mortar, blockW, blockH } = spec;
  if (wall === 'brick') {
    ctx.fillStyle = mortar;
    ctx.fillRect(0, 0, w, h);
    for (let y = 0, course = 0; y < h; y += blockH, course++) {
      const shift = course % 2 ? blockW * 0.5 : 0;
      const drift = 0.86 + rand() * 0.22;
      for (let x = -blockW; x < w + blockW; x += blockW) {
        const t = rand();
        ctx.fillStyle = shade(base, drift * (t < 0.08 ? 0.62 : 0.9 + t * 0.22));
        ctx.fillRect(x + shift, y, blockW - 1.4, blockH - 1.3);
        const hh = 0.62 + rand() * 0.12;
        for (let py = 0; py < blockH - 1; py++) {
          for (let px = 0; px < blockW - 1; px++) {
            const ix = Math.floor(x + shift + px);
            const iy = y + py;
            if (ix >= 0 && iy >= 0 && ix < w && iy < h) hgt[iy * w + ix] = hh;
          }
        }
      }
    }
    return;
  }
  if (wall === 'panel') {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    hgt.fill(0.55);
    ctx.strokeStyle = mortar;
    ctx.lineWidth = 3;
    const rows = 4;
    const cols = 2;
    for (let r = 0; r <= rows; r++) {
      const y = (r / rows) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let c = 0; c <= cols; c++) {
      const x = (c / cols) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    return;
  }
  if (wall === 'rib') {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    hgt.fill(0.48);
    const rib = Math.max(6, Math.round(h / 18));
    for (let y = 0; y < h; y += rib) {
      ctx.fillStyle = y % (rib * 2) < rib ? shade(base, 1.08) : shade(base, 0.86);
      ctx.fillRect(0, y, w, rib - 1);
      for (let x = 0; x < w; x++) hgt[y * w + x] = 0.75;
    }
    return;
  }
  if (wall === 'curtain') {
    ctx.fillStyle = shade(base, 0.92);
    ctx.fillRect(0, 0, w, h);
    hgt.fill(0.5);
    return;
  }
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, w, h);
  hgt.fill(0.35);
  for (let y = 0, course = 0; y < h; y += blockH, course++) {
    const shift = course % 2 ? blockW * 0.45 : 0;
    for (let x = -blockW; x < w + blockW; x += blockW) {
      ctx.fillStyle = shade(base, 0.94 + rand() * 0.12);
      ctx.fillRect(x + shift, y, blockW - 1.5, blockH - 1.4);
      const hh = 0.58 + rand() * 0.1;
      for (let py = 1; py < blockH - 2; py++) {
        for (let px = 1; px < blockW - 2; px++) {
          const ix = Math.floor(x + shift + px);
          const iy = y + py;
          if (ix >= 0 && iy >= 0 && ix < w && iy < h) hgt[iy * w + ix] = hh;
        }
      }
    }
  }
}

function paintFacade(spec, seed) {
  const w = 256;
  const h = 384;
  const rand = rng(seed);
  const color = document.createElement('canvas');
  color.width = w;
  color.height = h;
  const emissive = document.createElement('canvas');
  emissive.width = w;
  emissive.height = h;
  const rough = document.createElement('canvas');
  rough.width = w;
  rough.height = h;
  const g = color.getContext('2d');
  const e = emissive.getContext('2d');
  const r = rough.getContext('2d');
  const hgt = new Float32Array(w * h);
  hgt.fill(0.5);
  e.fillStyle = '#000';
  e.fillRect(0, 0, w, h);
  paintWall(g, hgt, w, h, spec, rand);

  const gw = w * spec.winW;
  const gh = h * spec.winH;
  const x = (w - gw) / 2;
  const y = h * (1 - 0.78);
  const glassTop = y;
  const glassBot = y + gh;

  g.fillStyle = spec.trim;
  g.fillRect(0, glassBot, w, Math.max(2, h * 0.035));
  g.fillRect(0, glassTop - h * 0.03, w, Math.max(2, h * 0.03));
  for (let yy = Math.floor(glassBot); yy < Math.min(h, glassBot + h * 0.04); yy++) {
    for (let xx = 0; xx < w; xx++) hgt[yy * w + xx] = 0.92;
  }

  if (spec.wall === 'curtain') {
    g.fillStyle = spec.mortar;
    g.fillRect(0, 0, w * 0.06, h);
    g.fillRect(w * 0.94, 0, w * 0.06, h);
    const grd = g.createLinearGradient(x, glassTop, x, glassBot);
    grd.addColorStop(0, shade(spec.glass, 1.25));
    grd.addColorStop(0.45, spec.glass);
    grd.addColorStop(1, shade(spec.glass, 0.72));
    g.fillStyle = grd;
    g.fillRect(w * 0.07, h * 0.08, w * 0.86, h * 0.78);
    r.fillStyle = 'rgb(0,40,160)';
    r.fillRect(0, 0, w, h);
    r.fillStyle = 'rgb(0,28,190)';
    r.fillRect(w * 0.07, h * 0.08, w * 0.86, h * 0.78);
  } else if (spec.wall !== 'rib') {
    const grd = g.createLinearGradient(x, glassTop, x + gw, glassBot);
    grd.addColorStop(0, shade(spec.glass, 1.35));
    grd.addColorStop(0.4, spec.glass);
    grd.addColorStop(1, shade(spec.glass, 0.55));
    g.fillStyle = grd;
    g.fillRect(x, glassTop, gw, gh);
    g.fillStyle = shade(spec.trim, 0.8);
    g.fillRect(x + gw * 0.48, glassTop, Math.max(2, w * 0.012), gh);
    g.fillRect(x, glassTop + gh * 0.42, gw, Math.max(1, h * 0.008));
    e.fillStyle = 'rgb(40,24,8)';
    e.fillRect(x + 2, glassTop + 2, gw - 4, gh - 4);
    for (let yy = Math.floor(glassTop); yy < glassBot; yy++) {
      for (let xx = Math.floor(x); xx < x + gw; xx++) {
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) hgt[yy * w + xx] = 0.12;
      }
    }
    r.fillStyle = 'rgb(0,214,8)';
    r.fillRect(0, 0, w, h);
    r.fillStyle = 'rgb(0,48,140)';
    r.fillRect(x, glassTop, gw, gh);
  } else {
    r.fillStyle = 'rgb(0,150,40)';
    r.fillRect(0, 0, w, h);
  }

  for (let i = 0; i < 28; i++) {
    const sx = rand() * w;
    const sy = rand() * h;
    const rad = 10 + rand() * 36;
    const wash = g.createRadialGradient(sx, sy, 0, sx, sy, rad);
    wash.addColorStop(0, 'rgba(40,30,20,0.08)');
    wash.addColorStop(1, 'rgba(40,30,20,0)');
    g.fillStyle = wash;
    g.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
  }

  const normal = heightToNormal(hgt, w, h, spec.wall === 'curtain' ? 1.4 : 3.2);
  return {
    map: canvasTexture(color),
    normalMap: canvasTexture(normal, { color: false }),
    roughnessMap: canvasTexture(rough, { color: false }),
    emissiveMap: canvasTexture(emissive),
  };
}

function paintTrim() {
  const w = 256;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const hgt = new Float32Array(w * h);
  g.fillStyle = '#cfc6b8';
  g.fillRect(0, 0, w, h);
  hgt.fill(0.4);
  const bw = 64;
  const bh = 32;
  for (let y = 0, course = 0; y < h; y += bh, course++) {
    const shift = course % 2 ? 28 : 0;
    for (let x = -bw; x < w + bw; x += bw) {
      g.fillStyle = shade('#e6dfd2', 0.94 + ((x + y) % 17) / 80);
      g.fillRect(x + shift, y, bw - 2, bh - 2);
      for (let py = 1; py < bh - 2; py++) {
        for (let px = 1; px < bw - 2; px++) {
          const ix = x + shift + px;
          const iy = y + py;
          if (ix >= 0 && iy >= 0 && ix < w && iy < h) hgt[iy * w + ix] = 0.7;
        }
      }
    }
  }
  const rough = document.createElement('canvas');
  rough.width = w;
  rough.height = h;
  rough.getContext('2d').fillStyle = 'rgb(0,210,6)';
  rough.getContext('2d').fillRect(0, 0, w, h);
  return {
    map: canvasTexture(c),
    normalMap: canvasTexture(heightToNormal(hgt, w, h, 2.4), { color: false }),
    roughnessMap: canvasTexture(rough, { color: false }),
  };
}

function paintRoof(kind) {
  const w = 256;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const hgt = new Float32Array(w * h);
  const rough = document.createElement('canvas');
  rough.width = w;
  rough.height = h;
  const rg = rough.getContext('2d');
  if (kind === 'slate') {
    g.fillStyle = '#3a4048';
    g.fillRect(0, 0, w, h);
    hgt.fill(0.45);
    const tw = 32;
    const th = 18;
    for (let y = 0, row = 0; y < h; y += th, row++) {
      const shift = row % 2 ? tw / 2 : 0;
      for (let x = -tw; x < w + tw; x += tw) {
        g.fillStyle = shade('#4a525c', 0.82 + ((x * 3 + y) % 11) / 28);
        g.fillRect(x + shift, y, tw - 1, th - 1);
        for (let px = 1; px < tw - 2; px++) {
          const ix = Math.floor(x + shift + px);
          const iy = y + 1;
          if (ix >= 0 && iy >= 0 && ix < w && iy < h) hgt[iy * w + ix] = 0.8;
        }
      }
    }
    rg.fillStyle = 'rgb(0,200,20)';
    rg.fillRect(0, 0, w, h);
  } else {
    g.fillStyle = '#2c3034';
    g.fillRect(0, 0, w, h);
    hgt.fill(0.5);
    g.strokeStyle = '#3a4044';
    g.lineWidth = 2;
    for (let y = 0; y <= h; y += 64) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      for (let x = 0; x < w; x++) if (y < h) hgt[y * w + x] = 0.3;
    }
    rg.fillStyle = 'rgb(0,230,8)';
    rg.fillRect(0, 0, w, h);
  }
  return {
    map: canvasTexture(c),
    normalMap: canvasTexture(heightToNormal(hgt, w, h, 2.2), { color: false }),
    roughnessMap: canvasTexture(rough, { color: false }),
  };
}

function paintAsphalt() {
  const w = 256;
  const h = 256;
  const rand = rng(11);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const hgt = new Float32Array(w * h);
  g.fillStyle = '#3a3d40';
  g.fillRect(0, 0, w, h);
  hgt.fill(0.5);
  for (let i = 0; i < 1800; i++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    const tone = rand();
    g.fillStyle = tone > 0.85 ? '#6a6e72' : tone > 0.5 ? '#2a2d30' : '#45484c';
    g.fillRect(x, y, 1 + (rand() > 0.8 ? 1 : 0), 1);
    hgt[y * w + x] = 0.35 + tone * 0.4;
  }
  g.strokeStyle = 'rgba(20,20,22,0.35)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, 40);
  g.bezierCurveTo(80, 48, 140, 20, 255, 36);
  g.stroke();
  const rough = document.createElement('canvas');
  rough.width = w;
  rough.height = h;
  rough.getContext('2d').fillStyle = 'rgb(0,228,4)';
  rough.getContext('2d').fillRect(0, 0, w, h);
  return {
    map: canvasTexture(c),
    normalMap: canvasTexture(heightToNormal(hgt, w, h, 1.6), { color: false }),
    roughnessMap: canvasTexture(rough, { color: false }),
  };
}

function paintConcrete() {
  const w = 256;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const hgt = new Float32Array(w * h);
  hgt.fill(0.55);
  g.fillStyle = '#c4c0b6';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(90,86,78,${0.04 + (i % 5) * 0.015})`;
    g.fillRect((i * 47) % w, (i * 19) % h, 3, 2);
  }
  g.strokeStyle = '#a39e94';
  g.lineWidth = 2;
  g.strokeRect(1, 1, w - 2, h - 2);
  for (let x = 0; x < w; x++) {
    hgt[x] = 0.25;
    hgt[(h - 1) * w + x] = 0.25;
    hgt[x * w] = 0.25;
  }
  const rough = document.createElement('canvas');
  rough.width = w;
  rough.height = h;
  rough.getContext('2d').fillStyle = 'rgb(0,220,6)';
  rough.getContext('2d').fillRect(0, 0, w, h);
  return {
    map: canvasTexture(c),
    normalMap: canvasTexture(heightToNormal(hgt, w, h, 1.8), { color: false }),
    roughnessMap: canvasTexture(rough, { color: false }),
  };
}

function paintGravel() {
  const w = 128;
  const h = 128;
  const rand = rng(4);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#6d6558';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = rand() > 0.5 ? '#8a8172' : '#4e493f';
    g.fillRect(rand() * w, rand() * h, 2, 2);
  }
  const rough = document.createElement('canvas');
  rough.width = 4;
  rough.height = 4;
  rough.getContext('2d').fillStyle = 'rgb(0,235,2)';
  rough.getContext('2d').fillRect(0, 0, 4, 4);
  return {
    map: canvasTexture(c),
    roughnessMap: canvasTexture(rough, { color: false }),
  };
}

function paintField() {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const stripes = 18;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 === 0 ? '#2c7a34' : '#257030';
    g.fillRect((i * w) / stripes, 0, w / stripes + 1, h);
  }
  g.fillStyle = '#0c2340';
  g.fillRect(0, 0, w * 0.07, h);
  g.fillRect(w * 0.93, 0, w * 0.07, h);
  g.strokeStyle = '#f2f5f2';
  g.lineWidth = 4;
  g.strokeRect(w * 0.07, 14, w * 0.86, h - 28);
  g.lineWidth = 3;
  for (let i = 0; i <= 12; i++) {
    const x = w * (0.07 + 0.86 * (i / 12));
    g.beginPath();
    g.moveTo(x, 14);
    g.lineTo(x, h - 14);
    g.stroke();
  }
  g.lineWidth = 2;
  for (let i = 1; i < 12; i++) {
    const x = w * (0.07 + 0.86 * (i / 12));
    g.beginPath();
    g.moveTo(x, h * 0.38);
    g.lineTo(x, h * 0.46);
    g.moveTo(x, h * 0.54);
    g.lineTo(x, h * 0.62);
    g.stroke();
  }
  const tex = canvasTexture(c, { repeat: false });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function createTextures() {
  const families = {};
  let seed = 3;
  for (const [name, spec] of Object.entries(FAMILIES)) {
    families[name] = paintFacade(spec, seed);
    seed += 17;
  }
  return {
    families,
    trim: paintTrim(),
    membrane: paintRoof('membrane'),
    slate: paintRoof('slate'),
    asphalt: paintAsphalt(),
    concrete: paintConcrete(),
    gravel: paintGravel(),
    field: paintField(),
  };
}
