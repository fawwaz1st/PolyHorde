import * as THREE from 'three/webgpu';
import { stylized } from '../core/Materials.js';
import { buildProp } from '../core/Models.js';

// World: arena stylized dengan zona, cover, dan lighting modern
export class World {
  constructor(scene) {
    this.scene = scene;
    this.props = [];      // { mesh, x, z, radius } untuk collision & cover
    this._build();
  }

  _build() {
    const R = 20;

    // Lantai: grid gelap dengan aksen
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(R, 48),
      new THREE.MeshStandardMaterial({ color: 0x14141f, roughness: 0.85, metalness: 0.2, flatShading: true })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Garis grid emissive
    const gridMat = new THREE.MeshBasicMaterial({ color: 0x2a2a4a, transparent: true, opacity: 0.5 });
    for (let i = 0; i < 8; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, 0.04), gridMat);
      line.rotation.x = -Math.PI / 2;
      line.rotation.z = (i / 8) * Math.PI * 2;
      line.position.y = 0.01;
      this.scene.add(line);
    }
    // Ring konsentris
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x3a3a6a, transparent: true, opacity: 0.35 });
    for (const r of [5, 10, 15]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.04, r + 0.04, 48), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;
      this.scene.add(ring);
    }

    // Dinding: instanced box + strip neon
    const wallGeo = new THREE.BoxGeometry(2 * R * Math.sin(Math.PI / 32), 7, 0.5);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.8, metalness: 0.3, flatShading: true });
    const walls = new THREE.InstancedMesh(wallGeo, wallMat, 32);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const mid = a + Math.PI / 32;
      dummy.position.set(Math.cos(mid) * R, 3.5, Math.sin(mid) * R);
      dummy.lookAt(0, 3.5, 0);
      dummy.updateMatrix();
      walls.setMatrixAt(i, dummy.matrix);
    }
    walls.instanceMatrix.needsUpdate = true;
    walls.castShadow = true; walls.receiveShadow = true;
    this.scene.add(walls);

    // Strip neon di atas dinding
    const neonMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, toneMapped: false });
    const neon = new THREE.InstancedMesh(new THREE.BoxGeometry(2 * R * Math.sin(Math.PI / 32), 0.12, 0.6), neonMat, 32);
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const mid = a + Math.PI / 32;
      dummy.position.set(Math.cos(mid) * R, 6.8, Math.sin(mid) * R);
      dummy.lookAt(0, 6.8, 0);
      dummy.updateMatrix();
      neon.setMatrixAt(i, dummy.matrix);
    }
    neon.instanceMatrix.needsUpdate = true;
    this.scene.add(neon);

    // Cover props: block, crate, crystal, pillar — tersebar merata
    const kinds = ['block', 'crate', 'crystal', 'pillar'];
    const positions = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.3;
      const r = 6 + (i % 3) * 4;
      positions.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    positions.push([0, 0]); // pilar tengah
    positions.forEach(([x, z], i) => {
      const kind = kinds[i % kinds.length];
      const mesh = buildProp(kind, i + 1);
      mesh.position.x = x; mesh.position.z = z;
      mesh.position.y = kind === 'pillar' ? 2 : kind === 'crystal' ? 0.8 : 0.75;
      if (kind === 'crystal') mesh.rotation.y = i;
      this.scene.add(mesh);
      const radius = kind === 'pillar' ? 0.7 : kind === 'crystal' ? 0.9 : 0.8;
      this.props.push({ mesh, x, z, radius: radius + 0.4 });
    });

    // Lighting: ambient + directional (shadow) + rim + accent points
    const ambient = new THREE.AmbientLight(0x445577, 0.7);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffeecc, 2.2);
    sun.position.set(18, 30, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
    sun.shadow.camera.left = -25; sun.shadow.camera.right = 25;
    sun.shadow.camera.top = 25; sun.shadow.camera.bottom = -25;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.sun = sun;

    const rim = new THREE.DirectionalLight(0xff6644, 0.5);
    rim.position.set(-15, 8, -15);
    this.scene.add(rim);

    // Accent point lights (neon)
    const p1 = new THREE.PointLight(0x4488ff, 3, 20);
    p1.position.set(0, 4, 0);
    this.scene.add(p1);
    const p2 = new THREE.PointLight(0xff4488, 2, 15);
    p2.position.set(10, 2, 10);
    this.scene.add(p2);
    const p3 = new THREE.PointLight(0x44ffaa, 2, 15);
    p3.position.set(-10, 2, -10);
    this.scene.add(p3);

    this.radius = R;
  }

  // Collision: dorong posisi keluar dari prop (simple circle)
  resolveCollision(pos, radius) {
    for (const p of this.props) {
      const dx = pos.x - p.x, dz = pos.z - p.z;
      const d2 = dx * dx + dz * dz;
      const minD = p.radius + radius;
      if (d2 < minD * minD && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const push = (minD - d);
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
      }
    }
    // Batas arena
    const h = Math.hypot(pos.x, pos.z);
    if (h > this.radius - radius) {
      const s = (this.radius - radius) / h;
      pos.x *= s; pos.z *= s;
    }
  }

  // Cari cover terdekat dari posisi (untuk AI)
  findCover(pos, range) {
    let best = null, bestD = range;
    for (const p of this.props) {
      const dx = p.x - pos.x, dz = p.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD && d > 1) { bestD = d; best = p; }
    }
    return best;
  }
}
