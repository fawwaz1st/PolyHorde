import * as THREE from 'three/webgpu';

// PASS PERAN SENJATA (2026): tiap senjata punya niche jelas, AR tidak lagi menang semua.
// Pistol = sidearm presisi (pemilih target jauh), AR = penyapu fodder, Shotgun = eraser jarak dekat
// (knockback = crowd control), Rocket = tombol panik AoE.
const WEAPONS = {
  // Presisi: 1-tap shooter, spread nyaris nol, DPS sengaja lebih rendah dari AR
  pistol: { name: 'PISTOL', key: '1', damage: 30, fireRate: 0.32, maxAmmo: 9, reloadTime: 1.0, recoil: 0.05, spread: 0.006, auto: false, color: 0x88aaff, projectile: false, knockback: 0.25 },
  // Penyapu: DPS tertinggi vs banyak target kecil, spread besar & damage per peluru rendah
  ar: { name: 'ASSAULT', key: '2', damage: 8, fireRate: 0.08, maxAmmo: 30, reloadTime: 1.8, recoil: 0.035, spread: 0.05, auto: true, color: 0x88dd88, projectile: false, knockback: 0.1 },
  // Eraser: burst besar + knockback kuat (dorong horde menjauh = crowd control)
  shotgun: { name: 'SHOTGUN', key: '3', damage: 10, fireRate: 0.55, maxAmmo: 6, reloadTime: 1.6, recoil: 0.14, spread: 0.14, pellets: 6, auto: false, color: 0xdd8844, projectile: false, knockback: 1.5 },
  // Panik: AoE besar, splash tinggi, self-damage ditekan ke 35%
  rocket: { name: 'ROCKET', key: '4', damage: 90, fireRate: 1.2, maxAmmo: 4, reloadTime: 2.5, recoil: 0.22, spread: 0.0, auto: false, color: 0xff4444, projectile: true, projectileSpeed: 25, projectileRadius: 0.3, explosionRadius: 5, explosionDamage: 70, selfDamageMul: 0.35, knockback: 0.6 }
};

export class WeaponSystem {
  constructor(scene, camera, player, octree, particles, audio, game) {
    this.scene = scene;
    this.camera = camera;
    this.player = player;
    this.octree = octree;
    this.particles = particles;
    this.audio = audio;
    this.game = game;

    this.weaponList = ['pistol', 'ar', 'shotgun', 'rocket'];
    this.weapons = {};
    this.currentIndex = 0;
    this.isReloading = false;
    this.reloadTimer = 0;

    // Rocket pool (pre-alloc 10): shared geo + material (dulu 10 geo + 10 material + castShadow)
    this.projectiles = [];
    this._rocketPool = [];
    const rGeo = new THREE.SphereGeometry(0.3, 8, 8);
    const rMat = new THREE.MeshStandardMaterial({
      color: 0xff4444, emissive: 0xff4444, emissiveIntensity: 0.5, flatShading: true
    });
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(rGeo, rMat);
      mesh.visible = false;
      mesh.castShadow = false;
      scene.add(mesh);
      this._rocketPool.push({ mesh, velocity: new THREE.Vector3(), lifetime: 0, alive: false, damage: 0, explosionRadius: 0, explosionDamage: 0 });
    }

    // Reusable
    this._ray = new THREE.Raycaster();
    this._hitFlashT = 0;
    this._switchT = 0;
    this._dir = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._bobTime = 0;
    this._crosshairHit = document.getElementById('crosshair-hit'); // cache DOM ref

    for (const id of this.weaponList) {
      this.weapons[id] = { ...WEAPONS[id], id, ammo: WEAPONS[id].maxAmmo, cooldown: 0 };
    }

    this._buildWeaponMeshes();
  }

  get current() { return this.weapons[this.weaponList[this.currentIndex]]; }

  _buildWeaponMeshes() {
    this.weaponGroup = new THREE.Group();
    this.weaponMeshes = {};
    const specs = [
      ['pistol', 0x88aaff, 0.2, 0.4, 0.6, 0.3, -0.25, -0.6],
      ['ar', 0x88dd88, 0.25, 0.5, 0.8, 0.35, -0.25, -0.7],
      ['shotgun', 0xdd8844, 0.3, 0.5, 0.9, 0.35, -0.25, -0.75],
      ['rocket', 0xff4444, 0.35, 0.6, 0.9, 0.4, -0.3, -0.8]
    ];
    for (const [id, c, w, h, len, x, y, z] of specs) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w*0.6, h*0.4, len),
        new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.3, flatShading: true }));
      body.position.z = -len / 2;
      group.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(w*0.15, w*0.15, len*0.5, 6),
        new THREE.MeshStandardMaterial({ color: 0x666677, roughness: 0.5, metalness: 0.5, flatShading: true }));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, h*0.15, -len*0.85);
      group.add(barrel);
      group.position.set(x, y, z);
      group.visible = false;
      this.weaponGroup.add(group);
      this.weaponMeshes[id] = group;
    }
    this.camera.add(this.weaponGroup);
    this._showCurrent();
  }

  _showCurrent() {
    for (const id of this.weaponList) this.weaponMeshes[id].visible = (id === this.weaponList[this.currentIndex]);
  }

  switchWeapon(index) {
    if (index < 0 || index >= this.weaponList.length || index === this.currentIndex) return;
    this.currentIndex = index;
    this.isReloading = false;
    this._showCurrent();
    // Switch dip animasi — senjata turun-sekali lalu naik (juice)
    this._switchT = 0.18;
  }

  reload() {
    const w = this.current;
    if (this.isReloading || w.ammo === w.maxAmmo) return;
    this.isReloading = true;
    this.reloadTimer = w.reloadTime;
    this.audio.playReload();
  }

  reset() {
    for (const id of this.weaponList) {
      const w = this.weapons[id];
      w.ammo = w.maxAmmo; w.cooldown = 0;
    }
    this.currentIndex = 0;
    this.isReloading = false; this.reloadTimer = 0;
    for (const r of this._rocketPool) { r.alive = false; r.mesh.visible = false; }
    this.projectiles.length = 0;
    this._showCurrent();
  }

  update(dt, input, camera) {
    // Hit-confirm flash — timer-based, tanpa setTimeout
    if (this._hitFlashT > 0) {
      this._hitFlashT -= dt;
      if (this._hitFlashT <= 0) this._crosshairHit?.classList.remove('show');
    }

    if (this.isReloading) {
      this.reloadTimer -= dt;
      // Reload bob animation
      const t = 1 - (this.reloadTimer / this.current.reloadTime);
      this.weaponGroup.position.y = -0.25 + Math.sin(t * Math.PI * 6) * 0.05 * (1 - t);
      this.weaponGroup.rotation.z = Math.sin(t * Math.PI * 8) * 0.02 * (1 - t);
      if (this.reloadTimer <= 0) {
        this.isReloading = false;
        this.current.ammo = this.current.maxAmmo;
        this.weaponGroup.position.y = 0;
        this.weaponGroup.rotation.z = 0;
      }
      // KRITIS: proyektil tetap disimulasikan saat reload (dulu roket membeku di udara)
      this._updateProjectiles(dt);
      return;
    }

    // Reset weapon position from bob
    this.weaponGroup.position.y = 0;
    this.weaponGroup.rotation.z = 0;

    // Weapon switch dip
    if (this._switchT > 0) {
      this._switchT -= dt;
      const t = Math.max(0, this._switchT) / 0.18;
      this.weaponGroup.position.y -= Math.sin(t * Math.PI) * 0.18;
    }

    const w = this.current;
    // FEVER rate-up nyata (dulu label janji kosong): tier>=2 → fireRate -6% per tier
    const tier = this.game.comboTier || 0;
    const rateMul = tier >= 2 ? 1 - 0.06 * tier : 1;
    w.cooldown -= dt;
    const fire = w.auto ? input.mouse.left : input.mouseJustDown();
    if (fire && w.cooldown <= 0 && w.ammo > 0) {
      this._fire(w, camera);
      w.cooldown = w.fireRate * rateMul;
      w.ammo--;
      if (w.ammo <= 0) this.reload();
    }

    this._updateProjectiles(dt);
    this._weaponBob(dt);
  }

  _fire(w, camera) {
    this.audio.playShoot();
    this.player.addRecoil(w.recoil);
    this.game.shake.add(w.recoil * 2);
    this.game.hud?.bumpFireBloom(w.recoil * 3);
    // FOV punch — hanya senjata berat (riset 2026: jangan constant shake)
    if (w.projectile) this.game.fovKick(0.8);
    else if (w.pellets) this.game.fovKick(0.35);

    this._forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const muzzlePos = this._tmp.copy(this.player.position).addScaledVector(this._forward, 2);
    this.particles.muzzleFlash(muzzlePos);

    if (w.projectile) this._fireProjectile(w, camera);
    else this._fireHitscan(w, camera);
  }

  _fireHitscan(w, camera) {
    const pellets = w.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      const sx = (Math.random() - 0.5) * w.spread * 2;
      const sy = (Math.random() - 0.5) * w.spread * 2;
      this._dir.set(sx, sy, -1).applyQuaternion(camera.quaternion).normalize();
      this._ray.set(this.player.position, this._dir);

      // Cover nyata: peluru harus berhenti di dinding/obstacle, bukan hanya musuh.
      // Gabungkan mesh musuh + mesh arena (array reuse — zero-alloc)
      const arena = this.game.arena;
      if (!this._targets) this._targets = [];
      this._targets.length = 0;
      const ml = this.game.enemyManager.meshList;
      for (let i = 0; i < ml.length; i++) this._targets.push(ml[i]);
      const am = arena.meshes;
      for (let i = 0; i < am.length; i++) this._targets.push(am[i]);
      const hits = this._ray.intersectObjects(this._targets, true);
      if (hits.length > 0) {
        // Naik ke root musuh yang punya takeDamage (dulu kondisinya terbalik -> damage selalu hilang)
        let t = hits[0].object;
        while (t && !t.userData?.takeDamage && t.parent) t = t.parent;
        if (t?.userData?.takeDamage) {
          t.userData.takeDamage(w.damage, w.knockback || 0, this._dir);
          this.particles.hitEffect(hits[0].point);
          this.audio.playHit();
          // Hit confirm flash via timer
          this._crosshairHit?.classList.add('show');
          this._hitFlashT = 0.09;
        }
      } else {
        const end = this._tmp.copy(this.player.position).addScaledVector(this._dir, 50);
        this.particles.tracer(this.player.position, end);
      }
    }
  }

  _fireProjectile(w, camera) {
    this._forward.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    const pos = this._tmp.copy(this.player.position).addScaledVector(this._forward, 2);

    let r = this._rocketPool.find(p => !p.alive);
    if (!r) return;
    r.alive = true;
    r.mesh.position.copy(pos);
    r.mesh.visible = true;
    r.velocity.copy(this._forward).multiplyScalar(w.projectileSpeed);
    r.lifetime = 3;
    r.damage = w.damage;
    r.explosionRadius = w.explosionRadius;
    r.explosionDamage = w.explosionDamage;
    this.projectiles.push(r);
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (!p.alive) { this.projectiles.splice(i, 1); continue; }
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.lifetime -= dt;

      let remove = false;
      // Hit enemy?
      for (const e of this.game.enemyManager.aliveEnemies) {
        if (p.mesh.position.distanceTo(e.mesh.position) < 1.5) {
          this._explode(p); remove = true; break;
        }
      }
      if (!remove && (p.mesh.position.length() > 20 || p.lifetime <= 0 || p.mesh.position.y < -2)) {
        this._explode(p); remove = true;
      }
      if (remove) {
        p.alive = false; p.mesh.visible = false;
        this.projectiles.splice(i, 1);
      }
    }
  }

  _explode(p) {
    this.audio.playExplosion();
    this.particles.explosion(p.mesh.position, p.explosionRadius);
    this.game.spawnExplosionLight(p.mesh.position, 0xff6600, 10, 10);
    this.game.shake.add(0.5 + p.explosionRadius * 0.05);
    this.game.fovKick(0.6);
    this.game.hitStop(0.06);
    // Damage enemies — iterate mundur: _killEnemy men-splice aliveEnemies
    const list = this.game.enemyManager.aliveEnemies;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const d = p.mesh.position.distanceTo(e.mesh.position);
      if (d < p.explosionRadius) e.mesh.userData.takeDamage?.(p.explosionDamage * (1 - d / p.explosionRadius), 0.5);
    }
    // Self damage — 35% (dulu 50%), cukup menghukum tembakan sembarangan tanpa bunuh diri
    const pd = p.mesh.position.distanceTo(this.player.position);
    if (pd < p.explosionRadius) this.player.takeDamage(p.explosionDamage * (1 - pd / p.explosionRadius) * (this.current.selfDamageMul ?? 0.35));
  }

  _weaponBob(dt) {
    if (!this.weaponGroup) return;
    this._bobTime += dt;
    const speed = this.player.velocity.length();
    const b = Math.sin(this._bobTime * 10) * 0.002 * Math.min(speed, 8);
    this.weaponGroup.position.y += b;
    this.weaponGroup.position.x += Math.sin(this._bobTime * 7) * 0.001 * Math.min(speed, 8);
  }
}
