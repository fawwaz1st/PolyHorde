import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { stylized } from './Materials.js';

// ============================================================
// Procedural model factory — stylized low-poly modern (detail).
// Geometrim di-cache & di-reuse; material dibagi.
// ============================================================

const _geo = new Map();
function geo(key, make) {
  if (!_geo.has(key)) _geo.set(key, make());
  return _geo.get(key);
}

const _mat = new Map();
function mat(key, make) {
  if (!_mat.has(key)) _mat.set(key, make());
  return _mat.get(key);
}

// --- Senjata (viewmodel detail) ---
export function buildWeaponModel(id) {
  const group = new THREE.Group();
  const specs = {
    pistol:  { w: 0.16, h: 0.22, len: 0.34, color: 0x6fb7ff, accent: 0xbfe3ff, barrel: 6 },
    ar:      { w: 0.18, h: 0.26, len: 0.52, color: 0x7bd88f, accent: 0xc2f7cf, barrel: 6 },
    shotgun: { w: 0.20, h: 0.28, len: 0.58, color: 0xffa06b, accent: 0xffd0ab, barrel: 6 },
    rocket:  { w: 0.26, h: 0.34, len: 0.62, color: 0xff6b6b, accent: 0xffb0b0, barrel: 8 },
  }[id] ?? { w: 0.18, h: 0.24, len: 0.4, color: 0xaaaaaa, accent: 0xcccccc, barrel: 6 };

  const bodyMat = mat('wbody' + id, () => stylized(specs.color, { roughness: 0.55, metalness: 0.35, emissiveIntensity: 0.05 }));
  const metalMat = mat('wmetal' + id, () => stylized(0x3a3f4a, { roughness: 0.35, metalness: 0.7, emissiveIntensity: 0.02 }));
  const accentMat = mat('waccent' + id, () => stylized(specs.accent, { roughness: 0.4, metalness: 0.4, emissiveIntensity: 0.25 }));
  const gripMat = mat('wgrip', () => stylized(0x2a2a33, { roughness: 0.9, emissiveIntensity: 0.02 }));

  const add = (geoKey, make, material, pos, rot) => {
    const m = new THREE.Mesh(geo(geoKey, make), material);
    m.position.copy(pos);
    if (rot) m.rotation.set(rot.x, rot.y, rot.z);
    group.add(m);
    return m;
  };

  // Receiver (body utama)
  add('wp_body' + id, () => new THREE.BoxGeometry(specs.w * 0.55, specs.h * 0.42, specs.len), bodyMat,
    new THREE.Vector3(0, 0, -specs.len / 2));
  // Laras
  add('wp_barrel' + id, () => new THREE.CylinderGeometry(specs.w * 0.14, specs.w * 0.14, specs.len * 0.6, specs.barrel), metalMat,
    new THREE.Vector3(0, specs.h * 0.12, -specs.len * 0.85), { x: Math.PI / 2, y: 0, z: 0 });
  // Handguard (kotak di depan)
  add('wp_hand' + id, () => new THREE.BoxGeometry(specs.w * 0.5, specs.h * 0.35, specs.len * 0.4), bodyMat,
    new THREE.Vector3(0, specs.h * 0.08, -specs.len * 0.55));
  // Magazine
  add('wp_mag' + id, () => new THREE.BoxGeometry(specs.w * 0.35, specs.h * 0.9, specs.w * 0.5), gripMat,
    new THREE.Vector3(0, -specs.h * 0.45, -specs.len * 0.05), { x: 0.12, y: 0, z: 0 });
  // Grip
  add('wp_grip' + id, () => new THREE.BoxGeometry(specs.w * 0.4, specs.h * 0.65, specs.w * 0.4), gripMat,
    new THREE.Vector3(0, -specs.h * 0.5, specs.len * 0.18), { x: 0.3, y: 0, z: 0 });
  // Stock
  add('wp_stock' + id, () => new THREE.BoxGeometry(specs.w * 0.4, specs.h * 0.38, specs.len * 0.3), gripMat,
    new THREE.Vector3(0, specs.h * 0.05, specs.len * 0.15));
  // Sight (dot sight) + lens emissive
  add('wp_sight' + id, () => new THREE.BoxGeometry(specs.w * 0.16, specs.h * 0.16, specs.w * 0.3), metalMat,
    new THREE.Vector3(0, specs.h * 0.32, -specs.len * 0.35));
  add('wp_lens' + id, () => new THREE.SphereGeometry(specs.w * 0.11, 8, 6),
    new THREE.MeshBasicMaterial({ color: specs.accent, toneMapped: false }),
    new THREE.Vector3(0, specs.h * 0.32, -specs.len * 0.35));
  // Aksen emissive di laras
  add('wp_accent' + id, () => new THREE.CylinderGeometry(specs.w * 0.16, specs.w * 0.16, specs.w * 0.18, specs.barrel),
    new THREE.MeshBasicMaterial({ color: specs.accent, toneMapped: false }),
    new THREE.Vector3(0, specs.h * 0.12, -specs.len * 0.7), { x: Math.PI / 2, y: 0, z: 0 });

  return group;
}

// --- Musuh (detail: body, kepala, kaki, armor, aksen) ---
export function buildEnemyModel(type, def) {
  const group = new THREE.Group();
  const bodyMat = mat('ebody' + type, () => stylized(def.color, { roughness: 0.7, emissiveIntensity: 0.1 }));
  const darkMat = mat('ebody_dark', () => stylized(0x2a2a3a, { roughness: 0.85, emissiveIntensity: 0.02 }));
  const accentMat = mat('ebody_accent' + type, () => stylized(0xffffff, { roughness: 0.3, metalness: 0.4, emissiveIntensity: 0.2 }));
  const glowMat = mat('ebody_glow' + type, () => new THREE.MeshBasicMaterial({ color: def.color, toneMapped: false }));

  // Tubuh utama
  let body;
  const H = def.height, S = def.size;
  switch (type) {
    case 'shooter':
      body = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.7, S * 0.5, H, 6), bodyMat);
      break;
    case 'heavy':
      body = new THREE.Mesh(new THREE.BoxGeometry(S * 1.35, H, S * 1.35), bodyMat);
      break;
    case 'boss':
      body = new THREE.Mesh(new THREE.BoxGeometry(S * 1.45, H, S * 1.45), bodyMat);
      break;
    case 'bomber':
      body = new THREE.Mesh(new THREE.SphereGeometry(S * 0.95, 8, 6), bodyMat);
      break;
    default:
      body = new THREE.Mesh(new THREE.CapsuleGeometry(S, H - S, 4, 6), bodyMat);
  }
  group.add(body);

  // Kepala (kotak emissive accent) untuk semua kecuali bomber
  if (type !== 'bomber') {
    const head = new THREE.Mesh(new THREE.BoxGeometry(S * 0.7, S * 0.7, S * 0.7),
      mat('ehead' + type, () => stylized(def.color, { roughness: 0.5, emissiveIntensity: 0.18 })));
    head.position.y = H * 0.62;
    group.add(head);
    // Mata: merged 2 bola
    const eyeGeo = geo('enemy_eyes', () => {
      const l = new THREE.SphereGeometry(0.075, 4, 4); l.translate(-0.14, 0, 0);
      const r = new THREE.SphereGeometry(0.075, 4, 4); r.translate(0.14, 0, 0);
      return mergeGeometries([l, r]);
    });
    const eyes = new THREE.Mesh(eyeGeo, glowMat);
    eyes.position.set(0, H * 0.62, S * 0.42);
    group.add(eyes);
  }

  // Bahu/armor (heavy & boss)
  if (type === 'heavy' || type === 'boss') {
    const padGeo = geo('enemy_pad', () => new THREE.BoxGeometry(S * 0.5, S * 0.35, S * 0.5));
    const padMat = mat('ebody_pad', () => stylized(0x3a3a4a, { roughness: 0.45, metalness: 0.55 }));
    const padL = new THREE.Mesh(padGeo, padMat);
    padL.position.set(-S * 0.75, H * 0.42, 0);
    const padR = new THREE.Mesh(padGeo, padMat);
    padR.position.set(S * 0.75, H * 0.42, 0);
    group.add(padL, padR);
    // Plate dada emissive
    const plate = new THREE.Mesh(geo('enemy_plate' + type, () => new THREE.BoxGeometry(S * 1.1, H * 0.35, 0.12)), glowMat);
    plate.position.set(0, H * 0.18, S * 0.72);
    group.add(plate);
    // Tanduk boss
    if (type === 'boss') {
      const hornGeo = geo('boss_horn', () => new THREE.ConeGeometry(S * 0.18, S * 0.7, 4));
      const hornL = new THREE.Mesh(hornGeo, padMat);
      hornL.position.set(-S * 0.5, H * 0.85, 0);
      hornL.rotation.z = 0.4;
      const hornR = new THREE.Mesh(hornGeo, padMat);
      hornR.position.set(S * 0.5, H * 0.85, 0);
      hornR.rotation.z = -0.4;
      group.add(hornL, hornR);
    }
  }

  // Strip emissive melingkar
  const strip = new THREE.Mesh(geo('enemy_strip', () => new THREE.BoxGeometry(0.06, 0.06, S * 1.7)), glowMat);
  strip.position.set(0, H * 0.6, 0);
  group.add(strip);

  // Kaki (2) — beranimasi
  if (type !== 'bomber') {
    const legGeo = geo('enemy_leg', () => new THREE.BoxGeometry(S * 0.38, H * 0.45, S * 0.38));
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-S * 0.35, -H * 0.28, 0);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(S * 0.35, -H * 0.28, 0);
    group.add(legL, legR);
    group.userData.legL = legL;
    group.userData.legR = legR;
  }

  // Lengan untuk shooter (menunjuk)
  if (type === 'shooter') {
    const arm = new THREE.Mesh(geo('enemy_arm', () => new THREE.BoxGeometry(S * 0.3, S * 0.3, H * 0.5)), darkMat);
    arm.position.set(S * 0.6, H * 0.45, S * 0.4);
    arm.rotation.x = -0.9;
    group.add(arm);
  }

  return group;
}

// --- Prop arena ---
export function buildProp(kind, seed = 0) {
  const rnd = (n) => { const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453; return x - Math.floor(x); };
  let mesh;
  switch (kind) {
    case 'pillar':
      mesh = new THREE.Mesh(geo('prop_pillar', () => new THREE.CylinderGeometry(0.5, 0.7, 4, 6)), stylized(0x4a3a5a, { roughness: 0.8 }));
      break;
    case 'block':
      mesh = new THREE.Mesh(geo('prop_block', () => new THREE.BoxGeometry(1.2, 2, 1.2)), stylized(0x3a4a5a, { roughness: 0.85 }));
      break;
    case 'crate':
      mesh = new THREE.Mesh(geo('prop_crate', () => new THREE.BoxGeometry(1.2, 1.2, 1.2)), stylized(0x5a4a3a, { roughness: 0.9 }));
      break;
    case 'crystal':
      mesh = new THREE.Mesh(geo('prop_crystal', () => new THREE.OctahedronGeometry(0.8, 0)), stylized(0x6a5aff, { emissiveIntensity: 0.35, roughness: 0.3 }));
      break;
    default:
      mesh = new THREE.Mesh(geo('prop_box', () => new THREE.BoxGeometry(1, 1, 1)), stylized(0x555555));
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
