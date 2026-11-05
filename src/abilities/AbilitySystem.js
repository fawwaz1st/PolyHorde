import * as THREE from 'three/webgpu';

export class AbilitySystem {
  constructor(player, input, audio, particles, scene, game) {
    this.player = player;
    this.input = input;
    this.audio = audio;
    this.particles = particles;
    this.scene = scene;
    this.game = game;

    // Ability states
    this.abilities = {
      dash: { cd: 0, maxCd: 3, ready: true, key: 'KeyQ', active: false },
      shield: { cd: 0, maxCd: 8, ready: true, key: 'KeyE', active: false },
      grenade: { cd: 0, maxCd: 5, ready: true, key: 'KeyF', active: false, count: 3 }
    };

    // Dash trail throttle
    this._trailT = 0;

    // Grenade pool — pre-alloc (riset 2026: object pool, bukan alokasi per lempar)
    this._grenadePool = [];
    this._grenades = [];
    const gGeo = new THREE.SphereGeometry(0.15, 6, 6);
    const gMat = new THREE.MeshStandardMaterial({
      color: 0x44ff44, emissive: 0x44ff44, emissiveIntensity: 0.3, flatShading: true
    });
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(gGeo, gMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this._grenadePool.push({ mesh, velocity: new THREE.Vector3(), lifetime: 0, alive: false });
    }

    // Shield visual
    this.shieldMesh = null;
    this._createShieldVisual();

    // Temp
    this._dir = new THREE.Vector3();
    this._pos = new THREE.Vector3();
  }

  _createShieldVisual() {
    const geo = new THREE.SphereGeometry(1.2, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44ff44,
      transparent: true,
      opacity: 0.15,
      wireframe: true,
      depthWrite: false
    });
    this.shieldMesh = new THREE.Mesh(geo, mat);
    this.shieldMesh.visible = false;
    this.scene.add(this.shieldMesh);
  }

  reset() {
    for (const key of Object.keys(this.abilities)) {
      this.abilities[key].cd = 0;
      this.abilities[key].ready = true;
      this.abilities[key].active = false;
    }
    this.abilities.grenade.count = 3;
    this.shieldMesh.visible = false;
    for (const g of this._grenadePool) { g.alive = false; g.mesh.visible = false; }
    this._grenades.length = 0;
  }

  resupplyGrenades() {
    this.abilities.grenade.count = 3;
    this.abilities.grenade.ready = true;
    this.abilities.grenade.cd = 0;
  }

  getAbilityState(name) {
    const a = this.abilities[name];
    if (!a) return { ready: false, cd: 0, maxCd: 1, active: false };
    return {
      ready: a.ready || a.cd <= 0,
      cd: a.cd,
      maxCd: a.maxCd,
      active: a.active || false,
      count: a.count
    };
  }

  update(dt, input) {
    // Cooldowns
    for (const key of Object.keys(this.abilities)) {
      const a = this.abilities[key];
      if (!a.ready) {
        a.cd -= dt;
        if (a.cd <= 0) {
          a.ready = true;
          a.cd = 0;
        }
      }
    }

    // Dash
    if (input.justDown('KeyQ') && this.abilities.dash.ready && !this.player.isDashing) {
      this._activateDash(input);
    }

    // Trail partikel kontinu selama dash — bukan sekali di awal saja
    if (this.player.isDashing) {
      this._trailT -= dt;
      if (this._trailT <= 0) {
        this._trailT = 0.02;
        this.particles.dashTrail(this.player.position, this.player.dashDir);
      }
    }

    // Shield
    if (input.justDown('KeyE') && this.abilities.shield.ready) {
      this._activateShield();
    }

    // Shield duration timer
    if (this.player.shieldActive) {
      this.player.shieldTimer -= dt;
      if (this.player.shieldTimer <= 0) {
        this.player.shieldActive = false;
        this.shieldMesh.visible = false;
        this.abilities.shield.active = false;
        // cd sudah berjalan sejak aktivasi — jangan reset ulang
      }
    }

    // Shield follow player
    if (this.shieldMesh.visible) {
      this.shieldMesh.position.copy(this.player.position);
    }

    // Grenade
    if (input.justDown('KeyF') && this.abilities.grenade.ready && this.abilities.grenade.count > 0) {
      this._throwGrenade();
    }
  }

  _activateDash(input) {
    this.audio.playDash();
    this.abilities.dash.ready = false;
    this.abilities.dash.cd = this.abilities.dash.maxCd;

    // Dash mengikuti arah GERAK (bukan selalu ke depan kamera) — lari mundur = dash mundur
    const dir = this._dir.set(0, 0, -1);
    const fwd = input.isDown('KeyW'), back = input.isDown('KeyS'), left = input.isDown('KeyA'), right = input.isDown('KeyD');
    if (fwd || back || left || right) {
      const yaw = this.player.yaw;
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      // forward = (-sin yaw, 0, -cos yaw); right = (cos yaw, 0, -sin yaw)
      const fx = -sy, fz = -cy;
      const rx = cy, rz = -sy;
      dir.set(fx * (fwd ? 1 : 0) - fx * (back ? 1 : 0) + rx * (right ? 1 : 0) - rx * (left ? 1 : 0), 0,
               fz * (fwd ? 1 : 0) - fz * (back ? 1 : 0) + rz * (right ? 1 : 0) - rz * (left ? 1 : 0));
    } else {
      dir.set(0, 0, -1);
      dir.applyQuaternion(this.player.camera.quaternion);
    }
    dir.y = 0;
    if (dir.lengthSq() < 0.01) dir.z = -1;
    dir.normalize();

    this.player.dash(dir);
    this.game.fovKick(0.5);

    this.particles.dashTrail(this.player.position, dir);
  }

  _activateShield() {
    this.audio.playShield();
    this.abilities.shield.ready = false;
    this.abilities.shield.active = true;
    this.abilities.shield.cd = this.abilities.shield.maxCd; // cooldown mulai saat aktivasi (total 8 dtk)
    this.player.shieldActive = true;
    this.player.shieldTimer = this.player.shieldDuration;
    this.shieldMesh.position.copy(this.player.position);
    this.shieldMesh.visible = true;

    this.shieldMesh.scale.set(1, 1, 1);
  }

  _throwGrenade() {
    this.audio.playShoot();
    this.abilities.grenade.count--;
    this.abilities.grenade.ready = false;
    this.abilities.grenade.cd = this.abilities.grenade.maxCd;

    const dir = this._dir.set(0, 0, -1);
    dir.applyQuaternion(this.player.camera.quaternion);
    dir.normalize();

    const pos = this._pos.copy(this.player.position).addScaledVector(dir, 1.5);
    pos.y += 0.5;

    const g = this._grenadePool.find(x => !x.alive);
    if (!g) return;
    g.alive = true;
    g.mesh.position.copy(pos);
    g.mesh.visible = true;
    g.velocity.copy(dir).multiplyScalar(12);
    g.velocity.y += 4;
    g.lifetime = 2.5;
    this._grenades.push(g);
  }

  updateGrenades(dt) {
    for (let i = this._grenades.length - 1; i >= 0; i--) {
      const g = this._grenades[i];
      g.lifetime -= dt;
      if (g.lifetime <= 0) {
        this._detonate(g);
        this._grenades.splice(i, 1);
        continue;
      }
      g.mesh.position.addScaledVector(g.velocity, dt);
      g.velocity.y -= 15 * dt;
      if (g.mesh.position.y < 0.2) {
        g.mesh.position.y = 0.2;
        g.velocity.y *= -0.5;
        g.velocity.x *= 0.8;
        g.velocity.z *= 0.8;
      }
    }
  }

  _detonate(g) {
    this.audio.playExplosion();
    this.particles.explosion(g.mesh.position, 3);
    this.game.spawnExplosionLight(g.mesh.position, 0x44ff44, 8, 8);
    this.game.shake.add(0.35);
    this.game.fovKick(0.5);

    // Iterate mundur — _killEnemy men-splice aliveEnemies saat AoE
    const enemies = this.game.enemyManager.aliveEnemies;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const dist = g.mesh.position.distanceTo(e.mesh.position);
      if (dist < 3) {
        e.mesh.userData.takeDamage?.(60 * (1 - dist / 3));
      }
    }
    g.alive = false;
    g.mesh.visible = false;
  }
}
