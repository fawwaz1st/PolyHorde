import * as THREE from 'three/webgpu';
import { Capsule } from 'three/addons/math/Capsule.js';

const GRAVITY = -25;
const SPEED = 7;
const JUMP = 7;
const DASH_SPEED = 22;
const DASH_DUR = 0.2;
const MAX_HP = 100;

export class Player {
  constructor(camera, octree, input) {
    this.camera = camera;
    this.octree = octree;
    this.input = input;

    // Capsule collider
    this.capsule = new Capsule(
      new THREE.Vector3(0, 0.5, 0),
      new THREE.Vector3(0, 1.5, 0),
      0.35
    );

    this.velocity = new THREE.Vector3();
    this.onFloor = false;
    this.hp = MAX_HP;
    this.maxHp = MAX_HP;
    this.alive = true;

    // Camera look direction (yaw = left/right, pitch = up/down)
    this.yaw = 0;
    this.pitch = 0;

    // Recoil state
    this.recoilOffset = new THREE.Vector2();
    this.recoilRecovery = 8;

    // Dash state
    this.isDashing = false;
    this.dashTimer = 0;
    this.dashDir = new THREE.Vector3();

    // Shield state
    this.shieldActive = false;
    this.shieldTimer = 0;
    this.shieldDuration = 2;
    this.shieldCooldown = 8;

    // Temp reuse vectors
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._moveDir = new THREE.Vector3();
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();

    this.onDeath = null;
  }

  reset() {
    this.capsule.start.set(0, 0.5, 0);
    this.capsule.end.set(0, 1.5, 0);
    this.velocity.set(0, 0, 0);
    this.onFloor = false;
    this.hp = MAX_HP;
    this.alive = true;
    this.recoilOffset.set(0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.isDashing = false;
    this.dashTimer = 0;
    this.shieldActive = false;
    this.shieldTimer = 0;
  }

  get headHeight() {
    return this.capsule.end.y + 0.3;
  }

  takeDamage(amount) {
    if (!this.alive || this.shieldActive) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.alive = false;
      this.onDeath?.();
    }
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  dash(dir) {
    if (this.isDashing) return;
    this.isDashing = true;
    this.dashTimer = DASH_DUR;
    this.dashDir.copy(dir).normalize();
  }

  updateRecoil(dt) {
    this.recoilOffset.x *= (1 - dt * this.recoilRecovery);
    this.recoilOffset.y *= (1 - dt * this.recoilRecovery);
    if (Math.abs(this.recoilOffset.x) < 0.001) this.recoilOffset.x = 0;
    if (Math.abs(this.recoilOffset.y) < 0.001) this.recoilOffset.y = 0;
  }

  addRecoil(amount) {
    this.recoilOffset.y -= amount;
    // Random horizontal kick
    this.recoilOffset.x += (Math.random() - 0.5) * amount * 0.3;
  }

  update(dt, input) {
    if (!this.alive) return;

    // Dash logic
    if (this.isDashing) {
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) {
        this.isDashing = false;
      } else {
        // Apply dash velocity
        this.velocity.copy(this.dashDir);
        this.velocity.y = 0;
        this.velocity.multiplyScalar(DASH_SPEED);
      }
    }

    // Movement input (skip during dash — dash overrides)
    if (!this.isDashing) {
      // Get camera-relative directions
      this.camera.getWorldDirection(this._forward);
      this._forward.y = 0;
      this._forward.normalize();
      this._right.crossVectors(this._forward, this._up).normalize();

      this._moveDir.set(0, 0, 0);
      if (input.isDown('KeyW')) this._moveDir.add(this._forward);
      if (input.isDown('KeyS')) this._moveDir.sub(this._forward);
      if (input.isDown('KeyA')) this._moveDir.sub(this._right);
      if (input.isDown('KeyD')) this._moveDir.add(this._right);

      if (this._moveDir.lengthSq() > 0) {
        this._moveDir.normalize();
        this.velocity.x = this._moveDir.x * SPEED;
        this.velocity.z = this._moveDir.z * SPEED;
      } else {
        // Friction
        this.velocity.x *= (1 - dt * 10);
        this.velocity.z *= (1 - dt * 10);
      }

      // Jump
      if (input.isDown('Space') && this.onFloor) {
        this.velocity.y = JUMP;
        this.onFloor = false;
      }
    }

    // Gravity
    this.velocity.y += GRAVITY * dt;

    // Integrate position (substep in Game loop, but we do one step here)
    this._v1.copy(this.capsule.start);
    this._v2.copy(this.capsule.end);
    this._v1.addScaledVector(this.velocity, dt);
    this._v2.addScaledVector(this.velocity, dt);
    this.capsule.start.copy(this._v1);
    this.capsule.end.copy(this._v2);

    // Collision detection
    this._collide(dt);
  }

  _collide(dt) {
    this.onFloor = false;
    const result = this.octree.capsuleIntersect(this.capsule);

    if (result) {
      // Floor check
      if (result.normal.y > 0.15) {
        this.onFloor = true;
        // Zero vertical velocity when landing
        if (this.velocity.y < 0) this.velocity.y = 0;
      } else {
        // Slide along walls
        this.velocity.addScaledVector(result.normal, -result.normal.dot(this.velocity));
      }

      // Push out
      if (result.depth > 1e-10) {
        this.capsule.translate(
          this._v1.copy(result.normal).multiplyScalar(result.depth)
        );
      }
    }

    // Keep within arena bounds
    const radius = 18;
    const pos = this.capsule.end;
    const horiz = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    if (horiz > radius) {
      const scale = radius / horiz;
      this.capsule.start.x *= scale;
      this.capsule.start.z *= scale;
      this.capsule.end.x *= scale;
      this.capsule.end.z *= scale;
      this.velocity.x *= 0.5;
      this.velocity.z *= 0.5;
    }
    // Floor
    if (this.capsule.end.y < -2) {
      this.capsule.start.y = -2 - 1;
      this.capsule.end.y = -2;
      this.velocity.y = 0;
      this.onFloor = true;
    }
  }

  get position() {
    return this.capsule.end;
  }
}
