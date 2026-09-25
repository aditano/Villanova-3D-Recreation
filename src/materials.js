import * as THREE from 'three';
import { FAMILIES } from './textures.js';

function std(maps, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xffffff,
    map: maps?.map ?? null,
    normalMap: maps?.normalMap ?? null,
    roughnessMap: maps?.roughnessMap ?? null,
    metalnessMap: maps?.roughnessMap ?? null,
    roughness: maps?.roughnessMap ? 1 : (opts.roughness ?? 0.86),
    metalness: maps?.roughnessMap ? 1 : (opts.metalness ?? 0.02),
    emissive: opts.emissive ?? 0x000000,
    emissiveMap: maps?.emissiveMap ?? null,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    envMapIntensity: opts.envMapIntensity ?? 0.35,
    side: opts.side ?? THREE.FrontSide,
    vertexColors: opts.vertexColors ?? false,
    polygonOffset: opts.polygonOffset ?? false,
    polygonOffsetFactor: opts.polygonOffsetFactor ?? 0,
    polygonOffsetUnits: opts.polygonOffsetUnits ?? 0,
  });
  if (mat.normalMap) mat.normalScale = new THREE.Vector2(opts.normalScale ?? 0.65, opts.normalScale ?? 0.65);
  return mat;
}

export function createMaterials(textures) {
  const families = {};
  const facadeList = [];
  for (const name of Object.keys(FAMILIES)) {
    const mat = std(textures.families[name], {
      emissive: 0xffe2b0,
      emissiveIntensity: 0.02,
      vertexColors: true,
      envMapIntensity: name === 'glass' ? 0.7 : 0.1,
      normalScale: name === 'glass' ? 0.35 : name === 'brick' ? 1.45 : 1.2,
      side: THREE.DoubleSide,
    });
    families[name] = mat;
    facadeList.push(mat);
  }

  const glass = new THREE.MeshStandardMaterial({
    color: 0x102833,
    roughness: 0.22,
    metalness: 0.42,
    emissive: 0xffc98a,
    emissiveIntensity: 0.02,
    envMapIntensity: 1.05,
  });
  facadeList.push(glass);

  return {
    families,
    facadeList,
    glass,
    trim: std(textures.trim, { vertexColors: false, roughness: 1, metalness: 1, normalScale: 1.15, envMapIntensity: 0.12 }),
    roof: std(textures.membrane, { side: THREE.DoubleSide, envMapIntensity: 0.2 }),
    slate: std(textures.slate, { side: THREE.DoubleSide, envMapIntensity: 0.25 }),
    asphalt: std(textures.asphalt, {
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
      envMapIntensity: 0.08,
      normalScale: 1.45,
    }),
    concrete: std(textures.concrete, {
      polygonOffset: true,
      polygonOffsetFactor: -0.5,
      polygonOffsetUnits: -1,
    }),
    gravel: std(textures.gravel),
    curb: new THREE.MeshStandardMaterial({ color: 0xd5d0c6, roughness: 0.78, metalness: 0.02 }),
    paint: new THREE.MeshStandardMaterial({
      color: 0xf4f4f0,
      roughness: 0.55,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -4,
    }),
    yellow: new THREE.MeshStandardMaterial({
      color: 0xe2c14a,
      roughness: 0.5,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -4,
    }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb7bcc1, roughness: 0.38, metalness: 0.72, envMapIntensity: 0.6 }),
    ballast: std(textures.gravel, { color: 0x8a8176 }),
    water: new THREE.MeshStandardMaterial({
      color: 0x1d4a56,
      roughness: 0.18,
      metalness: 0.08,
      transparent: true,
      opacity: 0.9,
      envMapIntensity: 0.9,
    }),
    field: new THREE.MeshStandardMaterial({
      map: textures.field,
      roughness: 0.86,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    seat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, vertexColors: true }),
    fascia: new THREE.MeshStandardMaterial({ color: 0x10243f, roughness: 0.7, metalness: 0.08 }),
    tree: new THREE.MeshStandardMaterial({ color: 0x2c6e34, roughness: 0.82, metalness: 0.0 }),
    treeDark: new THREE.MeshStandardMaterial({ color: 0x1d5226, roughness: 0.86, metalness: 0.0 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.92, metalness: 0.0 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xc48b62, roughness: 0.7 }),
    spire: std(textures.trim, { envMapIntensity: 0.3, side: THREE.DoubleSide }),
    pitch: new THREE.MeshStandardMaterial({ color: 0x2c6b38, roughness: 0.9, metalness: 0.0 }),
  };
}
