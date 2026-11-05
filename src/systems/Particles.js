import * as THREE from 'three/webgpu';

const MAX = 5000;
const GRAVITY = -5;

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.count = 0;

    const pos = new Float32Array(MAX * 3);
    const col = new Float32Array(MAX * 3);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    this.mat = new THREE.PointsMaterial({
      size: 0.15, vertexColors: true, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    this.mesh = new THREE.Points(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this._vel = new Float32Array(MAX * 3);
    this._life = new Float32Array(MAX);
    this._maxLife = new Float32Array(MAX);
    this._alive = new Uint8Array(MAX);

    // Temp
    this._c = new THREE.Color();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._colorDirty = false;
  }

  _emit(pos, count, color, speed = 3, life = 0.5, spread = 1) {
    const pArr = this.geo.attributes.position.array;
    const cArr = this.geo.attributes.color.array;
    this._c.set(color);

    for (let i = 0; i < count; i++) {
      const idx = (this.count + i) % MAX;
      const i3 = idx * 3;

      pArr[i3] = pos.x + (Math.random() - 0.5) * 0.2 * spread;
      pArr[i3 + 1] = pos.y + (Math.random() - 0.5) * 0.2 * spread;
      pArr[i3 + 2] = pos.z + (Math.random() - 0.5) * 0.2 * spread;

      cArr[i3] = this._c.r + (Math.random() - 0.5) * 0.1;
      cArr[i3 + 1] = this._c.g + (Math.random() - 0.5) * 0.1;
      cArr[i3 + 2] = this._c.b + (Math.random() - 0.5) * 0.1;

      this._life[idx] = life;
      this._maxLife[idx] = life;
      this._alive[idx] = 1;
      this._colorDirty = true;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const spd = speed * (0.5 + Math.random());
      this._vel[i3] = Math.sin(phi) * Math.cos(theta) * spd;
      this._vel[i3 + 1] = Math.abs(Math.sin(phi) * Math.sin(theta)) * spd;
      this._vel[i3 + 2] = Math.cos(phi) * spd;
    }
    this.count = Math.min(this.count + count, MAX);
  }

  muzzleFlash(pos) { this._emit(pos, 12, 0xffaa44, 4, 0.12, 0.5); }
  hitEffect(pos) { this._emit(pos, 10, 0xffff44, 3, 0.25, 0.3); }
  deathExplosion(pos, color) {
    const colors = [color, 0xff8844, 0xffaa44];
    for (let i = 0; i < 30; i++) {
      this._emit(pos, 1, colors[Math.floor(Math.random() * colors.length)], 4, 0.6, 1);
    }
  }
  explosion(pos, radius) {
    const colors = [0xff4400, 0xff8800, 0xffcc00];
    const cnt = Math.min(35, Math.ceil(radius * 10));
    for (let i = 0; i < cnt; i++) {
      this._c.set(colors[Math.floor(Math.random() * colors.length)]);
      const idx = (this.count + i) % MAX;
      const i3 = idx * 3;
      const pArr = this.geo.attributes.position.array;
      const cArr = this.geo.attributes.color.array;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const r = Math.random() * radius * 0.3;
      pArr[i3] = pos.x + Math.sin(phi) * Math.cos(theta) * r;
      pArr[i3+1] = pos.y + Math.abs(Math.sin(phi) * Math.sin(theta)) * r;
      pArr[i3+2] = pos.z + Math.cos(phi) * r;
      cArr[i3] = this._c.r; cArr[i3+1] = this._c.g; cArr[i3+2] = this._c.b;
      this._life[idx] = 0.5 + Math.random() * 0.4;
      this._maxLife[idx] = 0.5 + Math.random() * 0.4;
      this._alive[idx] = 1;
      this._colorDirty = true;
      const spd = 2 + Math.random() * radius * 2;
      this._vel[i3] = Math.sin(phi) * Math.cos(theta) * spd;
      this._vel[i3+1] = Math.abs(Math.sin(phi) * Math.sin(theta)) * spd;
      this._vel[i3+2] = Math.cos(phi) * spd;
    }
    this.count = Math.min(this.count + cnt, MAX);
  }
  // Zero-alloc: semua vektor di-reuse (riset 2026 — GC pause = micro-stutter FPS)
  dashTrail(pos, dir) {
    this._v2.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4);
    for (let i = 0; i < 12; i++) {
      this._v2.x = (Math.random() - 0.5) * 0.4;
      this._v2.y = (Math.random() - 0.5) * 0.4;
      this._v2.z = (Math.random() - 0.5) * 0.4;
      this._emit(this._v3.copy(pos).add(this._v2), 1, 0x44aaff, 1, 0.25, 0.3);
    }
  }
  tracer(from, to) {
    this._v2.copy(to).sub(from);
    const dist = this._v2.length();
    const steps = Math.min(Math.ceil(dist / 2), 5);
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      this._emit(this._v3.copy(from).lerp(to, t), 2, 0x88ccff, 8, 0.06, 0.1);
    }
  }

  update(dt) {
    const pArr = this.geo.attributes.position.array;
    const cArr = this.geo.attributes.color.array;

    // Compact: move alive particles to front
    let colorMoved = false;
    let writeIdx = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this._alive[i]) continue;
      const i3 = i * 3;
      const w3 = writeIdx * 3;

      // Integrasi di slot HIDUP (i3) dulu, baru copy ke w3 — dulu di w3 -> partikel yang berpindah slot kehilangan gerak 1 frame
      pArr[i3] += this._vel[i3] * dt;
      pArr[i3 + 1] += (this._vel[i3 + 1] + GRAVITY) * dt;
      pArr[i3 + 2] += this._vel[i3 + 2] * dt;

      this._life[i] -= dt;
      if (this._life[i] <= 0) {
        this._alive[i] = 0;
        continue;
      }

      // Copy to write position if different — WARNA ikut dipindah
      if (writeIdx !== i) {
        pArr[w3] = pArr[i3]; pArr[w3+1] = pArr[i3+1]; pArr[w3+2] = pArr[i3+2];
        cArr[w3] = cArr[i3]; cArr[w3+1] = cArr[i3+1]; cArr[w3+2] = cArr[i3+2];
        this._vel[w3] = this._vel[i3]; this._vel[w3+1] = this._vel[i3+1]; this._vel[w3+2] = this._vel[i3+2];
        this._life[writeIdx] = this._life[i];
        this._maxLife[writeIdx] = this._maxLife[i];
        this._alive[writeIdx] = 1;
        this._alive[i] = 0;
        colorMoved = true;
      }

      const t = Math.max(0, this._life[writeIdx] / this._maxLife[writeIdx]);
      writeIdx++;
    }

    this.count = writeIdx;
    this.geo.setDrawRange(0, writeIdx);
    // Upload range: hanya posisi partikel hidup (dulu 5000 float tiap frame)
    this.geo.attributes.position.addUpdateRange(0, writeIdx * 3);
    this.geo.attributes.position.needsUpdate = true;
    // color hanya di-upload ulang saat ada emit/move — hemat bandwidth
    if (this._colorDirty || colorMoved) {
      this.geo.attributes.color.addUpdateRange(0, writeIdx * 3);
      this.geo.attributes.color.needsUpdate = true;
      this._colorDirty = false;
    }
  }
}

