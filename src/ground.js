import * as THREE from 'three';
import { pointInPoly } from './geo.js';
import { corridorHalf, roadProfile } from './road-profile.js';

const NOISE = `
float gHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float gNoise(vec2 p){
  vec2 i=floor(p); vec2 f=fract(p);
  float a=gHash(i);
  float b=gHash(i+vec2(1.0,0.0));
  float c=gHash(i+vec2(0.0,1.0));
  float d=gHash(i+vec2(1.0,1.0));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float gFbm(vec2 p){
  float v=0.0; float a=0.5;
  v+=a*gNoise(p); p=p*2.02+vec2(1.7,8.3); a*=0.5;
  v+=a*gNoise(p); p=p*2.01+vec2(8.1,2.8); a*=0.5;
  v+=a*gNoise(p);
  return v;
}
float grassH(vec2 p){
  return gFbm(p*0.07)*0.62 + gFbm(p*0.31)*0.28 + gNoise(p*1.35)*0.10;
}
`;

function openRing(ring) {
  if (!ring?.length) return [];
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) return ring.slice(0, -1);
  return ring.slice();
}

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function stamp(data, size, minX, minZ, spanX, spanZ, x, z, radius, channel, value) {
  const cx = ((x - minX) / spanX) * (size - 1);
  const cy = ((z - minZ) / spanZ) * (size - 1);
  const rx = radius / (spanX / (size - 1));
  const ry = radius / (spanZ / (size - 1));
  const r = Math.ceil(Math.max(rx, ry));
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(size - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(size - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let xPix = x0; xPix <= x1; xPix++) {
      const dx = (xPix - cx) / (rx || 1);
      const dy = (y - cy) / (ry || 1);
      const d = Math.hypot(dx, dy);
      if (d > 1) continue;
      const i = (y * size + xPix) * 4 + channel;
      const fall = 1 - d;
      data[i] = Math.max(data[i], Math.round(value * Math.min(1, fall * 1.35)));
    }
  }
}

function walkPolyline(pts, step, fn) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      fn(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, len);
    }
  }
}

export function buildWearMap(data) {
  const { minX, minZ, step, cols, rows } = data.terrain;
  const spanX = (cols - 1) * step;
  const spanZ = (rows - 1) * step;
  const size = 1024;
  const pixels = new Uint8Array(size * size * 4);

  for (const road of data.roads || []) {
    const profile = roadProfile(road);
    const half = corridorHalf(profile);
    walkPolyline(road.pts, 6, (x, z) => {
      stamp(pixels, size, minX, minZ, spanX, spanZ, x, z, half * 0.92, 0, 255);
      stamp(pixels, size, minX, minZ, spanX, spanZ, x, z, half + 3.2, 1, 150);
      stamp(pixels, size, minX, minZ, spanX, spanZ, x, z, half + 2.4, 3, 255);
    });
  }
  for (const path of data.paths || []) {
    const half = Math.max(path.w || 1.6, 2.1) * 0.5;
    walkPolyline(path.pts, 5, (x, z) => {
      stamp(pixels, size, minX, minZ, spanX, spanZ, x, z, half, 1, 230);
      stamp(pixels, size, minX, minZ, spanX, spanZ, x, z, half + 1.6, 3, 200);
    });
  }
  if (data.stadium?.outer?.length > 3) {
    const ring = data.stadium.outer;
    let minBX = Infinity;
    let maxBX = -Infinity;
    let minBZ = Infinity;
    let maxBZ = -Infinity;
    for (const [x, z] of ring) {
      minBX = Math.min(minBX, x);
      maxBX = Math.max(maxBX, x);
      minBZ = Math.min(minBZ, z);
      maxBZ = Math.max(maxBZ, z);
    }
    const x0 = Math.max(0, Math.floor(((minBX - 2 - minX) / spanX) * (size - 1)));
    const x1 = Math.min(size - 1, Math.ceil(((maxBX + 2 - minX) / spanX) * (size - 1)));
    const y0 = Math.max(0, Math.floor(((minBZ - 2 - minZ) / spanZ) * (size - 1)));
    const y1 = Math.min(size - 1, Math.ceil(((maxBZ + 2 - minZ) / spanZ) * (size - 1)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const wx = minX + (x / (size - 1)) * spanX;
        const wz = minZ + (y / (size - 1)) * spanZ;
        if (!pointInPoly(wx, wz, ring)) continue;
        const i = (y * size + x) * 4;
        pixels[i + 3] = 255;
      }
    }
  }

  for (const pitch of data.pitches || []) {
    const [cx, cz] = centroid(pitch.f);
    const reach = Math.max(spanOf(pitch.f), 8);
    stamp(pixels, size, minX, minZ, spanX, spanZ, cx, cz, reach, 3, 255);
  }

  const meterX = spanX / (size - 1);
  const meterZ = spanZ / (size - 1);
  for (const b of data.buildings || []) {
    const ring = b.f;
    if (!ring || ring.length < 4) continue;
    let minBX = Infinity;
    let maxBX = -Infinity;
    let minBZ = Infinity;
    let maxBZ = -Infinity;
    for (const [x, z] of ring) {
      minBX = Math.min(minBX, x);
      maxBX = Math.max(maxBX, x);
      minBZ = Math.min(minBZ, z);
      maxBZ = Math.max(maxBZ, z);
    }
    const pad = 8;
    const x0 = Math.max(0, Math.floor(((minBX - pad - minX) / spanX) * (size - 1)));
    const x1 = Math.min(size - 1, Math.ceil(((maxBX + pad - minX) / spanX) * (size - 1)));
    const y0 = Math.max(0, Math.floor(((minBZ - pad - minZ) / spanZ) * (size - 1)));
    const y1 = Math.min(size - 1, Math.ceil(((maxBZ + pad - minZ) / spanZ) * (size - 1)));
    const pts = openRing(ring);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const wx = minX + (x / (size - 1)) * spanX;
        const wz = minZ + (y / (size - 1)) * spanZ;
        const inside = pointInPoly(wx, wz, ring);
        let dist = inside ? 0 : 1e9;
        if (!inside) {
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const c = pts[(i + 1) % pts.length];
            dist = Math.min(dist, distToSeg(wx, wz, a[0], a[1], c[0], c[1]));
          }
        }
        const i = (y * size + x) * 4;
        if (inside) {
          pixels[i + 3] = 255;
          pixels[i + 2] = Math.max(pixels[i + 2], 40);
        } else if (dist < 7) {
          const ao = Math.round((1 - dist / 7) * 210);
          pixels[i + 2] = Math.max(pixels[i + 2], ao);
          if (dist < 2.4) pixels[i + 1] = Math.max(pixels[i + 1], Math.round((1 - dist / 2.4) * 120));
          if (dist < 1.2) pixels[i + 3] = Math.max(pixels[i + 3], 180);
        }
      }
    }
  }

  const tex = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  void meterX;
  void meterZ;
  return { texture: tex, minX, minZ, spanX, spanZ };
}

function centroid(ring) {
  let x = 0;
  let z = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    z += ring[i][1];
  }
  return [x / n, z / n];
}

function spanOf(ring) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return Math.hypot(maxX - minX, maxZ - minZ) * 0.55;
}

function biomeColor(kind) {
  if (kind === 'wood') return [0.62, 0.78, 0.55];
  if (kind === 'garden') return [0.9, 1.05, 0.78];
  if (kind === 'cemetery') return [0.78, 0.84, 0.66];
  return [1, 1, 0.9];
}

export function buildGround(data, yAt) {
  const wear = buildWearMap(data);
  const { minX, minZ, step, cols, rows } = data.terrain;
  const fine = 4;
  const spanX = (cols - 1) * step;
  const spanZ = (rows - 1) * step;
  const fCols = Math.round(spanX / fine) + 1;
  const fRows = Math.round(spanZ / fine) + 1;
  const positions = new Float32Array(fCols * fRows * 3);
  const colors = new Float32Array(fCols * fRows * 3);
  const layers = (data.greens || []).map((g) => ({ ...g, color: biomeColor(g.kind) }));

  for (let row = 0; row < fRows; row++) {
    for (let col = 0; col < fCols; col++) {
      const x = minX + (col / (fCols - 1)) * spanX;
      const z = minZ + (row / (fRows - 1)) * spanZ;
      const i = (row * fCols + col) * 3;
      positions[i] = x;
      positions[i + 1] = yAt(x, z);
      positions[i + 2] = z;
      let tint = [0.72, 0.68, 0.52];
      for (const layer of layers) {
        if (pointInPoly(x, z, layer.f)) tint = layer.color;
      }
      colors[i] = tint[0];
      colors[i + 1] = tint[1];
      colors[i + 2] = tint[2];
    }
  }
  const indices = [];
  for (let row = 0; row < fRows - 1; row++) {
    for (let col = 0; col < fCols - 1; col++) {
      const a = row * fCols + col;
      const b = a + 1;
      const c = a + fCols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
  material.customProgramCacheKey = () => 'vu-grass-2';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWearMap = { value: wear.texture };
    shader.uniforms.uWearMin = { value: new THREE.Vector2(wear.minX, wear.minZ) };
    shader.uniforms.uWearInv = { value: new THREE.Vector2(1 / wear.spanX, 1 / wear.spanZ) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${NOISE}\nuniform sampler2D uWearMap;\nuniform vec2 uWearMin;\nuniform vec2 uWearInv;\nvarying vec3 vWorld;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec2 wuv = (vec2(position.x, position.z) - uWearMin) * uWearInv;
        float flatten = texture2D(uWearMap, wuv).a;
        flatten = max(flatten, texture2D(uWearMap, wuv).r);
        transformed.y += (grassH(position.xz) - 0.48) * 0.36 * (1.0 - flatten);
        vWorld = vec3(position.x, transformed.y, position.z);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}\nuniform sampler2D uWearMap;\nuniform vec2 uWearMin;\nuniform vec2 uWearInv;\nvarying vec3 vWorld;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 wuv = (vWorld.xz - uWearMin) * uWearInv;
        vec4 wear = texture2D(uWearMap, wuv);
        float pavement = wear.r;
        float pathw = wear.g;
        float ao = wear.b;
        float n = smoothstep(0.22, 0.78, grassH(vWorld.xz));
        float patch = gFbm(vWorld.xz * 0.018);
        float fine = gNoise(vWorld.xz * 4.5);
        vec3 lo = vec3(0.06, 0.14, 0.035);
        vec3 hi = vec3(0.24, 0.42, 0.10);
        vec3 dry = vec3(0.32, 0.30, 0.11);
        vec3 col = mix(lo, hi, n);
        col = mix(col, dry, smoothstep(0.46, 0.72, patch) * 0.55);
        col = mix(col, dry, smoothstep(0.62, 0.9, fine) * 0.35);
        col *= 0.78 + 0.44 * gNoise(vWorld.xz * 2.4);
        col *= 0.9 + 0.16 * gNoise(vWorld.xz * 9.0);
        col *= vColor;
        vec3 dirt = vec3(0.20, 0.15, 0.08);
        col = mix(col, dirt, smoothstep(0.08, 0.62, pathw) * (1.0 - smoothstep(0.2, 0.7, pavement)));
        vec3 tar = vec3(0.05, 0.052, 0.055);
        col = mix(col, tar, smoothstep(0.28, 0.78, pavement));
        col *= mix(1.0, 0.58, ao);
        diffuseColor.rgb = col;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        float e = 0.45;
        float h0 = grassH(vWorld.xz);
        float hx = grassH(vWorld.xz + vec2(e, 0.0));
        float hz = grassH(vWorld.xz + vec2(0.0, e));
        vec3 bump = normalize(vec3(h0 - hx, e * 0.42, h0 - hz));
        vec2 wuvN = (vWorld.xz - uWearMin) * uWearInv;
        float hard = texture2D(uWearMap, wuvN).r;
        vec3 wn = inverseTransformDirection(normal, viewMatrix);
        wn = normalize(mix(wn, bump, 0.55 * (1.0 - hard)));
        normal = normalize(transformDirection(wn, viewMatrix));`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        vec2 wuvR = (vWorld.xz - uWearMin) * uWearInv;
        float hardR = texture2D(uWearMap, wuvR).r;
        roughnessFactor = mix(0.96, 0.82, hardR);`,
      );
  };

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return { mesh, wear };
}
