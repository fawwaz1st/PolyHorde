import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { stylized } from './Materials.js';

// ============================================================
// Procedural model factory — stylized low-poly modern.
// Semua geometri di-cache & di-reuse; material dibagi.
// ============================================================

const _geo = new Map();
function geo(key, make) {
  if (!_geo.has(key)) _geo.set(key, make());
  return _geo.get(key);
}

// --- Senjata (viewmodel, dipasang ke kamera) ---
export function buildWeaponModel(id) {
  const group = new THREE.Group();
  const specs = {
    pistol:  { w: 0.16, h: 0.22, len: 0.34, color: 0x6fb7ff, accent: 0x9fd8ff },
    ar:      { w: 0.18, h: 0.26, len: 0.5,  color: 0x7bd88f, accent: 0xa8f0b8 },
    shotgun: { w: 0.2,  h: 0.28, len: 0.56, color: 0xffa06b, accent: 0xffc8a0 },
    rocket:  { w: 0.24, h: 0.32, len: 0.6,  color: 0xff6b6b, accent: 0xffa0a0 },
  }[id] ?? { w: 0.18, h: 0.24, len: 0.4, color: 0xaaaaaa, accent: 0xcccccc };

  const bodyMat = stylized(specs.color, { roughness: 0.6, metalness: 0.35, emissiveIntensity: 0.05 });
  const accentMat = stylized(specs.accent, { roughness: 0.4, metalness: 0.5, emissiveIntensity: 0.15 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(specs.w * 0.55, specs.h * 0.4, specs.len), bodyMat);
  body.position.z = -specs.len / 2;
  group.add(body);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(specs.w * 0.13, specs.w * 0.13, specs.len * 0.55, 6), accentMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, specs.h * 0.16, -specs.len * 0.8);
  group.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(specs.w * 0.4, specs.h * 0.7, specs.w * 0.35), bodyMat);
  grip.position.set(0, -specs.h * 0.45, specs.len * 0.1);
  grip.rotation.x = 0.25;
  group.add(grip);

  const sight = new THREE.Mesh(new THREE.BoxGeometry(specs.w * 0.12, specs.h * 0.14, specs.len * 0.12), accentMat);
  sight.position.set(0, specs.h * 0.3, -specs.len * 0.4);
  group.add(sight);

  return group;
}

// --- Musuh (per tipe) ---
export function buildEnemyModel(type, def) {
  const group = new THREE.Group();
  const bodyMat = stylized(def.color, { roughness: 0.7, emissiveIntensity: 0.1 });
  const accentMat = stylized(0xffffff, { roughness: 0.3, metalness: 0.4, emissiveIntensity: 0.2 });

  let body;
  switch (type) {
    case 'shooter':
      body = new THREE.Mesh(geo('shooter_body', () => new THREE.CylinderGeometry(def.size * 0.7, def.size * 0.5, def.height, 6)), bodyMat);
      break;
    case 'heavy':
      body = new THREE.Mesh(geo('heavy_body', () => new THREE.BoxGeometry(def.size * 1.3, def.height, def.size * 1.3)), bodyMat);
      break;
    case 'boss':
      body = new THREE.Mesh(geo('boss_body', () => new THREE.BoxGeometry(def.size * 1.4, def.height, def.size * 1.4)), bodyMat);
      break;
    case 'bomber':
      body = new THREE.Mesh(geo('bomber_body', () => new THREE.SphereGeometry(def.size * 0.9, 8, 6)), bodyMat);
      break;
    default:
      body = new THREE.Mesh(geo('grunt_body', () => new THREE.CapsuleGeometry(def.size, def.height - def.size, 4, 6)), bodyMat);
  }
  group.add(body);

  // Mata: merged 2 bola (1 draw call)
  if (type !== 'bomber') {
    const eyeGeo = geo('enemy_eyes', () => {
      const l = new THREE.SphereGeometry(0.07, 4, 4); l.translate(-0.14, 0, 0);
      const r = new THREE.SphereGeometry(0.07, 4, 4); r.translate(0.14, 0, 0);
      return mergeGeometries([l, r]);
    });
    const eyes = new THREE.Mesh(eyeGeo, accentMat);
    eyes.position.set(0, def.height * 0.35, def.size * 0.8);
    group.add(eyes);
  }

  // Aksen emissive: strip di tubuh
  const strip = new THREE.Mesh(
    geo('enemy_strip', () => new THREE.BoxGeometry(0.06, 0.06, def.size * 1.6)),
    new THREE.MeshBasicMaterial({ color: def.color, toneMapped: false })
  );
  strip.position.set(0, def.height * 0.6, 0);
  group.add(strip);

  // Kaki (2) — dianimasikan saat berjalan
  if (type !== 'bomber') {
    const legGeo = geo('enemy_leg', () => new THREE.BoxGeometry(def.size * 0.35, def.height * 0.45, def.size * 0.35));
    const legMat = stylized(0x2a2a3a, { roughness: 0.85 });
    const legL = new THREE.Mesh(legGeo, legMat);
    legL.position.set(-def.size * 0.35, -def.height * 0.28, 0);
    const legR = new THREE.Mesh(legGeo, legMat);
    legR.position.set(def.size * 0.35, -def.height * 0.28, 0);
    group.add(legL, legR);
    group.userData.legL = legL;
    group.userData.legR = legR;
  }

  // Armor plate di dada (bukan bomber)
  if (type === 'heavy' || type === 'boss') {
    const plate = new THREE.Mesh(
      geo('enemy_plate', () => new THREE.BoxGeometry(def.size * 1.1, def.height * 0.4, 0.12)),
      stylized(0x3a3a4a, { roughness: 0.5, metalness: 0.5 })
    );
    plate.position.set(0, def.height * 0.15, def.size * 0.7);
    group.add(plate);
  }

  return group;
}

// --- Prop arena ---
export function buildProp(kind, seed = 0) {
  const rnd = (n) => { const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453; return x - Math.floor(x); };
  let mesh;
  switch (kind) {
    case 'pillar':
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 4, 6), stylized(0x4a3a5a, { roughness: 0.8 }));
      break;
    case 'block':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1 + rnd(1), 1.5 + rnd(2) * 2, 1 + rnd(3)), stylized(0x3a4a5a, { roughness: 0.85 }));
      break;
    case 'crate':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), stylized(0x5a4a3a, { roughness: 0.9 }));
      break;
    case 'crystal':
      mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.8, 0), stylized(0x6a5aff, { emissiveIntensity: 0.35, roughness: 0.3 }));
      break;
    default:
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), stylized(0x555555));
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
