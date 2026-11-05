import * as THREE from 'three/webgpu';
import { buildWeaponModel } from '../core/Models.js';

export const WEAPONS = {
  pistol:  { name: 'PISTOL',  damage: 32, fireRate: 0.3,  mag: 9,  reload: 1.0, spread: 0.005, recoil: 0.045, auto: false, color: 0x6fb7ff, kb: 0.2,  pellets: 1 },
  ar:      { name: 'ASSAULT', damage: 9,  fireRate: 0.075, mag: 32, reload: 1.7, spread: 0.045, recoil: 0.03,  auto: true,  color: 0x7bd88f, kb: 0.08, pellets: 1 },
  shotgun: { name: 'SHOTGUN', damage: 11, fireRate: 0.55, mag: 6,  reload: 1.6, spread: 0.13,  recoil: 0.13,  auto: false, color: 0xffa06b, kb: 1.6,  pellets: 6 },
  rocket:  { name: 'ROCKET',  damage: 90, fireRate: 1.1,  mag: 4,  reload: 2.4, spread: 0.0,   recoil: 0.2,   auto: false, color: 0xff6b6b, kb: 0.5,  pellets: 1, projectile: true, speed: 26, radius: 5, splash: 70, selfMul: 0.35 },
};

export class Weapons {
  constructor(engine, player, audio, effects) {
    this.engine = engine;
    this.player = player;
    this.audio = audio;
    this.effects = effects;
    this.list = Object.keys(WEAPONS);
    this.idx = 0;
    this.state = {};
    for (const id of this.list) this.state[id] = { ...WEAPONS[id], ammo: WEAPONS[id].mag, cd: 0 };
    this.reloading = false;
    this.reloadT = 0;
    this._ray = new THREE.Raycaster();
    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._targets = [];
    this._bob = 0;
    this._switchT = 0;
    this._hitFlash = 0;

    // Viewmodel: group di kamera
    this.group = new THREE.Group();
    this.models = {};
    for (const id of this.list) {
      const m = buildWeaponModel(id);
      m.position.set(0.28, -0.24, -0.55);
      m.visible = false;
      this.group.add(m);
      this.models[id] = m;
    }
    engine.camera.add(this.group);
    this._show(this.list[0]);
  }

  get current() { return this.state[this.list[this.idx]]; }
  get currentDef() { return WEAPONS[this.list[this.idx]]; }

  _show(id) { for (const k of this.list) this.models[k].visible = (k === id); }

  switchTo(i) {
    if (i === this.idx || i < 0 || i >= this.list.length) return;
    this.idx = i;
    this.reloading = false;
    this._switchT = 0.16;
    this._show(this.list[i]);
    this.audio.reload();
  }

  reload() {
    const w = this.current;
    if (this.reloading || w.ammo === w.mag) return;
    this.reloading = true;
    this.reloadT = w.reload;
    this.audio.reload();
  }

  reset() {
    for (const id of this.list) { this.state[id].ammo = WEAPONS[id].mag; this.state[id].cd = 0; }
    this.idx = 0; this.reloading = false; this._show(this.list[0]);
  }

  update(dt, input, game) {
    const w = this.current;
    w.cd -= dt;

    // Hit flash timer
    if (this._hitFlash > 0) { this._hitFlash -= dt; if (this._hitFlash <= 0) game.ui?.setHitMarker(false); }

    // Reload
    if (this.reloading) {
      this.reloadT -= dt;
      const t = 1 - this.reloadT / w.reload;
      this.group.position.y = -0.12 * Math.sin(t * Math.PI);
      if (this.reloadT <= 0) { this.reloading = false; w.ammo = w.mag; this.group.position.y = 0; }
      this._updateRockets(dt, game);
      return;
    }

    // Fire
    const fire = w.auto ? input.mouse.left : input.mouseJustDown();
    if (fire && w.cd <= 0 && w.ammo > 0) {
      this._fire(w, game);
      w.cd = w.fireRate;
      w.ammo--;
      if (w.ammo <= 0) this.reload();
    }

    this._updateRockets(dt, game);
    this._bobUpdate(dt);
  }

  _fire(w, game) {
    this.audio.shoot(this.list[this.idx]);
    this.player.addRecoil(w.recoil);
    game.shake.add(w.recoil * 1.6);
    game.fovKick(w.projectile ? 0.6 : w.pellets > 1 ? 0.3 : 0.12);
    game.ui?.bumpBloom(w.recoil * 2.5);

    // Muzzle flash
    this._dir.set(0, 0, -1).applyQuaternion(this.engine.camera.quaternion);
    this._tmp.copy(this.player.position).addScaledVector(this._dir, 1.2);
    this.effects.muzzle(this._tmp, w.color);

    if (w.projectile) { this._spawnRocket(w, game); return; }

    // Hitscan
    const pellets = w.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      const sx = (Math.random() - 0.5) * w.spread * 2;
      const sy = (Math.random() - 0.5) * w.spread * 2;
      this._dir.set(sx, sy, -1).applyQuaternion(this.engine.camera.quaternion).normalize();
      this._ray.set(this.player.position, this._dir);
      this._ray.far = 80;

      this._targets.length = 0;
      const ml = game.enemies.list;
      for (let i = 0; i < ml.length; i++) this._targets.push(ml[i].group);
      const wl = game.world.props;
      for (let i = 0; i < wl.length; i++) this._targets.push(wl[i].mesh);

      const hits = this._ray.intersectObjects(this._targets, true);
      if (hits.length > 0) {
        const h = hits[0];
        let obj = h.object;
        while (obj && !obj.userData.enemy && obj.parent) obj = obj.parent;
        if (obj?.userData.enemy) {
          obj.userData.enemy.damage(w.damage, w.kb, this._dir);
          this.effects.impact(h.point, w.color);
          this.audio.hit(h.point);
          game.ui?.setHitMarker(true);
          this._hitFlash = 0.16;
        } else {
          this.effects.spark(h.point);
        }
      } else {
        // Tracer
        const end = this._tmp.copy(this.player.position).addScaledVector(this._dir, 50);
        this.effects.tracer(this.player.position, end, w.color);
      }
    }
  }

  _spawnRocket(w, game) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffaa66, toneMapped: false })
    );
    mesh.position.copy(this.player.position);
    this._dir.set(0, 0, -1).applyQuaternion(this.engine.camera.quaternion);
    mesh.position.addScaledVector(this._dir, 1);
    this.engine.scene.add(mesh);
    game.rockets.push({ mesh, vel: this._dir.clone().multiplyScalar(w.speed), life: 3, damage: w.splash, radius: w.radius, selfMul: w.selfMul });
  }

  _updateRockets(dt, game) {
    const list = game.rockets;
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      r.mesh.position.addScaledVector(r.vel, dt);
      r.life -= dt;
      let boom = r.life <= 0 || r.mesh.position.y < 0.1 || Math.hypot(r.mesh.position.x, r.mesh.position.z) > game.world.radius;
      if (!boom) {
        for (const e of game.enemies.list) {
          if (r.mesh.position.distanceTo(e.group.position) < 1.6) { boom = true; break; }
        }
      }
      if (boom) {
        this.effects.explosion(r.mesh.position, r.radius);
        this.audio.explosion(r.mesh.position);
        game.shake.add(0.5);
        game.fovKick(0.5);
        // splash damage
        for (let j = game.enemies.list.length - 1; j >= 0; j--) {
          const e = game.enemies.list[j];
          const d = r.mesh.position.distanceTo(e.group.position);
          if (d < r.radius) e.damage(r.damage * (1 - d / r.radius), 0.5);
        }
        const pd = r.mesh.position.distanceTo(this.player.position);
        if (pd < r.radius) this.player.takeDamage(r.damage * (1 - pd / r.radius) * r.selfMul);
        this.engine.scene.remove(r.mesh);
        list.splice(i, 1);
      }
    }
  }

  _bobUpdate(dt) {
    this._bob += dt;
    const speed = Math.hypot(this.player.vel.x, this.player.vel.z);
    const b = Math.sin(this._bob * 9) * 0.008 * Math.min(speed, 8);
    this.group.position.y = -0.12 * 0 + b;
    this.group.position.x = Math.sin(this._bob * 6) * 0.004 * Math.min(speed, 8);
    if (this._switchT > 0) {
      this._switchT -= dt;
      const t = Math.max(0, this._switchT) / 0.16;
      this.group.position.y -= Math.sin(t * Math.PI) * 0.15;
    }
  }
}
