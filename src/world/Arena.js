import * as THREE from 'three/webgpu';
import { Octree } from 'three/addons/math/Octree.js';

const ARENA_RADIUS = 18;
const WALL_HEIGHT = 6;
const SEGMENTS = 32;

export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.octree = new Octree();
    this.meshes = [];
    this._build();
  }

  _build() {
    this._addSky();
    this._addGround();
    this._gridLines();
    this._walls();
    this._neonStrip();
    this._obstacles();
    this._floorMarkings();

    // Build octree — InstancedMesh & noCollide di-skip (dinding = boundary radius Player._collide)
    for (const mesh of this.meshes) {
      if (mesh.isInstancedMesh || mesh.userData.noCollide) continue;
      this.octree.fromGraphNode(mesh);
    }
  }

  _addSky() {
    // Sky sphere diganti background solid + fog (sphere 90 radius 69% tertutup fog = sia-sia, 69% raster)
    const c = new THREE.Color(0x0a0a1a);
    this.scene.background = c;
    // Gradient lewat fog: horizon sedikit lebih terang
    this.scene.fog = new THREE.FogExp2(0x0a0a1a, 0.012);
  }

  _addGround() {
    const g = new THREE.CircleGeometry(ARENA_RADIUS, 40);
    const m = new THREE.MeshStandardMaterial({
      color: 0x1e1e32, roughness: 0.9, metalness: 0.15, flatShading: true
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.1;
    mesh.receiveShadow = true;
    mesh.userData.noOutline = true; // flat plane — outline useless
    this.scene.add(mesh);
    this.meshes.push(mesh);
  }

  _gridLines() {
    // Geometri ring di-share (1 geo, skala berbeda) — hemat memori & compile shader
    const mat = new THREE.MeshBasicMaterial({ color: 0x333355, transparent: true, opacity: 0.25 });
    const ringGeo = new THREE.RingGeometry(0.99, 1.01, 48);
    for (let r = 4; r < ARENA_RADIUS; r += 4) {
      const m = new THREE.Mesh(ringGeo, mat);
      m.scale.set(r, r, 1);
      m.rotation.x = -Math.PI / 2; m.position.y = 0.005;
      m.userData.noOutline = true;
      this.scene.add(m);
    }
    const lm = new THREE.MeshBasicMaterial({ color: 0x333355, transparent: true, opacity: 0.1 });
    const lineGeo = new THREE.PlaneGeometry(ARENA_RADIUS * 2, 0.03);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(lineGeo, lm);
      m.rotation.x = -Math.PI / 2; m.rotation.z = (i / 4) * Math.PI * 2; m.position.y = 0.005;
      m.userData.noOutline = true;
      this.scene.add(m);
    }
  }

  _walls() {
    const w = 2 * ARENA_RADIUS * Math.sin((Math.PI * 2) / SEGMENTS);
    const geo = new THREE.BoxGeometry(w, WALL_HEIGHT, 0.4);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.1, flatShading: true }); // SingleSide default
    const im = new THREE.InstancedMesh(geo, mat, SEGMENTS);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      const mid = a + Math.PI / SEGMENTS;
      dummy.position.set(Math.cos(mid) * ARENA_RADIUS, WALL_HEIGHT / 2, Math.sin(mid) * ARENA_RADIUS);
      dummy.lookAt(0, WALL_HEIGHT / 2, 0);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.63 + Math.random() * 0.12, 0.12, 0.18 + Math.random() * 0.1);
      im.setColorAt(i, col);
    }
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    this.scene.add(im);
    this.meshes.push(im);
  }

  _neonStrip() {
    // 1 InstancedMesh (32 draw call -> 1) — riset 2026: batching untuk objek statis berulang
    const stripMat = new THREE.MeshBasicMaterial({
      color: 0x0044ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide
    });
    const w = 2 * ARENA_RADIUS * Math.sin(Math.PI / SEGMENTS);
    const geo = new THREE.BoxGeometry(w, 0.1, 0.5);
    const im = new THREE.InstancedMesh(geo, stripMat, SEGMENTS);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      const mid = a + Math.PI / SEGMENTS;
      dummy.position.set(Math.cos(mid) * ARENA_RADIUS, WALL_HEIGHT - 0.05, Math.sin(mid) * ARENA_RADIUS);
      dummy.lookAt(0, WALL_HEIGHT - 0.05, 0);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.userData.noOutline = true;
    this.scene.add(im);
  }

  _obstacles() {
    const pos = [[-6,2],[7,-3],[-5,-7],[8,6],[-9,5],[0,-8],[4,-5],[-7,-4],[3,9],[-3,8]];
    for (const [x, z] of pos) {
      const h = 1 + Math.random() * 2.2;
      const s = 0.6 + Math.random() * 0.8;
      const shape = Math.random();
      let geo;
      if (shape < 0.25) geo = new THREE.CylinderGeometry(s * 0.7, s, h, 5);
      else if (shape < 0.5) geo = new THREE.ConeGeometry(s, h, 4);
      else if (shape < 0.75) geo = new THREE.BoxGeometry(s, h, s);
      else geo = new THREE.OctahedronGeometry(s * 0.8);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.6 + Math.random() * 0.15, 0.15, 0.25 + Math.random() * 0.12),
        roughness: 0.8, metalness: 0.1, flatShading: true
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x + (Math.random() - 0.5) * 0.3, h / 2, z + (Math.random() - 0.5) * 0.3);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }

    // Central pillar
    const pMat = new THREE.MeshStandardMaterial({ color: 0x3a2a3a, roughness: 0.8, flatShading: true });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 3, 6), pMat);
    pillar.position.set(0, 1.5, 0);
    pillar.castShadow = true;
    this.scene.add(pillar);
    this.meshes.push(pillar);

    // Ramps (decorative only)
    const rMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
    for (const [rx, rz] of [[5,4],[-6,-5],[2,-9]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2, 0.15, 1.5), rMat);
      m.position.set(rx, 0.08, rz); m.rotation.x = 0.3; m.castShadow = true;
      this.scene.add(m);
    }
  }

  _floorMarkings() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
    const spawnPoints = [[-10,-10],[-10,10],[10,-10],[10,10],[0,-14],[-14,0],[14,0],[0,14]];
    const markGeo = new THREE.RingGeometry(0.3, 0.6, 16);
    for (const [x, z] of spawnPoints) {
      const m = new THREE.Mesh(markGeo, mat);
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z);
      this.scene.add(m);
    }
  }
}
