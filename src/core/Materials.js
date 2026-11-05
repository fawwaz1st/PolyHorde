import * as THREE from 'three/webgpu';

// Material stylized low-poly modern: flat-shaded + emissive accent + fog-friendly
export function stylized(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.75,
    metalness: opts.metalness ?? 0.1,
    flatShading: true,
    emissive: opts.emissive ?? color,
    emissiveIntensity: opts.emissiveIntensity ?? 0.08,
  });
}

// Cache material per (color, key) — hindari duplikasi
const _cache = new Map();
export function sharedStylized(color, key, opts = {}) {
  const k = key ?? (color + '|' + JSON.stringify(opts));
  if (!_cache.has(k)) _cache.set(k, stylized(color, opts));
  return _cache.get(k);
}

export function glowMaterial(color, intensity = 1.2) {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false });
}
