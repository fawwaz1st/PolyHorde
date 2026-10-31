import * as THREE from 'three/webgpu';
import { Input } from './Input.js';
import { Audio } from './Audio.js';
import { Events } from './EventBus.js';
import { Player } from '../player/Player.js';
import { Arena } from '../world/Arena.js';
import { WeaponSystem } from '../weapons/WeaponSystem.js';
import { AbilitySystem } from '../abilities/AbilitySystem.js';
import { EnemyManager } from '../enemies/EnemyManager.js';
import { Particles } from '../systems/Particles.js';
import { ShakeController } from '../systems/ShakeController.js';
import { addOutline } from '../systems/CelOutline.js';
import { HUD } from '../ui/HUD.js';

const STATES = { MENU: 0, PLAYING: 1, GAME_OVER: 2 };

export class Game {
  constructor() {
    this.state = STATES.MENU;
    this.score = 0;
    this.kills = 0;
    this.wave = 0;
    this.waveCooldown = 0;
    this._waveIncoming = false;

    // Renderer – WebGPU auto-fallback r185+
    this.renderer = new THREE.WebGPURenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    document.body.prepend(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a1a);
    this.scene.fog = new THREE.FogExp2(0x0a0a1a, 0.012);

    // Camera
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 1.8, 0);
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._baseFov = this.camera.fov;
    this._fovKick = 0;
    this._hitStopT = 0;

    // Timer
    this.timer = new THREE.Timer();

    // Systems
    this.input = new Input(this.renderer.domElement);
    this.audio = new Audio();
    this.particles = new Particles(this.scene);
    this.shake = new ShakeController();

    // World
    this.arena = new Arena(this.scene);

    // Player
    this.player = new Player(this.camera, this.arena.octree, this.input);

    // Weapons
    this.weaponSystem = new WeaponSystem(this.scene, this.camera, this.player, this.arena.octree, this.particles, this.audio, this);

    // Abilities
    this.abilitySystem = new AbilitySystem(this.player, this.input, this.audio, this.particles, this.scene, this);

    // Enemies
    this.enemyManager = new EnemyManager(this.scene, this.arena.octree, this.particles, this.audio, this);

    // HUD
    this.hud = new HUD(this.weaponSystem, this.abilitySystem, this);

    // Lighting
    this._setupLighting();

    // Cel-shading outlines on world
    this._setupOutline();

    // Resize
    window.addEventListener('resize', () => this._resize());

    // Events
    Events.on('enemy-killed', (data) => {
      if (this.state !== STATES.PLAYING) return;
      this.kills++;
      this.score += data.score * Math.max(1, (this.hud.combo || 0));
      this.hud.addCombo();
      // Juice 2026: hit-stop mikro pada kill
      this.hitStop(0.05);
    });

    // Catharsis — clear wave: slow-mo singkat + chord naik (tension-release loop)
    Events.on('wave-clear', () => {
      if (this.state !== STATES.PLAYING) return;
      this.hitStop(0.45);
      this.audio.playWaveClear();
      this.score += this.wave * 50;
      this.hud.announceClear();
    });

    // State callbacks
    this.input.onPointerLock = () => {
      this.blocker?.classList.add('hidden');
      this.hud.show();
    };

    // Player death callback
    this.player.onDeath = () => this._gameOver();

    // Explosion lights pool
    this._explosionLights = [];
    this._rimFwd = new THREE.Vector3();

    // Zero-alloc loop: pre-bound callback (riset 2026: closure per frame = alokasi sia-sia)
    this._boundAnimate = this._animate.bind(this);

    this.renderer.init().then(() => {
      requestAnimationFrame(this._boundAnimate);
    });
  }

  _setupLighting() {
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffeecc, 1.8);
    dir.position.set(15, 25, 10);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 60;
    dir.shadow.camera.left = -20;
    dir.shadow.camera.right = 20;
    dir.shadow.camera.top = 20;
    dir.shadow.camera.bottom = -20;
    this.scene.add(dir);

    const fill = new THREE.DirectionalLight(0x4466ff, 0.3);
    fill.position.set(-10, 5, -10);
    this.scene.add(fill);

    // Camera-relative back rim
    this.rim = new THREE.DirectionalLight(0xff6644, 0.4);
    this.rim.target = new THREE.Object3D();
    this.scene.add(this.rim);
    this.scene.add(this.rim.target);
  }

  _setupOutline() {
    this.arena.meshes.forEach(m => {
      if (m.isInstancedMesh || m.userData.noOutline) return;
      addOutline(m, this.scene);
    });
  }

  _resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ===== Juice API 2026 =====
  // FOV punch: zoom-out sesaat lalu snap balik — menjual gaya kinetik
  fovKick(amount) {
    this._fovKick = Math.min(this._fovKick + amount, 3);
  }

  // Hit-stop: mikro-pause (2-4 frame) pada hit berat — riset 2026
  hitStop(duration) {
    this._hitStopT = Math.max(this._hitStopT, duration);
  }

  _animate() {
    requestAnimationFrame(this._boundAnimate);
    this.timer.update();
    const rawDt = Math.min(this.timer.getDelta(), 0.05);
    let dt = rawDt;

    // Hit-stop: dunia melambat drastis selama window singkat
    if (this._hitStopT > 0) {
      this._hitStopT -= rawDt;
      dt *= 0.12;
    }

    if (this.state === STATES.PLAYING) {
      this._update(dt);
      this.shake.update(dt);
      this.camera.position.x += this.shake.offset.x;
      this.camera.position.y += this.shake.offset.y;
    }

    // FOV punch decay — hanya update projection saat berubah
    if (this._fovKick > 0.001) {
      this._fovKick *= (1 - rawDt * 9);
      this.camera.fov = this._baseFov + this._fovKick * 5;
      this.camera.updateProjectionMatrix();
    } else if (this.camera.fov !== this._baseFov) {
      this._fovKick = 0;
      this.camera.fov = this._baseFov;
      this.camera.updateProjectionMatrix();
    }

    this.renderer.render(this.scene, this.camera);
  }

  _update(dt) {
    // Mouse look
    if (this.input.isLocked) {
      const sensitivity = 0.002;
      this.player.yaw -= this.input.mouse.dx * sensitivity;
      this.player.pitch = Math.max(-1.4, Math.min(1.4, this.player.pitch - this.input.mouse.dy * sensitivity));
    }

    this.input.update();

    // Recoil
    this.player.updateRecoil(dt);
    this.player.pitch = Math.max(-1.4, Math.min(1.4, this.player.pitch + this.player.recoilOffset.y));
    this.player.yaw += this.player.recoilOffset.x;

    // Camera rotation
    this.camera.quaternion.setFromEuler(this._euler.set(this.player.pitch, this.player.yaw, 0, 'YXZ'));

    // Player physics (substep)
    const substeps = 5;
    const subDt = dt / substeps;
    for (let i = 0; i < substeps; i++) this.player.update(subDt, this.input);

    // Camera follow player
    this.camera.position.copy(this.player.position);
    this.camera.position.y += 0.3;

    // Camera-relative rim light
    this._rimFwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.rim.position.copy(this.camera.position).addScaledVector(this._rimFwd, -5);
    this.rim.position.y += 2;
    this.rim.target.position.copy(this.camera.position);
    this.rim.target.updateMatrixWorld();

    // Update systems
    this.weaponSystem.update(dt, this.input, this.camera);
    this.abilitySystem.update(dt, this.input);
    this.abilitySystem.updateGrenades(dt);
    this.enemyManager.update(dt, this.player, this.weaponSystem);
    this._checkEnemyCollisions(dt);
    this.particles.update(dt);
    this._updateWaves(dt);

    // Explosion lights
    this._updateLights(dt);

    // HUD
    this.hud.update(this.score, this.kills, this.wave, this.player, this.enemyManager, dt);
  }

  _updateLights(dt) {
    for (let i = this._explosionLights.length - 1; i >= 0; i--) {
      const l = this._explosionLights[i];
      l.intensity *= (1 - dt * 8);
      if (l.intensity < 0.1) { this.scene.remove(l); this._explosionLights.splice(i, 1); }
    }
  }

  spawnExplosionLight(pos, color = 0xff6600, intensity = 8, radius = 10) {
    const light = new THREE.PointLight(color, intensity, radius);
    light.position.copy(pos);
    this.scene.add(light);
    this._explosionLights.push(light);
  }

  _checkEnemyCollisions(dt) {
    if (this.player.shieldActive) return;
    for (const enemy of this.enemyManager.enemies) {
      if (!enemy.alive) continue;
      if (this.enemyManager.collidesWith(enemy, this.player)) {
        this.player.takeDamage(enemy.collisionDamage * dt);
        this.hud.flashDamage();
      }
    }
  }

  // Tension-release loop (riset 2026): lull -> warning (growl+radar) -> climax -> catharsis
  _updateWaves(dt) {
    if (this.waveCooldown > 0) {
      this.waveCooldown -= dt;
      if (this.waveCooldown <= 0 && this._waveIncoming) {
        this._waveIncoming = false;
        this.wave++;
        this.hud.announceWave(this.wave);
        this.enemyManager.startWave(this.wave);
      }
      return;
    }
    const alive = this.enemyManager.aliveEnemies.length;
    if (alive === 0 && !this.enemyManager.spawning && !this._waveIncoming) {
      this._waveIncoming = true;
      this.waveCooldown = 3.5;
      this.hud.announceIncoming(this.wave + 1);
      this.audio.playWaveGrowl();
    }
  }

  _gameOver() {
    if (this.state === STATES.GAME_OVER) return;
    this.state = STATES.GAME_OVER;
    document.exitPointerLock();
    this.hud.showGameOver(this.score, this.wave, this.kills);
  }

  setBlocker(el) { this.blocker = el; }

  start() {
    this.state = STATES.PLAYING;
    this.timer.reset();
    this.wave = 1;
    this.score = 0;
    this.kills = 0;
    this.waveCooldown = 2.0;
    this._waveIncoming = true;
    this.player.reset();
    this.enemyManager.reset();
    this.weaponSystem.reset();
    this.abilitySystem.reset();
    this.hud.announceIncoming(this.wave);
    this.audio.playWaveGrowl();
  }
}
