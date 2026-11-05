import * as THREE from 'three/webgpu';

const MAX = 4000;

// Effects: partikel GPU-friendly (satu Points), tracer, damage number, decal
export class Effects {
  constructor(engine) {
    this.engine = engine;
    this.count = 0;
    this._initParticles();
    this._tracers = [];
    this._decals = [];
    // Shard HP (ekonomi agresi): kill dekat menjatuhkan shard yang termagnet
    this._shardPool = [];
    for (let i = 0; i < 20; i++) {
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.2, 0),
        new THREE.MeshBasicMaterial({ color: 0x4ade80, toneMapped: false })
      );
      mesh.visible = false;
      engine.scene.add(mesh);
      this._shardPool.push({ mesh, active: false, life: 0, heal: 0 });
    }
    this._dmgPool = [];
    for (let i = 0; i < 12; i++) {
      const el = document.createElement('div');
      el.className = 'dmg-number';
      el.style.cssText = 'position:fixed;z-index:40;font:700 1rem "Segoe UI",sans-serif;color:#ffd34d;' +
        'text-shadow:0 0 8px rgba(255,180,0,.7);pointer-events:none;opacity:0;transform:translate(-50%,-50%);';
      document.body.appendChild(el);
      this._dmgPool.push({ el, active: false, t: 0, pos: new THREE.Vector3() });
    }
  }

  _initParticles() {
    const pos = new Float32Array(MAX * 3);
    const col = new Float32Array(MAX * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.14, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.engine.scene.add(this.points);
    this._vel = new Float32Array(MAX * 3);
    this._life = new Float32Array(MAX);
    this._maxLife = new Float32Array(MAX);
    this._alive = new Uint8Array(MAX);
    this._c = new THREE.Color();
    this._v = new THREE.Vector3();
  }

  _emit(x, y, z, vx, vy, vz, color, life = 0.5) {
    const i = this.count % MAX;
    const i3 = i * 3;
    const p = this.points.geometry.attributes.position.array;
    const c = this.points.geometry.attributes.color.array;
    p[i3] = x; p[i3 + 1] = y; p[i3 + 2] = z;
    this._c.set(color);
    c[i3] = this._c.r; c[i3 + 1] = this._c.g; c[i3 + 2] = this._c.b;
    this._vel[i3] = vx; this._vel[i3 + 1] = vy; this._vel[i3 + 2] = vz;
    this._life[i] = life; this._maxLife[i] = life; this._alive[i] = 1;
    this.count = Math.min(this.count + 1, MAX);
  }

  muzzle(pos, color) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 4;
      this._emit(pos.x, pos.y, pos.z, Math.cos(a) * s, (Math.random() - 0.3) * s, Math.sin(a) * s, color, 0.12);
    }
  }

  impact(pos, color) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 5;
      this._emit(pos.x, pos.y, pos.z, Math.cos(a) * s, Math.random() * 4, Math.sin(a) * s, color, 0.3);
    }
  }

  spark(pos) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
      this._emit(pos.x, pos.y, pos.z, Math.cos(a) * s, Math.random() * 2, Math.sin(a) * s, 0xffcc66, 0.2);
    }
  }

  death(pos, color) {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 6;
      this._emit(pos.x, pos.y + 0.5, pos.z, Math.cos(a) * s, Math.random() * 6, Math.sin(a) * s, i % 3 === 0 ? 0xffaa44 : color, 0.6);
    }
  }

  explosion(pos, radius) {
    const n = Math.min(40, Math.ceil(radius * 10));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * radius * 2;
      this._emit(pos.x, pos.y + 0.3, pos.z, Math.cos(a) * s, Math.random() * 7, Math.sin(a) * s,
        i % 2 === 0 ? 0xff6600 : 0xffcc44, 0.5 + Math.random() * 0.3);
    }
  }

  tracer(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
    const line = new THREE.Line(geo, mat);
    this.engine.scene.add(line);
    this._tracers.push({ line, life: 0.08 });
  }

  shard(pos, type) {
    const heal = { grunt: 5, shooter: 8, heavy: 25, bomber: 12, boss: 50 }[type] ?? 5;
    const s = this._shardPool.find(x => !x.active);
    if (!s) return;
    s.active = true; s.life = 6; s.heal = heal;
    s.mesh.position.copy(pos);
    s.mesh.position.y = 0.6;
    s.mesh.visible = true;
  }

  updateShards(dt, player, onPickup) {
    for (const s of this._shardPool) {
      if (!s.active) continue;
      s.life -= dt;
      s.mesh.rotation.y += dt * 3;
      const dx = player.position.x - s.mesh.position.x;
      const dy = player.position.y - s.mesh.position.y;
      const dz = player.position.z - s.mesh.position.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 16) {
        const d = Math.sqrt(d2) || 1;
        const pull = (1 - d / 4) * 12 * dt;
        s.mesh.position.x += (dx / d) * pull;
        s.mesh.position.y += (dy / d) * pull;
        s.mesh.position.z += (dz / d) * pull;
      } else {
        s.mesh.position.y = 0.6 + Math.sin(performance.now() / 300 + s.heal) * 0.1;
      }
      if (d2 < 1.2) {
        s.active = false; s.mesh.visible = false;
        onPickup(s.heal);
      } else if (s.life <= 0) {
        s.active = false; s.mesh.visible = false;
      }
    }
  }

  damageNumber(pos, amount, kind = 'hit') {
    const d = this._dmgPool.find(x => !x.active);
    if (!d) return;
    d.active = true; d.t = 0.8;
    d.pos.copy(pos);
    d.el.textContent = kind === 'kill' ? '+' + amount : String(amount);
    d.el.style.color = kind === 'kill' ? '#ffd34d' : kind === 'crit' ? '#ff6b6b' : '#ffffff';
    d.el.style.opacity = '1';
  }

  update(dt) {
    // Partikel: integrasi + compact
    const p = this.points.geometry.attributes.position.array;
    const c = this.points.geometry.attributes.color.array;
    let write = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this._alive[i]) continue;
      const i3 = i * 3, w3 = write * 3;
      p[i3] += this._vel[i3] * dt;
      p[i3 + 1] += (this._vel[i3 + 1] - 9) * dt;
      p[i3 + 2] += this._vel[i3 + 2] * dt;
      this._life[i] -= dt;
      if (this._life[i] <= 0) { this._alive[i] = 0; continue; }
      if (write !== i) {
        p[w3] = p[i3]; p[w3 + 1] = p[i3 + 1]; p[w3 + 2] = p[i3 + 2];
        c[w3] = c[i3]; c[w3 + 1] = c[i3 + 1]; c[w3 + 2] = c[i3 + 2];
        this._vel[w3] = this._vel[i3]; this._vel[w3 + 1] = this._vel[i3 + 1]; this._vel[w3 + 2] = this._vel[i3 + 2];
        this._life[write] = this._life[i]; this._alive[write] = 1; this._alive[i] = 0;
      }
      write++;
    }
    this.count = write;
    this.points.geometry.setDrawRange(0, write);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    // Tracer
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const t = this._tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.08) * 0.8;
      if (t.life <= 0) {
        this.engine.scene.remove(t.line);
        t.line.geometry.dispose(); t.line.material.dispose();
        this._tracers.splice(i, 1);
      }
    }

    // Damage numbers
    for (const d of this._dmgPool) {
      if (!d.active) continue;
      d.t -= dt;
      d.pos.y += dt * 1.5;
      const v = d.pos.clone().project(this.engine.camera);
      if (v.z < 1) {
        d.el.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px';
        d.el.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
      }
      if (d.t <= 0) { d.active = false; d.el.style.opacity = '0'; }
    }
  }
}
