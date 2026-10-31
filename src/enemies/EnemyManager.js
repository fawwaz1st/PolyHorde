import * as THREE from 'three/webgpu';
import { Events } from '../engine/EventBus.js';
import { addOutline } from '../systems/CelOutline.js';
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
      this._matTemplates[id] = new THREE.MeshStandardMaterial({
        color: def.color, roughness: 0.7, flatShading: true,
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
    // Spawn
    if (this.spawning && this.spawnQueue.length > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const s = this.spawnQueue.shift();
        this._spawnEnemy(s.type, player, s.hpScale, s.spdScale);
        this.spawnTimer = s.delay;
      }
    }
    if (this.spawnQueue.length === 0) this.spawning = false;

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
        const b = list[j].data;
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

  _spawnEnemy(type, player, hpScale = 1, spdScale = 1) {
    const def = BASE_TYPES[type];
    const pos = this._findSpawnPos(player, def.size);

    // Reuse cached geometry; clone material dari template (hit-flash per enemy)
    const geo = this._geoCache[type];
    const mat = this._matTemplates[type].clone();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.castShadow = true; mesh.receiveShadow = true;
    addOutline(mesh, null, 0x000000, 1, false);

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
      pos: pos.clone(), state: 'chase', idleTimer: 0,
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
    mesh.userData.takeDamage = (dmg) => this._damageEnemy(enemy, dmg);

    this.enemies.push(enemy);
    this.aliveEnemies.push(enemy);
    this.meshList.push(mesh);
  }

  _findSpawnPos(player, size) {
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 14 - Math.random() * 3;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.sqrt(x * x + z * z) > 3) return this._randomPos.set(x, size, z);
    }
    return this._randomPos.set(14, size, 0);
  }

  _updateEnemyAI(enemy, dt, player) {
    const dir = this._dirToPlayer.copy(player.position).sub(enemy.mesh.position);
    const dist = dir.length();
    dir.y = 0; dir.normalize();

    if (dist > 0.1) enemy.mesh.lookAt(player.position.x, enemy.mesh.position.y, player.position.z);

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
        }
        break;
      }
      case 'ranged': {
        if (dist > 8) enemy.mesh.position.addScaledVector(dir, enemy.speed * dt);
        else if (dist < 4) enemy.mesh.position.addScaledVector(dir, -enemy.speed * 0.5 * dt);
        this._strafe.set(-dir.z, 0, dir.x);
        // Strafe unik per enemy (id-specific phase)
        enemy.mesh.position.addScaledVector(this._strafe, Math.sin(enemy.id * 1.7 + performance.now() / 600) * 0.6 * dt);
        if (enemy.attackTimer <= 0) {
          this._enemyShoot(enemy, player);
          enemy.attackTimer = enemy.attackCooldown;
        }
        break;
      }
      case 'explode': {
        if (dist > 1.5) enemy.mesh.position.addScaledVector(dir, enemy.speed * dt);
        const proximity = dist < enemy.explosionRadius;
        if (proximity || enemy.hp < enemy.maxHp * 0.3) {
          this._explodeEnemy(enemy, player);
          return;
        }
        const blink = Math.sin(dist * 5) > 0 ? 1 : 0.1;
        enemy.mesh.material.emissiveIntensity = blink;
        break;
      }
    }
    this._clampBounds(enemy);
  }

  _clampBounds(enemy) {
    const h = Math.sqrt(enemy.mesh.position.x ** 2 + enemy.mesh.position.z ** 2);
    if (h > 17) { const s = 16 / h; enemy.mesh.position.x *= s; enemy.mesh.position.z *= s; }
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

  _damageEnemy(enemy, damage) {
    if (!enemy.alive) return;
    const player = this._player;
    if (!player) return;
    enemy.hp -= damage;
    enemy.staggerTimer = 0.1;
    // Hit-flash via timer — reset di update loop
    enemy.mesh.material.emissiveIntensity = 0.8;
    enemy.hitFlashTimer = 0.06;

    const knockDir = this._dirToPlayer.copy(enemy.mesh.position).sub(player.position).normalize();
    enemy.mesh.position.addScaledVector(knockDir, 0.3 * Math.min(damage / 15, 1));

    if (enemy.hp <= 0) this._killEnemy(enemy);
  }

  _killEnemy(enemy) {
    const pos = enemy.mesh.position.clone();
    const color = enemy.color;
    const score = enemy.score;
    const wasLast = this.aliveEnemies.length === 1 && this.spawnQueue.length === 0;
    this._cleanupEnemy(enemy);
    this.particles.deathExplosion(pos, color);
    this.audio.playKillTick();
    Events.emit('enemy-killed', { score, pos, last: wasLast });
    if (wasLast) Events.emit('wave-clear', { pos });
  }

  _explodeEnemy(enemy, player) {
    const pos = enemy.mesh.position.clone();
    const explosionRadius = enemy.explosionRadius;
    const explosionDamage = enemy.explosionDamage;
    const score = enemy.score;
    const wasLast = this.aliveEnemies.length === 1 && this.spawnQueue.length === 0;
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
    Events.emit('enemy-killed', { score, pos, last: wasLast });
    if (wasLast) Events.emit('wave-clear', { pos });
  }

  _cleanupEnemy(enemy) {
    if (!enemy.mesh.parent) return;
    enemy.alive = false;
    enemy.mesh.userData.alive = false;
    this.scene.remove(enemy.mesh);
    // Geometry di-cache & di-reuse — JANGAN dispose; material clone saja yang dibuang
    enemy.mesh.material?.dispose();
    const idx = this.aliveEnemies.indexOf(enemy);
    if (idx > -1) this.aliveEnemies.splice(idx, 1);
    const mIdx = this.meshList.indexOf(enemy.mesh);
    if (mIdx > -1) this.meshList.splice(mIdx, 1);
  }

  collidesWith(enemy, player) {
    if (!enemy.alive) return false;
    return enemy.mesh.position.distanceTo(player.position) < (enemy.size + 0.8);
  }
}
