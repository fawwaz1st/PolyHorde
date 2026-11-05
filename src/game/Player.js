import * as THREE from 'three/webgpu';

const GRAVITY = -28;
const SPEED = 8;
const SPRINT = 11;
const JUMP = 8.5;
const DASH_SPEED = 24;
const DASH_TIME = 0.18;
const MAX_HP = 100;

export class Player {
  constructor(engine, input, world, audio) {
    this.engine = engine;
    this.input = input;
    this.world = world;
    this.audio = audio;
    this.game = null; // di-set Game

    this.pos = new THREE.Vector3(0, 1, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.hp = MAX_HP; this.maxHp = MAX_HP;
    this.alive = true;

    // Dash
    this.dashT = 0;
    this.dashDir = new THREE.Vector3();
    this.dashCd = 0;
    this.dashCdMax = 2.2;

    // Shield
    this.shieldT = 0;
    this.shieldActive = false;
    this.shieldCd = 0;
    this.shieldCdMax = 7;

    // Recoil (kosmetik)
    this.recoil = new THREE.Vector2();
    this._tmp = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();

    // Shield visual
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.3, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x44ffaa, transparent: true, opacity: 0.18, wireframe: true, depthWrite: false })
    );
    this.shieldMesh.visible = false;
    engine.scene.add(this.shieldMesh);
  }

  reset() {
    this.pos.set(0, 1, 0);
    this.vel.set(0, 0, 0);
    this.yaw = 0; this.pitch = 0;
    this.hp = MAX_HP;
    this.alive = true;
    this.dashT = 0; this.dashCd = 0;
    this.shieldT = 0; this.shieldActive = false; this.shieldCd = 0;
    this.recoil.set(0, 0);
    this.shieldMesh.visible = false;
  }

  takeDamage(amount) {
    if (!this.alive || this.shieldActive) return;
    const armor = this.game?.upgrades?.armor || 1;
    this.hp = Math.max(0, this.hp - amount * armor);
    if (this.hp <= 0) { this.alive = false; }
  }

  heal(amount) { this.hp = Math.min(this.maxHp, this.hp + amount); }

  update(dt) {
    if (!this.alive) return;

    // --- Dash ---
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.input.justDown('KeyQ') && this.dashCd <= 0 && this.dashT <= 0) {
      // Dash mengikuti arah gerak (fallback ke depan kamera)
      const f = this.input.isDown('KeyW'), b = this.input.isDown('KeyS'), l = this.input.isDown('KeyA'), r = this.input.isDown('KeyD');
      if (f || b || l || r) {
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        this.dashDir.set(-sy * (f ? 1 : 0) + sy * (b ? 1 : 0) + cy * (r ? 1 : 0) - cy * (l ? 1 : 0), 0,
                         -cy * (f ? 1 : 0) + cy * (b ? 1 : 0) - sy * (r ? 1 : 0) + sy * (l ? 1 : 0));
      } else {
        this.dashDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      }
      this.dashDir.normalize();
      this.dashT = DASH_TIME;
      this.dashCd = this.dashCdMax;
      this.audio.dash();
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vel.x = this.dashDir.x * DASH_SPEED;
      this.vel.z = this.dashDir.z * DASH_SPEED;
      this.vel.y = 0;
    } else {
      // --- Gerak ---
      const f = this.input.isDown('KeyW'), b = this.input.isDown('KeyS'), l = this.input.isDown('KeyA'), r = this.input.isDown('KeyD');
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      const fx = -sy, fz = -cy;
      const rx = cy, rz = -sy;
      let mx = fx * (f ? 1 : 0) - fx * (b ? 1 : 0) + rx * (r ? 1 : 0) - rx * (l ? 1 : 0);
      let mz = fz * (f ? 1 : 0) - fz * (b ? 1 : 0) + rz * (r ? 1 : 0) - rz * (l ? 1 : 0);
      const ml = Math.hypot(mx, mz);
      const sprint = (this.input.isDown('ShiftLeft') ? SPRINT : SPEED) * (this.game?.upgrades?.speed || 1);
      if (ml > 0) {
        mx /= ml; mz /= ml;
        this.vel.x = mx * sprint;
        this.vel.z = mz * sprint;
      } else {
        const fr = 1 - dt * 10;
        this.vel.x *= fr; this.vel.z *= fr;
      }
      // Jump
      if (this.input.justDown('Space') && this.onGround) {
        this.vel.y = JUMP;
        this.onGround = false;
      }
    }

    // --- Zona: lava membakar, ice memperlambat ---
    const zone = this.world.zoneEffect ? this.world.zoneEffect(this.pos) : { lava: false, slow: false };
    if (zone.lava) this.takeDamage(12 * dt);
    const spdMul = zone.slow ? 0.55 : 1;

    // --- Gravity ---
    this.vel.y += GRAVITY * dt;

    // Integrasi + substep
    const steps = 2;
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, sdt);
      this.world.resolveCollision(this.pos, 0.4);
      if (this.pos.y <= 1) { this.pos.y = 1; this.vel.y = 0; this.onGround = true; }
      else this.onGround = false;
    }

    // --- Shield ---
    if (this.shieldCd > 0) this.shieldCd -= dt;
    if (this.input.justDown('KeyE') && this.shieldCd <= 0 && !this.shieldActive) {
      this.shieldActive = true;
      this.shieldT = 2.2;
      this.shieldCd = this.shieldCdMax;
      this.audio.shield();
    }
    if (this.shieldActive) {
      this.shieldT -= dt;
      this.shieldMesh.visible = true;
      this.shieldMesh.position.copy(this.pos);
      this.shieldMesh.rotation.y += dt * 1.5;
      if (this.shieldT <= 0) { this.shieldActive = false; this.shieldMesh.visible = false; }
    }

    // --- Recoil recovery ---
    this.recoil.x *= (1 - dt * 8);
    this.recoil.y *= (1 - dt * 8);

    // --- Camera ---
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    const spd = Math.hypot(this.vel.x, this.vel.z);
    // FOV berdasarkan kecepatan (sprint 78->86)
    const fovTarget = 78 + Math.min(spd / 11, 1) * 8;
    if (!this._fovSmooth) this._fovSmooth = 78;
    this._fovSmooth += (fovTarget - this._fovSmooth) * dt * 6;
    this.engine.camera.fov = this._fovSmooth;
    this.engine.camera.updateProjectionMatrix();
    // Strafe roll: miring saat strafing
    const strafe = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
    const roll = Math.max(-0.03, Math.min(0.03, -strafe * 0.004));
    // Landing dip
    if (this.onGround && !this._wasGround) this._landDip = 0.12;
    if (this._landDip > 0.001) this._landDip *= (1 - dt * 8); else this._landDip = 0;
    this._wasGround = this.onGround;
    this.engine.camera.position.copy(this.pos);
    this.engine.camera.position.y += 0.55 - this._landDip;
    this.engine.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch + this.recoil.y, this.yaw + this.recoil.x, roll, 'YXZ'));
  }

  addRecoil(amount) {
    this.recoil.y -= amount;
    this.recoil.x += (Math.random() - 0.5) * amount * 0.4;
  }

  get position() { return this.pos; }
}
