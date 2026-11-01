import * as THREE from 'three/webgpu';
import { Events } from '../engine/EventBus.js';
import { SpatialHash } from '../systems/SpatialHash.js';

const BASE_TYPES = {
  grunt: { hp: 30, speed: 4, damage: 10, collisionDamage: 8, score: 10, color: 0xff4444, size: 0.5, height: 1.2, attackRange: 1.5, attackCooldown: 1.0, attackType: 'melee' },
  shooter: { hp: 20, speed: 2.5, damage: 8, collisionDamage: 4, score: 20, color: 0xff8844, size: 0.45, height: 1.3, attackRange: 15, attackCooldown: 1.5, attackType: 'ranged', projectileSpeed: 12 },
  heavy: { hp: 80, speed: 2, damage: 20, collisionDamage: 15, score: 35, color: 0x8844ff, size: 0.7, height: 1.8, attackRange: 2.0, attackCooldown: 1.5, attackType: 'melee' },
  bomber: { hp: 40, speed: 6, damage: 40, collisionDamage: 40, score: 35, color: 0x44ff44, size: 0.5, height: 1.2, attackRange: 0.5, attackCooldown: 0.5, attackType: 'explode', explosionRadius: 3, explosionDamage: 50 }
};

// Ukuran wave — dipakai EnemyManager & HUD agar selalu konsisten
export function waveSize(wave) {
  return Math.min(5 + Math.floor(wave * 2.5), 35);
}

export class EnemyManager {
  constructor(scene, octree, particles, audio, game) {
    this.scene = scene;
    this.octree = octree;
    this.particles = particles;
    this.audio = audio;
    this.game = game;

    this.enemies = [];
    this.aliveEnemies = [];
    // Persistent mesh array untuk raycast hitscan — tanpa alokasi per tembakan
    this.meshList = [];
    this.spawning = false;
    this.spawnTimer = 0;
    this.spawnQueue = [];
    this.enemyIdCounter = 0;

    // Spatial hash untuk separation antar musuh (mencegah stacking)
    this._hash = new SpatialHash(3);
    this._neighbors = [];

    // === HEALTH SHARD POOL (Quake-style momentum economy) ===
    // Kill dekat menjatuhkan shard: memaksa pemain maju ke dalam horde, bukan kiting pasif
    this._shardPool = [];
    const shardGeo = new THREE.OctahedronGeometry(0.22, 0);
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0x44ffaa, emissive: 0x44ffaa, emissiveIntensity: 1.1, flatShading: true
    });
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(shardGeo, shardMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this._shardPool.push({ mesh, alive: false, life: 0, heal: 0, bob: Math.random() * 6.28 });
    }
    this._shards = [];

    // === SPAWN TELEGRAPH RING POOL (0.8s warning) ===
    this._telegraphPool = [];
    const ringGeo = new THREE.RingGeometry(0.5, 1.2, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3355, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false
    });
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(ringGeo, ringMat.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this._telegraphPool.push({ mesh, alive: false, t: 0, dur: 0.8, type: null, hpScale: 1, spdScale: 1, x: 0, z: 0 });
    }
    this._telegraphs = [];
    this._tickAccum = 0;

    // Cache geometry & material template per tipe — zero alloc saat spawn
    // (riset 2026: GC pause = micro-stutter; material di-clone per enemy untuk hit-flash)
    this._geoCache = {
      grunt: new THREE.CapsuleGeometry(BASE_TYPES.grunt.size, BASE_TYPES.grunt.height - BASE_TYPES.grunt.size, 4, 6),
      shooter: new THREE.CylinderGeometry(BASE_TYPES.shooter.size * 0.7, BASE_TYPES.shooter.size * 0.5, BASE_TYPES.shooter.height, 6),
      heavy: new THREE.BoxGeometry(BASE_TYPES.heavy.size * 1.2, BASE_TYPES.heavy.height, BASE_TYPES.heavy.size * 1.2),
      bomber: new THREE.SphereGeometry(BASE_TYPES.bomber.size * 0.9, 8, 6),
      eye: new THREE.SphereGeometry(0.08, 4, 4)
    };
    this._matTemplates = {};
    for (const [id, def] of Object.entries(BASE_TYPES)) {
      this._matTemplates[id] = new THREE.MeshLambertMaterial({
        color: def.color, flatShading: true,
        emissive: def.color, emissiveIntensity: 0.1
      });
    }
    this._eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // Enemy projectile pool (pre-alloc)
    this.enemyProjectiles = [];
    this._projPool = [];
    const projGeo = new THREE.SphereGeometry(0.1, 4, 4);
    const projMat = new THREE.MeshBasicMaterial({ color: 0xff8844 });
    for (let i = 0; i < 50; i++) {
      const mesh = new THREE.Mesh(projGeo, projMat);
      mesh.visible = false;
      scene.add(mesh);
      this._projPool.push({ mesh, velocity: new THREE.Vector3(), lifetime: 0, damage: 0, alive: false });
    }

    this._dirToPlayer = new THREE.Vector3();
    this._randomPos = new THREE.Vector3();
    this._strafe = new THREE.Vector3();
    this._sep = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._tempPos = new THREE.Vector3();
  }

  reset() {
    for (const e of this.enemies) this._cleanupEnemy(e);
    this.enemies = [];
    this.aliveEnemies = [];
    this.meshList.length = 0;
    this.spawnQueue = [];
    this.spawning = false;
    this.enemyIdCounter = 0;
    for (const p of this._projPool) { p.alive = false; p.mesh.visible = false; }
    this.enemyProjectiles.length = 0;
    this._hash.clear();
    for (const s of this._shardPool) { s.alive = false; s.mesh.visible = false; }
    this._shards.length = 0;
    for (const tg of this._telegraphPool) { tg.alive = false; tg.mesh.visible = false; }
    this._telegraphs.length = 0;
  }

  startWave(wave) {
    this.spawning = true;
    this.spawnQueue = [];
    const hpScale = 1 + (wave - 1) * 0.12;
    const spdScale = 1 + (wave - 1) * 0.03;
    const count = waveSize(wave);

    const pool = ['grunt', 'grunt', 'grunt'];
    if (wave >= 2) pool.push('shooter', 'shooter');
    if (wave >= 4) pool.push('heavy');
    if (wave >= 6) pool.push('bomber');

    for (let i = 0; i < count; i++) {
      const type = pool[Math.floor(Math.random() * pool.length)];
      this.spawnQueue.push({ type, delay: i * 0.4 + Math.random() * 0.3, hpScale, spdScale });
    }
    this.spawnTimer = 0;
  }

  update(dt, player, weaponSystem) {
    this._player = player;
    // Spawn — lewat TELEGRAF 0.8s, bukan pop-in mendadak (fairness, riset 2026)
    if (this.spawning && this.spawnQueue.length > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const s = this.spawnQueue.shift();
        this._queueTelegraph(s, player);
        this.spawnTimer = s.delay;
      }
    }
    if (this.spawnQueue.length === 0) this.spawning = false;

    // Update telegraf -> spawn saat selesai
    this._tickAccum -= dt;
    const tickNow = this._tickAccum <= 0;
    if (tickNow) this._tickAccum = 0.22;
    if (tickNow && this._telegraphs.length > 0) this.audio.playSpawnTick(); // sekali per tick, bukan per telegraf
    for (let i = this._telegraphs.length - 1; i >= 0; i--) {
      const tg = this._telegraphs[i];
      tg.t += dt;
      const k = tg.t / tg.dur;
      // Ring mengecil + makin terang = sinyal "musuh muncul di sini"
      const scale = 1 + (1 - k) * 1.4;
      tg.mesh.scale.set(scale, scale, 1);
      tg.mesh.material.opacity = 0.25 + k * 0.7;
      if (k >= 1) {
        tg.alive = false;
        tg.mesh.visible = false;
        this._spawnEnemy(tg.type, player, tg.hpScale, tg.spdScale, tg.x, tg.z);
        const idx = this._telegraphs.indexOf(tg);
        if (idx > -1) this._telegraphs.splice(idx, 1);
      }
    }

    // Update shard (bob + magnet + pickup)
    this._updateShards(dt, player);

    // Spatial hash rebuild — O(n) per frame
    this._hash.clear();
    for (let i = 0; i < this.aliveEnemies.length; i++) {
      const e = this.aliveEnemies[i];
      this._hash.insert(i, e.mesh.position.x, e.mesh.position.z, e);
    }

    const enemies = this.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy.alive) continue;
      // Hit-flash reset tanpa setTimeout (riset 2026: timer-based, bukan event DOM)
      if (enemy.hitFlashTimer > 0) {
        enemy.hitFlashTimer -= dt;
        if (enemy.hitFlashTimer <= 0) enemy.mesh.material.emissiveIntensity = 0.1;
      }
      if (enemy.staggerTimer > 0) { enemy.staggerTimer -= dt; continue; }
      enemy.attackTimer -= dt;
      this._updateEnemyAI(enemy, dt, player);
    }

    // Separation antar musuh — push keluar agar tidak bertumpuk
    for (let i = 0; i < this.aliveEnemies.length; i++) {
      const a = this.aliveEnemies[i];
      const list = this._hash.queryInto(a.mesh.position.x, a.mesh.position.z, a.size * 2.4, this._neighbors);
      for (let j = 0; j < list.length; j++) {
        const b = list[j];
        if (b === a || !b.alive) continue;
        if (a.mesh.userData.enemyId >= b.mesh.userData.enemyId) continue; // proses pasangan sekali
        const dx = b.mesh.position.x - a.mesh.position.x;
        const dz = b.mesh.position.z - a.mesh.position.z;
        const d2 = dx * dx + dz * dz;
        const minD = (a.size + b.size) * 1.1;
        if (d2 < minD * minD && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (minD - d) * 0.5;
          this._sep.set(dx / d, 0, dz / d).multiplyScalar(push);
          a.mesh.position.x -= this._sep.x; a.mesh.position.z -= this._sep.z;
          b.mesh.position.x += this._sep.x; b.mesh.position.z += this._sep.z;
        }
      }
    }

    this._updateProjectiles(dt, player);
  }

  // Antri telegraf: posisi dipilih SEKARANG (aturan adil), spawn 0.8s kemudian
  _queueTelegraph(s, player) {
    const tg = this._telegraphPool.find(t => !t.alive);
    if (!tg) { this._spawnEnemy(s.type, player, s.hpScale, s.spdScale); return; }
    const def = BASE_TYPES[s.type];
    const pos = this._findSpawnPos(player, def.size);
    tg.alive = true;
    tg.t = 0;
    tg.type = s.type;
    tg.hpScale = s.hpScale;
    tg.spdScale = s.spdScale;
    tg.x = pos.x;
    tg.z = pos.z;
    tg.mesh.position.set(pos.x, 0.03, pos.z);
    tg.mesh.scale.set(1, 1, 1);
    tg.mesh.material.opacity = 0.25;
    tg.mesh.visible = true;
    this._telegraphs.push(tg);
  }

  // Health shard: bob, magnet dalam 4 m, pickup -> player.heal
  _updateShards(dt, player) {
    for (let i = this._shards.length - 1; i >= 0; i--) {
      const sh = this._shards[i];
      sh.life -= dt;
      sh.bob += dt * 4;
      if (sh.life <= 0) {
        sh.alive = false; sh.mesh.visible = false;
        this._shards.splice(i, 1);
        continue;
      }
      sh.mesh.rotation.y += dt * 2.5;
      // Magnet: tarik ke pemain jika dalam 4 m
      const dx = player.position.x - sh.mesh.position.x;
      const dy = (player.position.y + 0.6) - sh.mesh.position.y;
      const dz = player.position.z - sh.mesh.position.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 16) {
        const d = Math.sqrt(d2) || 1;
        const pull = (1 - d / 4) * 14 * dt;
        sh.mesh.position.x += (dx / d) * pull;
        sh.mesh.position.y += (dy / d) * pull;
        sh.mesh.position.z += (dz / d) * pull;
      } else {
        sh.mesh.position.y = 0.5 + Math.sin(sh.bob) * 0.12;
      }
      // Pickup
      if (d2 < 1.0) {
        player.heal(sh.heal);
        this.audio.playPickup();
        sh.alive = false; sh.mesh.visible = false;
        this._shards.splice(i, 1);
      }
    }
  }

  _dropShard(pos, type) {
    const healByType = { grunt: 5, shooter: 8, heavy: 25, bomber: 12 };
    const sh = this._shardPool.find(x => !x.alive);
    if (!sh) return;
    sh.alive = true;
    sh.life = 6;
    sh.heal = healByType[type] ?? 5;
    sh.mesh.position.set(pos.x, 0.5, pos.z);
    sh.mesh.visible = true;
    sh.mesh.scale.setScalar(1);
    this._shards.push(sh);
  }

  _spawnEnemy(type, player, hpScale = 1, spdScale = 1, fixedX = null, fixedZ = null) {
    const def = BASE_TYPES[type];
    const pos = (fixedX !== null)
      ? this._randomPos.set(fixedX, def.size, fixedZ)
      : this._findSpawnPos(player, def.size);

    // Reuse cached geometry; clone material dari template (hit-flash per enemy)
    const geo = this._geoCache[type];
    const mat = this._matTemplates[type].clone();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.castShadow = false; // musuh tanpa shadow = hemat shadow pass (blob ground sudah cukup)
    mesh.receiveShadow = true;

    if (type !== 'bomber') {
      const e1 = new THREE.Mesh(this._geoCache.eye, this._eyeMat);
      e1.position.set(-0.15, def.height * 0.35, def.size * 0.8);
      mesh.add(e1);
      const e2 = new THREE.Mesh(this._geoCache.eye, this._eyeMat);
      e2.position.set(0.15, def.height * 0.35, def.size * 0.8);
      mesh.add(e2);
    }

    this.scene.add(mesh);

    const enemy = {
      id: this.enemyIdCounter,
      type, mesh, ...def,
      state: 'chase', idleTimer: 0,
      hp: def.hp * hpScale, maxHp: def.hp * hpScale,
      speed: def.speed * spdScale,
      alive: true, staggerTimer: 0, attackTimer: 0,
      hitFlashTimer: 0,
      deathTimer: 0,
      chargeTimer: 0, charging: false
    };
    this.enemyIdCounter++;

    mesh.userData.enemyId = enemy.id;
    mesh.userData.alive = true;
    mesh.userData.takeDamage = (dmg, kb, dir) => this._damageEnemy(enemy, dmg, kb, dir);

    this.enemies.push(enemy);
    this.aliveEnemies.push(enemy);
    this.meshList.push(mesh);
  }

  // Spawn adil (riset 2026): min 10 m dari pemain & di luar kerucut pandang 70 derajat
  _findSpawnPos(player, size) {
    const px = player.position.x, pz = player.position.z;
    const yaw = player.yaw;
    let fallback = null;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 13 + Math.random() * 3;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const dx = x - px, dz = z - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 10) continue;                 // terlalu dekat = tidak adil
      if (Math.sqrt(x * x + z * z) < 3) continue; // hindari pillar tengah
      if (fallback === null) fallback = { x, z };
      // Sudut relatif terhadap arah hadap pemain (forward = -Z pada yaw)
      const angleTo = Math.atan2(dx, dz);
      // Normalisasi aman ke [0, 2pi) lalu ke selisih [-pi, pi] — hindari modulo negatif
      let rel = (angleTo - yaw) % (Math.PI * 2);
      if (rel < 0) rel += Math.PI * 2;
      const diff = Math.abs(rel > Math.PI ? rel - Math.PI * 2 : rel);
      // Tolak jika berada DI DEPAN pemain (kerucut pandang ~70°) -> tidak ada pop-in di mata
      if (diff > 1.22) return this._randomPos.set(x, size, z);
    }
    if (fallback) return this._randomPos.set(fallback.x, size, fallback.z);
    return this._randomPos.set(14, size, 0);
  }

  _updateEnemyAI(enemy, dt, player) {
    const dir = this._dirToPlayer.copy(player.position).sub(enemy.mesh.position);
    const dist = dir.length();
    dir.y = 0; dir.normalize();

    if (dist > 0.1) enemy.mesh.lookAt(player.position.x, enemy.mesh.position.y, player.position.z);

    // Procedural animation: idle sway saat speed rendah, attack lunge saat menyerang
    if (!enemy._lastPos) enemy._lastPos = new THREE.Vector3();
    const speedNow = enemy.mesh.position.distanceTo(enemy._lastPos);
    enemy._lastPos.copy(enemy.mesh.position);
    const t = performance.now() / 1000;
    const sway = Math.sin(t * 3.2 + enemy.id * 1.7) * 0.025 * Math.max(0, 1 - speedNow * 8);
    enemy.mesh.scale.y = 1 + sway;
    enemy.mesh.scale.x = 1 - sway * 0.5;
    enemy.mesh.scale.z = 1 - sway * 0.5;

    // Flee at low HP
    if (enemy.hp / enemy.maxHp < 0.2 && enemy.type !== 'bomber') {
      this._strafe.copy(dir).negate();
      enemy.mesh.position.addScaledVector(this._strafe, enemy.speed * 1.5 * dt);
      this._clampBounds(enemy);
      return;
    }

    switch (enemy.attackType) {
      case 'melee': {
        if (enemy.type === 'heavy' && dist > 5 && dist < 12 && enemy.chargeTimer <= 0) {
          enemy.charging = true;
          enemy.chargeTimer = 0.8;
        }
        if (enemy.charging) {
          enemy.chargeTimer -= dt;
          enemy.mesh.position.addScaledVector(dir, enemy.speed * 4 * dt);
          this._clampBounds(enemy);
          if (enemy.chargeTimer <= 0) enemy.charging = false;
          if (dist < 1.8) { player.takeDamage(enemy.damage * 2); enemy.charging = false; }
          break;
        }
        if (dist > enemy.attackRange) {
          enemy.mesh.position.addScaledVector(dir, enemy.speed * dt);
        } else if (enemy.attackTimer <= 0) {
          player.takeDamage(enemy.damage);
          enemy.attackTimer = enemy.attackCooldown;
          this.audio.playPlayerHit();
          this.game.hud?.flashDamageFrom(enemy.mesh.position);
        }
        break;
      }
      case 'ranged': {
        // Flanking (riset 2026): swing wide ke flank, bukan langsung ke player
        const flankSign = (enemy.id % 2 === 0) ? 1 : -1;
        const flankVec = this._strafe.set(-dir.z * flankSign, 0, dir.x * flankSign);
        // Jaga jarak optimal 8-10 m, lalu flank
        if (dist > 10) enemy.mesh.position.addScaledVector(dir, enemy.speed * dt);
        else if (dist < 7) enemy.mesh.position.addScaledVector(dir, -enemy.speed * 0.6 * dt);
        else enemy.mesh.position.addScaledVector(flankVec, enemy.speed * 0.5 * dt);
        // Cover seek: jika pemain menembak (velocity player tinggi), shooter berlindung di balik obstacle
        if (player.velocity && player.velocity.length() > 4) {
          const cover = this._nearestCover(enemy.mesh.position, 4);
          if (cover) enemy.mesh.position.addScaledVector(cover, enemy.speed * 0.3 * dt);
        }
        if (enemy.attackTimer <= 0) {
          this._enemyShoot(enemy, player);
          enemy.attackTimer = enemy.attackCooldown;
        }
        break;
      }
      case 'explode': {
        if (dist > 1.2) enemy.mesh.position.addScaledVector(dir, enemy.speed * dt);
        // Fix bomber dud: picu TANGKIS dekat (<1.2 m) — damage splash nyaris penuh saat detonasi
        const proximity = dist < 1.2;
        if (proximity || enemy.hp < enemy.maxHp * 0.3) {
          this._explodeEnemy(enemy, player);
          return;
        }
        // Blink makin cepat makin dekat + beep accelerando (keterbacaan ancaman)
        const blinkRate = 4 + Math.max(0, (10 - dist)) * 0.8;
        const blink = Math.sin(performance.now() / 1000 * blinkRate) > 0 ? 1 : 0.1;
        enemy.mesh.material.emissiveIntensity = blink;
        if (!enemy._lastBeep) enemy._lastBeep = 0;
        const beepInt = Math.max(0.12, 0.8 - dist * 0.06);
        if (dist < 12 && performance.now() - enemy._lastBeep > beepInt * 1000) {
          enemy._lastBeep = performance.now();
          this.audio.playBomberBeep(dist);
        }
        break;
      }
    }
    this._avoidObstacles(enemy);
    this._clampBounds(enemy);
  }

  _clampBounds(enemy) {
    const h = Math.sqrt(enemy.mesh.position.x ** 2 + enemy.mesh.position.z ** 2);
    if (h > 17) { const s = 16 / h; enemy.mesh.position.x *= s; enemy.mesh.position.z *= s; }
  }

  // Cover seek: cari obstacle terdekat untuk berlindung (riset 2026: utility scoring)
  _nearestCover(pos, range) {
    const arena = this.game?.arena;
    if (!arena || !arena.meshes) return null;
    let best = null; let bestD = range;
    for (const m of arena.meshes) {
      if (!m.position || m.isInstancedMesh) continue;
      const dx = m.position.x - pos.x, dz = m.position.z - pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestD && d > 0.5) { bestD = d; if (!best) best = new THREE.Vector3(); best.set(-dx / d, 0, -dz / d); }
    }
    return best;
  }

  // Obstacle avoidance sederhana: jauhi obstacle yang terlalu dekat (dipanggil di melee)
  _avoidObstacles(enemy) {
    const arena = this.game?.arena;
    if (!arena || !arena.meshes) return;
    const p = enemy.mesh.position;
    for (const m of arena.meshes) {
      if (!m.position || m.isInstancedMesh) continue;
      const dx = p.x - m.position.x, dz = p.z - m.position.z;
      const d2 = dx * dx + dz * dz;
      const minD = (enemy.size || 0.5) + 0.8;
      if (d2 < minD * minD && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.4;
        p.x += (dx / d) * push;
        p.z += (dz / d) * push;
      }
    }
  }

  _enemyShoot(enemy, player) {
    const dir = this._dirToPlayer.copy(player.position).sub(enemy.mesh.position);
    dir.y += 0.5; dir.normalize();

    let proj = this._projPool.find(p => !p.alive);
    if (!proj) return;
    proj.alive = true;
    proj.mesh.position.copy(enemy.mesh.position);
    proj.mesh.position.y += enemy.height * 0.5;
    proj.mesh.visible = true;
    proj.velocity.copy(dir).multiplyScalar(enemy.projectileSpeed);
    proj.lifetime = 3;
    proj.damage = enemy.damage;
    this.enemyProjectiles.push(proj);
  }

  _updateProjectiles(dt, player) {
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const p = this.enemyProjectiles[i];
      if (!p.alive) { this.enemyProjectiles.splice(i, 1); continue; }
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.lifetime -= dt;

      let remove = false;
      if (p.mesh.position.distanceTo(player.position) < 0.8) {
        player.takeDamage(p.damage);
        this.audio.playPlayerHit();
        this.game.hud?.flashDamageFrom(p.mesh.position);
        remove = true;
      }
      if (p.lifetime <= 0 || p.mesh.position.length() > 20 || p.mesh.position.y < -2) remove = true;

      if (remove) {
        p.alive = false;
        p.mesh.visible = false;
        this.enemyProjectiles.splice(i, 1);
      }
    }
  }

  _damageEnemy(enemy, damage, knockback = 0, hitDir = null) {
    if (!enemy.alive) return;
    const player = this._player;
    if (!player) return;
    enemy.hp -= damage;
    enemy.staggerTimer = 0.1;
    // Hit-flash via timer — reset di update loop
    enemy.mesh.material.emissiveIntensity = 0.8;
    enemy.hitFlashTimer = 0.06;

    // Knockback: arah tembakan bila ada (shotgun = dorong horde), fallback radial dari pemain
    const kb = knockback > 0 ? knockback : 0.3 * Math.min(damage / 15, 1);
    const dir = hitDir
      ? this._strafe.set(hitDir.x, 0, hitDir.z)
      : this._strafe.copy(enemy.mesh.position).sub(player.position);
    dir.y = 0;
    if (dir.lengthSq() > 1e-6) {
      dir.normalize();
      enemy.mesh.position.addScaledVector(dir, kb);
    }
    // Musuh berat menahan knockback (rasa bobot)
    if (enemy.type === 'heavy') enemy.mesh.position.addScaledVector(dir, -kb * 0.6);

    if (enemy.hp <= 0) this._killEnemy(enemy);
  }

  _killEnemy(enemy) {
    const pos = this._tempPos.copy(enemy.mesh.position);
    const color = enemy.color;
    const score = enemy.score;
    const type = enemy.type;
    // wasLast WAJIB memperhitungkan telegraf yang belum melahirkan musuh (dulu wave-clear palsu)
    const wasLast = this.aliveEnemies.length === 1 && this.spawnQueue.length === 0 && this._telegraphs.length === 0;
    // Health economy: shard hanya jatuh pada kill JARAK DEKAT (<8 m) -> hadiah untuk agresi
    const nearPlayer = this._player && this._tempPos.distanceTo(this._player.position) < 8;
    this._cleanupEnemy(enemy);
    this.particles.deathExplosion(pos, color);
    this.audio.playKillTick();
    if (nearPlayer) this._dropShard(pos, type);
    Events.emit('enemy-killed', { score, pos: pos.clone(), last: wasLast });
    if (wasLast) Events.emit('wave-clear', { pos: pos.clone() });
  }

  _explodeEnemy(enemy, player) {
    const pos = this._tempPos.copy(enemy.mesh.position);
    const explosionRadius = enemy.explosionRadius;
    const explosionDamage = enemy.explosionDamage;
    const score = enemy.score;
    const wasLast = this.aliveEnemies.length === 1 && this.spawnQueue.length === 0 && this._telegraphs.length === 0;
    this._cleanupEnemy(enemy);
    this.particles.explosion(pos, explosionRadius);
    this.audio.playExplosion();
    this.game.spawnExplosionLight(pos, 0xff4400, 10, 12);
    this.game.shake.add(0.4);
    this.game.fovKick?.(0.6);

    const d = pos.distanceTo(player.position);
    if (d < explosionRadius) {
      player.takeDamage(explosionDamage * (1 - d / explosionRadius));
    }
    Events.emit('enemy-killed', { score, pos: pos.clone(), last: wasLast });
    if (wasLast) Events.emit('wave-clear', { pos: pos.clone() });
  }

  _cleanupEnemy(enemy) {
    if (!enemy.mesh.parent) return;
    enemy.alive = false;
    enemy.mesh.userData.alive = false;
    this.scene.remove(enemy.mesh);
    // Geometry di-cache & di-reuse — JANGAN dispose; material clone saja yang dibuang
    enemy.mesh.material?.dispose();
    // Swap-pop O(1) — dulu splice O(n); n≤35 tapi AoE massal terasa
    let idx = this.aliveEnemies.indexOf(enemy);
    if (idx > -1) { const last = this.aliveEnemies.length - 1; if (idx !== last) this.aliveEnemies[idx] = this.aliveEnemies[last]; this.aliveEnemies.pop(); }
    idx = this.meshList.indexOf(enemy.mesh);
    if (idx > -1) { const last = this.meshList.length - 1; if (idx !== last) this.meshList[idx] = this.meshList[last]; this.meshList.pop(); }
    idx = this.enemies.indexOf(enemy);
    if (idx > -1) { const last = this.enemies.length - 1; if (idx !== last) this.enemies[idx] = this.enemies[last]; this.enemies.pop(); }
  }

  collidesWith(enemy, player) {
    if (!enemy.alive) return false;
    return enemy.mesh.position.distanceTo(player.position) < (enemy.size + 0.8);
  }
}
