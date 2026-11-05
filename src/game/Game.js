import * as THREE from 'three/webgpu';
import { Engine } from '../core/Engine.js';
import { Input } from '../core/Input.js';
import { Audio, Music } from '../core/Audio.js';
import { Events } from '../core/Events.js';
import { World } from './World.js';
import { Player } from './Player.js';
import { Weapons } from './Weapons.js';
import { Enemies } from './Enemies.js';
import { Effects } from './Effects.js';
import { UI } from './UI.js';

const STATE = { MENU: 0, PLAYING: 1, PAUSED: 2, GAMEOVER: 3 };

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = STATE.MENU;
    this.score = 0; this.kills = 0; this.wave = 0;
    this.combo = 0; this.comboTier = 0; this.comboTimer = 0;
    this.objective = '';
    this.spawnQueue = [];
    this.rockets = [];
    this.waveCooldown = 0;
    this._waveIncoming = false;
    this._nextWave = 0;
    this.sensitivity = 1;
    this.reducedMotion = false;

    // Juice
    this.shake = { intensity: 0, offset: { x: 0, y: 0 }, add(v) { this.intensity = Math.min(this.intensity + v, 1.5); } };
    this._fovKick = 0;
    this._hitStop = 0;
    this._baseFov = 78;

    // Systems
    this.engine = new Engine(canvas);
    this.input = new Input(canvas);
    this.audio = new Audio();
    this.music = new Music(this.audio);
    this.effects = new Effects(this.engine);
    this.ui = new UI();

    this.input.onLock = () => {
      this.ui.hideMenu();
      this.ui.hidePause();
      if (this.state === STATE.PAUSED) this.state = STATE.PLAYING;
      this.audio.resume();
    };
    this.input.onUnlock = () => {
      if (this.state === STATE.PLAYING) { this.state = STATE.PAUSED; this.ui.showPause(); document.body.classList.add('paused'); }
    };
  }

  async init() {
    await this.engine.init();
    this.world = new World(this.engine.scene);
    this.player = new Player(this.engine, this.input, this.world, this.audio);
    this.weapons = new Weapons(this.engine, this.player, this.audio, this.effects);
    this.enemies = new Enemies(this.engine, this.world, this.audio, this.effects);

    // Events
    Events.on('enemy-killed', (d) => {
      if (this.state !== STATE.PLAYING) return;
      this.kills++;
      this.combo++;
      this.comboTimer = 2.5;
      const tier = this.comboTier;
      const mul = tier >= 3 ? 3 : tier >= 2 ? 2 : tier >= 1 ? 1.5 : 1;
      const val = Math.round(d.score * Math.max(1, this.combo) * mul);
      this.score += val;
      this.effects.damageNumber(d.pos, val, 'kill');
      this.hitStop(0.04);
      // Shard HP untuk kill dekat (< 8 m) — ekonomi agresi
      if (d.pos.distanceTo(this.player.position) < 8) this.effects.shard(d.pos, d.type);
    });

    // Input untuk senjata & ability
    window.addEventListener('wheel', (e) => {
      if (this.state !== STATE.PLAYING) return;
      const d = e.deltaY > 0 ? 1 : -1;
      this.weapons.switchTo((this.weapons.idx + d + this.weapons.list.length) % this.weapons.list.length);
    });
    window.addEventListener('keydown', (e) => {
      if (this.state !== STATE.PLAYING) return;
      const n = parseInt(e.key);
      if (n >= 1 && n <= 4) this.weapons.switchTo(n - 1);
      if (e.key === 'r' || e.key === 'R') this.weapons.reload();
    });

    window.addEventListener('resize', () => this.engine.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.music.stop();
      else if (this.state === STATE.PLAYING) this.music.start();
    });

    this.ui.showMenu();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // --- State ---
  start() {
    this.state = STATE.PLAYING;
    this.score = 0; this.kills = 0; this.wave = 1;
    this.combo = 0; this.comboTier = 0; this.comboTimer = 0;
    this.spawnQueue = [];
    this.rockets.forEach(r => this.engine.scene.remove(r.mesh));
    this.rockets = [];
    this.player.reset();
    this.weapons.reset();
    this.enemies.reset();
    this.effects.count = 0;
    this.waveCooldown = 1.6;
    this._waveIncoming = true;
    this._nextWave = 1;
    this.objective = 'Bertahan: wave 1. Pelajari pola spawn.';
    this.ui.hideMenu();
    this.ui.hideGameOver();
    this.ui.showHUD();
    this.ui.announce('WAVE 1', '— 7 musuh —', true);
    this.music.start();
  }

  restart() {
    this.ui.hideGameOver();
    this.ui.hidePause();
    document.body.classList.remove('paused');
    this.start();
    const p = document.body.requestPointerLock();
    if (p && p.catch) p.catch(() => this.ui.showPause());
  }

  _gameOver() {
    if (this.state === STATE.GAMEOVER) return;
    this.state = STATE.GAMEOVER;
    document.exitPointerLock?.();
    this.audio.gameOver();
    this.music.stop();
    let high = 0;
    try { high = parseInt(localStorage.getItem('polyHordeHigh') || '0'); } catch {}
    const isNew = this.score > high;
    if (isNew) { try { localStorage.setItem('polyHordeHigh', String(this.score)); } catch {} }
    this.ui.showGameOver(this.score, this.wave, this.kills, isNew);
  }

  // --- Juice ---
  hitStop(t) { this._hitStop = Math.max(this._hitStop, t); }
  fovKick(v) { this._fovKick = Math.min(this._fovKick + v, 2.5); }
  hurtPlayer(pos) {
    this.audio.playerHurt(pos);
    this.ui.hurtDirection(pos, this.player.position, this.player.yaw);
  }

  // --- Loop ---
  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(this._clock ? (performance.now() - this._clock) / 1000 : 0.016, 0.05);
    this._clock = performance.now();

    if (this._hitStop > 0) { this._hitStop -= dt; this._slow = true; } else this._slow = false;
    const sdt = this._slow ? dt * 0.12 : dt;

    if (this.state === STATE.PLAYING) {
      this._update(sdt, dt);
    }
    // FOV kick
    if (this._fovKick > 0.001 && !this.reducedMotion) {
      this._fovKick *= (1 - dt * 9);
      this.engine.camera.fov = this._baseFov + this._fovKick * 5;
      this.engine.camera.updateProjectionMatrix();
    } else if (this.engine.camera.fov !== this._baseFov) {
      this._fovKick = 0;
      this.engine.camera.fov = this._baseFov;
      this.engine.camera.updateProjectionMatrix();
    }
    // Shake
    if (!this.reducedMotion) {
      if (this.shake.intensity > 0.001) {
        this.shake.offset.x = (Math.random() - 0.5) * this.shake.intensity * 0.12;
        this.shake.offset.y = (Math.random() - 0.5) * this.shake.intensity * 0.12;
        this.shake.intensity *= (1 - dt * 6);
      } else { this.shake.offset.x = this.shake.offset.y = 0; this.shake.intensity = 0; }
    } else { this.shake.offset.x = this.shake.offset.y = 0; this.shake.intensity = 0; }

    // Render (skip saat menu/pause/gameover untuk hemat)
    if (this.state !== STATE.MENU && this.state !== STATE.PAUSED && this.state !== STATE.GAMEOVER) {
      this.engine.render();
    }
  }

  _update(dt, rawDt) {
    // Mouse look
    if (this.input.isLocked) {
      const s = 0.002 * this.sensitivity;
      this.player.yaw -= this.input.mouse.dx * s;
      this.player.pitch = Math.max(-1.45, Math.min(1.45, this.player.pitch - this.input.mouse.dy * s));
    }

    this.player.update(dt);
    this.weapons.update(dt, this.input, this);
    this.enemies.update(dt, this.player, this);
    this.effects.update(dt);
    this.effects.updateShards(dt, this.player, (heal) => {
      this.player.heal(heal);
      this.audio.pickup();
    });

    // Kombo
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 0; this.comboTier = 0; }
    }
    this.comboTier = this.combo >= 30 ? 3 : this.combo >= 15 ? 2 : this.combo >= 5 ? 1 : 0;

    // Tabrakan musuh -> damage
    if (!this.player.shieldActive) {
      for (const e of this.enemies.list) {
        if (e.pos.distanceTo(this.player.position) < e.def.size + 0.7) {
          this.player.takeDamage(e.def.collision * dt);
          this.hurtPlayer(e.pos);
        }
      }
    }

    // Wave management
    this._updateWaves(dt);

    // Musik intensity
    const alive = this.enemies.list.length;
    const pressure = Math.min(1, alive / 16 + (1 - this.player.hp / this.player.maxHp) * 0.4);
    this.music.setIntensity(pressure);

    // Audio listener
    this.audio.updateListener(this.engine.camera.position, this.player.yaw);

    // Low HP warning
    if (this.player.hp < this.player.maxHp * 0.25 && this.player.hp > 0) {
      this._lowHpT = (this._lowHpT || 0) - dt;
      if (this._lowHpT <= 0) { this._lowHpT = 1.2; this.audio.lowHp(); }
    }

    // Death
    if (!this.player.alive) this._gameOver();

    // UI
    this.ui.update(dt, this);

    // Input cleanup
    this.input.endFrame();
  }

  _updateWaves(dt) {
    // Spawn queue (telegraf)
    if (this.spawnQueue.length > 0) {
      this._spawnT = (this._spawnT || 0) - dt;
      if (this._spawnT <= 0) {
        const s = this.spawnQueue.shift();
        this.enemies.spawn(s.type, s.x, s.z, s.hpScale, s.spdScale);
        this._spawnT = s.delay;
      }
    }
    if (this.waveCooldown > 0) {
      this.waveCooldown -= dt;
      if (this.waveCooldown <= 0 && this._waveIncoming) {
        this._waveIncoming = false;
        this.wave = this._nextWave;
        this._startWave(this.wave);
      }
      return;
    }
    const alive = this.enemies.list.length;
    if (alive === 0 && this.spawnQueue.length === 0 && !this._waveIncoming) {
      this._waveIncoming = true;
      this._nextWave = this.wave + 1;
      this.waveCooldown = 3.2;
      this.objective = 'Wave ' + this._nextWave + ' sebentar lagi...';
      this.ui.announce('WAVE ' + this._nextWave, '— ' + this.enemies.waveSize(this._nextWave) + ' musuh —', true);
      this.audio.waveClear();
      this.score += this.wave * 50;
      // Resupply grenade & heal kecil
      this.player.heal(8);
    }
  }

  _startWave(wave) {
    const size = this.enemies.waveSize(wave);
    const pool = this.enemies.wavePool(wave);
    const hpScale = 1 + (wave - 1) * 0.12;
    const spdScale = 1 + (wave - 1) * 0.03;
    for (let i = 0; i < size; i++) {
      const type = pool[(Math.random() * pool.length) | 0];
      const pos = this._spawnPos();
      this.spawnQueue.push({ type, x: pos.x, z: pos.z, delay: i * 0.35 + Math.random() * 0.3, hpScale, spdScale });
    }
    if (wave % 5 === 0) {
      const pos = this._spawnPos();
      this.spawnQueue.splice(Math.floor(this.spawnQueue.length / 2), 0, { type: 'boss', x: pos.x, z: pos.z, delay: 0.8, hpScale, spdScale });
    }
    this.ui.announce('WAVE ' + wave, '— ' + (size + (wave % 5 === 0 ? 1 : 0)) + ' musuh —');
    this.objective = this._objectiveFor(wave);
  }

  _spawnPos() {
    const p = this.player.position;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 13 + Math.random() * 5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const dx = x - p.x, dz = z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 10) continue;
      if (Math.hypot(x, z) < 3) continue;
      // Hindari depan mata
      const ang = Math.atan2(dx, dz);
      let rel = (ang - this.player.yaw) % (Math.PI * 2);
      if (rel < 0) rel += Math.PI * 2;
      const diff = Math.abs(rel > Math.PI ? rel - Math.PI * 2 : rel);
      if (diff > 1.22) return { x, z };
    }
    return { x: 14, z: 0 };
  }

  _objectiveFor(wave) {
    if (wave === 1) return 'Bertahan: wave 1. Pelajari pola spawn.';
    if (wave < 4) return 'Clear semua musuh. Kill dekat menjatuhkan shard HP.';
    if (wave < 6) return 'Hati-hati heavy — charge-nya menyakitkan.';
    if (wave < 10) return 'Bomber aktif. Dengarkan beep-nya.';
    return 'Endless: FEVER x3 pada combo 30.';
  }
}
