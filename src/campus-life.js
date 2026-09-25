import * as THREE from 'three';
import { createCampusSim } from './traffic.js';

const CAR_COLORS = [0xf4f6f8, 0x0c2340, 0x1f242b, 0xc5ccd4, 0x8e1d2c, 0x2f5f8a, 0xd8d2c6];
const SHIRT_COLORS = [0x0c2340, 0xf2f4f7, 0x2f5f8a, 0x6e7884, 0x1d4e89, 0xd7dde8, 0x8ea0b5];

function paint(mesh, count, palette) {
  for (let i = 0; i < count; i++) mesh.setColorAt(i, new THREE.Color(palette[i % palette.length]));
  mesh.instanceColor.needsUpdate = true;
}

export function createCampusLife(data, yAt, scene, { blocked = null } = {}) {
  const sim = createCampusSim(data, { blocked });
  const root = new THREE.Group();
  root.name = 'campus-life';
  scene.add(root);

  const box = new THREE.BoxGeometry(1, 1, 1);
  const carMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.28 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x1a2838, roughness: 0.35, metalness: 0.1 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe4b0 });
  const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9926a, roughness: 0.7 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x243044, roughness: 0.85 });

  const nCars = sim.cars.length;
  const nPeds = sim.peds.length;
  const cars = new THREE.InstancedMesh(box, carMat, Math.max(1, nCars));
  const roofs = new THREE.InstancedMesh(box, roofMat, Math.max(1, nCars));
  const lamps = new THREE.InstancedMesh(box, lampMat, Math.max(1, nCars * 2));
  const torsos = new THREE.InstancedMesh(box, bodyMat, Math.max(1, nPeds));
  const heads = new THREE.InstancedMesh(box, skinMat, Math.max(1, nPeds));
  const legs = new THREE.InstancedMesh(box, legMat, Math.max(1, nPeds));
  for (const mesh of [cars, roofs, lamps, torsos, heads, legs]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = mesh === lamps ? nCars * 2 : mesh === cars || mesh === roofs ? nCars : nPeds;
    root.add(mesh);
  }
  if (nCars) paint(cars, nCars, CAR_COLORS);
  if (nPeds) paint(torsos, nPeds, SHIRT_COLORS);

  const dummy = new THREE.Object3D();
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  const matrix = (mesh, index, x, y, z, heading, w, h, d) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, heading, 0);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  };

  return {
    root,
    sim,
    counts: () => sim.counts(),
    update(dt, night) {
      sim.step(dt);
      sim.cars.forEach((agent, i) => {
        const pose = sim.pose(agent);
        if (!pose || blocked?.(pose.x, pose.z)) {
          cars.setMatrixAt(i, hide);
          roofs.setMatrixAt(i, hide);
          lamps.setMatrixAt(i * 2, hide);
          lamps.setMatrixAt(i * 2 + 1, hide);
          return;
        }
        const y = yAt(pose.x, pose.z) + pose.lift + 0.55;
        matrix(cars, i, pose.x, y + 0.7, pose.z, pose.heading, 1.75, 0.95, 4.15);
        const rx = pose.x - Math.sin(pose.heading) * 0.2;
        const rz = pose.z - Math.cos(pose.heading) * 0.2;
        matrix(roofs, i, rx, y + 1.35, rz, pose.heading, 1.5, 0.62, 2.1);
        for (let k = 0; k < 2; k++) {
          const side = k ? 0.55 : -0.55;
          matrix(
            lamps,
            i * 2 + k,
            pose.x + Math.sin(pose.heading) * 2.05 + Math.cos(pose.heading) * side,
            y + 0.72,
            pose.z + Math.cos(pose.heading) * 2.05 - Math.sin(pose.heading) * side,
            pose.heading,
            0.28,
            0.16,
            0.12,
          );
        }
      });
      const phase = performance.now() * 0.004;
      sim.peds.forEach((agent, i) => {
        const pose = sim.pose(agent);
        if (!pose || blocked?.(pose.x, pose.z)) {
          torsos.setMatrixAt(i, hide);
          heads.setMatrixAt(i, hide);
          legs.setMatrixAt(i, hide);
          return;
        }
        const bob = Math.abs(Math.sin(phase * agent.speed + i)) * 0.08;
        const y = yAt(pose.x, pose.z) + pose.lift;
        matrix(legs, i, pose.x, y + 0.42, pose.z, pose.heading, 0.34, 0.78, 0.22);
        matrix(torsos, i, pose.x, y + 1.15 + bob, pose.z, pose.heading, 0.46, 0.7, 0.26);
        matrix(heads, i, pose.x, y + 1.68 + bob, pose.z, pose.heading, 0.26, 0.28, 0.24);
      });
      for (const mesh of [cars, roofs, lamps, torsos, heads, legs]) mesh.instanceMatrix.needsUpdate = true;
      lamps.visible = night > 0.35;
    },
  };
}
