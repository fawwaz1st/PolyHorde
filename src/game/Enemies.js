import * as THREE from 'three/webgpu';
import { buildEnemyModel } from '../core/Models.js';
import { Events } from '../core/Events.js';

export const ENEMY_TYPES = {
  grunt:  { hp: 32,  speed: 4.2, damage: 10, collision: 8,  score: 10, color: 0xff5566, size: 0.5, height: 1.2, attackRange: 1.6, attackCd: 1.0, type: 'melee' },
  shooter:{ hp: 22,  speed: 3.0, damage: 8,  collision: 4,  score: 20, color: 0xffaa55, size: 0.45, height: 1.3, attackRange: 14,  attackCd: 1.4, type: 'ranged', projSpeed: 14 },
  heavy:  { hp: 90,  speed: 2.2, damage: 22, collision: 16, score: 35, color: 0xaa66ff, size: 0.7, height: 1.8, attackRange: 2.2, attackCd: 1.4, type: 'melee' },
  bomber: { hp: 45,  speed: 6.5, damage: 40, collision: 40, score: 35, color: 0x55ff77, size: 0.5, height: 1.2, attackRange: 0.5, attackCd: 0.5, type: 'explode', radius: 3, splash: 50 },
  boss:   { hp: 280, speed: 3.4, damage: 32, collision: 25, score: 200, color: 0xffaa00, size: 1.2, height: 2.6, attackRange: 2.6, attackCd: 1.2, type: 'melee' },
};

const MAX_ENEMIES = 30;

export class Enemies {
  constructor(engine, world, audio, effects) {
    this.engine = engine;
    this.world = world;
    this.audio = audio;
    this.effects = effects;
    this.list = [];
    this._dying = [];
    this.projectiles = [];
    this._projPool = [];
    const pg = new THREE.SphereGeometry(0.1, 4, 4);
    const pm = new THREE.MeshBasicMaterial({ color: 0xffaa55, toneMapped: false });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(pg, pm);
      m.visible = false;
      engine.scene.add(m);
      this._projPool.push({ mesh: m, vel: new THREE.Vector3(), life: 0, damage: 0, active: false });
    }
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
  }

  reset() {
    for (const e of this.list) this._remove(e);
    this.list = [];
    for (const p of this._projPool) { p.active = false; p.mesh.visible = false; }
    this.projectiles.length = 0;
  }

  spawn(type, x, z, hpScale = 1, spdScale = 1) {
    if (this.list.length >= MAX_ENEMIES) return null;
    const def = ENEMY_TYPES[type];
    const group = buildEnemyModel(type, def);
    group.position.set(x, def.size, z);
    this.engine.scene.add(group);

    const e = {
      type, def, group,
      hp: def.hp * hpScale, maxHp: def.hp * hpScale,
      speed: def.speed * spdScale,
      pos: group.position,
      alive: true,
      attackCd: 0,
      stagger: 0,
      flash: 0,
      charge: false, chargeT: 0,
      id: Math.random().toString(36).slice(2),
      phase: Math.random() * Math.PI * 2,
    };
    group.userData.enemy = e;
    this.list.push(e);
    return e;
  }

  damage(e, amount, knockback = 0, dir = null) {
    if (!e.alive) return;
    e.hp -= amount;
    e.flash = 0.08;
    e.group.traverse((c) => { if (c.isMesh && c.material?.emissive) c.material.emissiveIntensity = 0.9; });
    if (amount >= 15) e.stagger = 0.12;
    // knockback
    if (dir) {
      this._v.set(dir.x, 0, dir.z).normalize();
      e.pos.addScaledVector(this._v, knockback);
      if (e.type === 'heavy' || e.type === 'boss') e.pos.addScaledVector(this._v, -knockback * 0.5);
    }
    // Boss phase: summon adds di 66% & 33% HP
    if (e.type === 'boss' && e.alive) {
      const pct = e.hp / e.maxHp;
      if (pct < 0.66 && !e.ph1) { e.ph1 = true; this._bossPhase(e, game); }
      if (pct < 0.33 && !e.ph2) { e.ph2 = true; this._bossPhase(e, game); }
    }
    if (e.hp <= 0) this._kill(e);
  }

  _bossPhase(boss, game) {
    this.effects.explosion(boss.pos, boss.def.radius || 3);
    this.audio.explosion(boss.pos, true);
    game.shake.add(0.6);
    boss.speed *= 1.15;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn('grunt', boss.pos.x + Math.cos(a) * 2, boss.pos.z + Math.sin(a) * 2, 1, 1.1);
    }
    game.ui.announce('BOSS FASE ' + (boss.ph2 ? '2' : '1'), '— horde tambahan —');
  }

  _kill(e) {
    if (!e.alive) return;
    e.alive = false;
    const pos = e.pos.clone();
    const score = e.def.score;
    this.effects.death(pos, e.def.color);
    this.effects.decal(pos);
    this.audio.kill(pos);
    // Animasi kematian: jatuh + menyusut selama 0.3s
    this._dying.push({ e, t: 0.3 });
    this._removeFromList(e);
    Events.emit('enemy-killed', { score, pos, type: e.type });
  }

  _removeFromList(e) {
    const i = this.list.indexOf(e);
    if (i > -1) { const last = this.list.length - 1; if (i !== last) this.list[i] = this.list[last]; this.list.pop(); }
  }

  _updateDying(dt) {
    for (let i = this._dying.length - 1; i >= 0; i--) {
      const d = this._dying[i];
      d.t -= dt;
      const e = d.e;
      e.group.rotation.x -= dt * 6; // jatuh ke belakang
      const s = Math.max(0.01, d.t / 0.3);
      e.group.scale.setScalar(s);
      e.group.position.y -= dt * 1.2; // tenggelam
      if (d.t <= 0) {
        this.engine.scene.remove(e.group);
        this._dying.splice(i, 1);
      }
    }
  }

  _remove(e) {
    const i = this.list.indexOf(e);
    if (i > -1) this.list.splice(i, 1);
    this.engine.scene.remove(e.group);
  }

  explode(e) {
    if (!e.alive) return;
    e.alive = false;
    const pos = e.pos.clone();
    const score = e.def.score;
    this.effects.explosion(pos, e.def.radius);
    this.audio.explosion(pos);
    this._remove(e);
    Events.emit('enemy-killed', { score, pos, type: e.type });
  }

  update(dt, player, game) {
    // Attack Token berprioritas JARAK (bukan lotre): musuh terdekat dapat token duluan
    // Hitung distance dulu untuk prioritas
    for (const x of this.list) x._dist = x.pos.distanceTo(player.position);
    let meleeTokens = 3;
    for (const x of this.list) if (x.alive && x._attacking) meleeTokens--;
    // Iterate mundur (explode memodifikasi list)
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.alive) continue;

      // Flash decay
      if (e.flash > 0) {
        e.flash -= dt;
        if (e.flash <= 0) e.group.traverse((c) => { if (c.isMesh && c.material?.emissive) c.material.emissiveIntensity = 0.1; });
      }
      if (e.stagger > 0) { e.stagger -= dt; continue; }
      e.attackCd -= dt;

      // Procedural animation: idle sway + walk bob
      const t = performance.now() / 1000 + e.phase;
      const moving = e._lastX !== undefined ? Math.hypot(e.pos.x - e._lastX, e.pos.z - e._lastZ) : 0;
      e._lastX = e.pos.x; e._lastZ = e.pos.z;
      const sway = Math.sin(t * 3) * 0.02 * (1 - Math.min(moving * 8, 1));
      e.group.scale.set(1 - sway * 0.5, 1 + sway, 1 - sway * 0.5);
      // Animasi kaki: langkah maju-mundur berdasarkan gerak
      const legL = e.group.userData.legL, legR = e.group.userData.legR;
      if (legL && legR) {
        const step = Math.sin(t * 8) * 0.4 * Math.min(moving * 10, 1);
        legL.rotation.x = step;
        legR.rotation.x = -step;
      }

      // Token: hanya melee yang mendapat token yang menyerang
      const wasAttacking = e._attacking;
      e._attacking = false;
      const eDist = e.pos.distanceTo(player.position);
      const nearest = !this.list.some(x => x !== e && x.alive && x.def.type === 'melee' && x._dist < e._dist && x._dist <= e.def.attackRange + 0.5);
      if (e.def.type === 'melee' && eDist <= e.def.attackRange + 0.5 && meleeTokens > 0 && nearest) {
        meleeTokens--; e._attacking = true;
      }
      this._ai(e, dt, player, game, e._attacking);
      if (wasAttacking && !e._attacking) { /* berhenti menyerang */ }
    }
    this._updateDying(dt);
    this._updateProjectiles(dt, player, game);
  }

  _ai(e, dt, player, game, hasToken = true) {
    const def = e.def;
    const dx = player.position.x - e.pos.x;
    const dz = player.position.z - e.pos.z;
    const dist = Math.hypot(dx, dz);
    const nx = dx / (dist || 1), nz = dz / (dist || 1);

    // Flee at low HP (bomber tidak)
    if (e.hp < e.maxHp * 0.18 && def.type !== 'explode') {
      e.pos.x -= nx * e.speed * 1.6 * dt;
      e.pos.z -= nz * e.speed * 1.6 * dt;
      this.world.resolveCollision(e.pos, def.size);
      return;
    }

    // Hadap pemain
    e.group.lookAt(player.position.x, e.pos.y, player.position.z);

    switch (def.type) {
      case 'melee': {
        // Charge (heavy & boss)
        if ((e.type === 'heavy' || e.type === 'boss') && dist > 5 && dist < (e.type === 'boss' ? 16 : 12) && e.attackCd <= 0) {
          e.windup = 0.25; // windup telegraph sebelum charge
        }
        if (e.charge) {
          e.chargeT -= dt;
          const mul = e.type === 'boss' ? 5 : 4;
          e.pos.x += nx * e.speed * mul * dt;
          e.pos.z += nz * e.speed * mul * dt;
          if (e.chargeT <= 0) e.charge = false;
          if (dist < 1.8) { player.takeDamage(def.damage * 2); game.hurtPlayer(e.pos); e.charge = false; }
          break;
        }
        if (dist > def.attackRange) {
          e.pos.x += nx * e.speed * dt;
          e.pos.z += nz * e.speed * dt;
        } else if (e.attackCd <= 0 && hasToken) {
          player.takeDamage(def.damage);
          game.hurtPlayer(e.pos);
          e.attackCd = def.attackCd;
        } else if (e.attackCd <= 0 && !hasToken) {
          // Menunggu token: tetap di range tapi tidak menyerang
          e.pos.x += nx * e.speed * 0.3 * dt;
          e.pos.z += nz * e.speed * 0.3 * dt;
        }
        break;
      }
      case 'ranged': {
        // Flank: swing wide
        const side = (e.phase > Math.PI) ? 1 : -1;
        if (dist > 10) { e.pos.x += nx * e.speed * dt; e.pos.z += nz * e.speed * dt; }
        else if (dist < 7) { e.pos.x -= nx * e.speed * 0.6 * dt; e.pos.z -= nz * e.speed * 0.6 * dt; }
        else { e.pos.x += -nz * side * e.speed * 0.5 * dt; e.pos.z += nx * side * e.speed * 0.5 * dt; }
        // Cover saat pemain menembak
        if (player.justFired) {
          const cover = this.world.findCover(e.pos, 5);
          if (cover) {
            this._v.set(cover.x - e.pos.x, 0, cover.z - e.pos.z).normalize();
            e.pos.addScaledVector(this._v, e.speed * 0.4 * dt);
          }
        }
        if (e.attackCd <= 0 && dist < def.attackRange) {
          this._shoot(e, player);
          e.attackCd = def.attackCd;
        }
        break;
      }
      case 'explode': {
        if (dist > 1.2) { e.pos.x += nx * e.speed * dt; e.pos.z += nz * e.speed * dt; }
        if (dist < 1.2 || e.hp < e.maxHp * 0.3) {
          // splash
          this.explode(e);
          const d = e.pos.distanceTo(player.position);
          if (d < def.radius) player.takeDamage(def.splash * (1 - d / def.radius));
          game.shake.add(0.4);
          return;
        }
        // Beep accelerando
        if (!e._beepT) e._beepT = 0;
        e._beepT -= dt;
        if (e._beepT <= 0 && dist < 12) {
          e._beepT = Math.max(0.12, 0.7 - dist * 0.05);
          this.audio.beep(Math.max(0, 1 - dist / 12));
        }
        break;
      }
    }
    this.world.resolveCollision(e.pos, def.size);
  }

  _shoot(e, player) {
    const p = this._projPool.find(x => !x.active);
    if (!p) return;
    p.active = true;
    p.mesh.visible = true;
    p.mesh.position.copy(e.pos);
    p.mesh.position.y += e.def.height * 0.5;
    this._v.set(player.position.x - e.pos.x, (player.position.y + 0.3) - p.mesh.position.y, player.position.z - e.pos.z).normalize();
    p.vel.copy(this._v).multiplyScalar(e.def.projSpeed);
    p.life = 3;
    p.damage = e.def.damage;
    this.projectiles.push(p);
  }

  _updateProjectiles(dt, player, game) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (!p.active) { this.projectiles.splice(i, 1); continue; }
      p.mesh.position.addScaledVector(p.vel, dt);
      p.life -= dt;
      let dead = p.life <= 0 || p.mesh.position.y < 0;
      if (p.mesh.position.distanceTo(player.position) < 0.8) {
        player.takeDamage(p.damage);
        game.hurtPlayer(p.mesh.position);
        dead = true;
      }
      if (dead) { p.active = false; p.mesh.visible = false; this.projectiles.splice(i, 1); }
    }
  }

  // Wave composition
  waveSize(wave) { return Math.min(5 + Math.floor(wave * 2.5), MAX_ENEMIES); }
  wavePool(wave) {
    const pool = ['grunt', 'grunt', 'grunt'];
    if (wave >= 2) pool.push('shooter', 'shooter');
    if (wave >= 4) pool.push('heavy');
    if (wave >= 6) pool.push('bomber');
    if (wave >= 8) pool.push('shooter', 'heavy');
    return pool;
  }
}
