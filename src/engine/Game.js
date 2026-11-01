import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { Input } from './Input.js';
import { Audio, Music } from './Audio.js';
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
import { Story } from './Story.js';

const STATES = { MENU: 0, PLAYING: 1, GAME_OVER: 2, PAUSED: 3 };

export class Game {
  constructor() {
    this.state = STATES.MENU;
    this.score = 0;
    this.kills = 0;
    this.wave = 0;
    this._nextWave = 0;
    this.waveCooldown = 0;
    this._waveIncoming = false;

    // Renderer – WebGPU auto-fallback r185+
    const dpr = window.devicePixelRatio || 1;
    const dm = navigator.deviceMemory ?? (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 6 ? 3 : 4);
    const lowEnd = dm < 4;
    const isMobileUA = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    this.renderer = new THREE.WebGPURenderer({
      antialias: dpr <= 1.5 && !isMobileUA,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Bloom aktif → scene RT HalfFloat pada drawing-buffer size (dpr ikut) = ~51MB @dpr 1.75; cap dpr 1.5 saat bloom
    const bloomDprCap = this.renderPipeline ? 1.5 : 1.75;
    this.renderer.setPixelRatio(Math.min(dpr, isMobileUA ? 1.25 : (lowEnd ? 1.25 : bloomDprCap)));
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
    // KRITIS: kamera wajib masuk scene agar anak-anaknya (viewmodel senjata) ikut dirender
    this.scene.add(this.camera);
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._baseFov = this.camera.fov;
    this._fovKick = 0;
    this._hitStopT = 0;

    // Timer
    this.timer = new THREE.Timer();

    // Systems
    this.input = new Input(this.renderer.domElement);
    this.audio = new Audio();
    this.music = new Music(this.audio.ctx);
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

    // Story mode: JIT narrative + objective HUD
    this.story = new Story(this);

    // Lighting
    this._setupLighting();

    // Cel-shading outlines on world
    this._setupOutline();

    // Resize
    window.addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.music?.stop();
      else if (this.state === 1) this.music?.start();
    });

    // Events
    Events.on('enemy-killed', (data) => {
      if (this.state !== STATES.PLAYING) return;
      this.kills++;
      // Combo hanya di-naikkan HUD (dulu dobel: di sini + di listener HUD -> skor inflasi)
      const combo = this.hud.combo;
      const tier = this.comboTier || 0;
      const feverMul = tier >= 3 ? 3 : tier >= 2 ? 2 : tier >= 1 ? 1.5 : 1;
      this.score += Math.round(data.score * Math.max(1, combo + 1) * feverMul);
      // Hit-stop mikro pada kill (juice 2026)
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
      // Resume dari pause
      if (this.state === STATES.PAUSED) {
        this.state = STATES.PLAYING;
        this.hud.hidePause();
        this.timer.reset();
        this.input.update(); // buang buffered Q/E/F/klik yang menumpuk saat pause
      }
    };
    this.input.onPointerLockLost = () => {
      // ESC melepas pointer lock -> PAUSE (dulu game tetap jalan: mati telanjang)
      if (this.state === STATES.PLAYING) {
        this.state = STATES.PAUSED;
        this.hud.showPause();
      }
    };

    // Player death callback
    this.player.onDeath = () => this._gameOver();

    // Explosion lights: PRE-ALOKASI pool (dulu new PointLight per ledakan = recompile shader -> hitch)
    this._lightPool = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xff6600, 0, 10);
      l.visible = false;
      this.scene.add(l);
      this._lightPool.push({ light: l, active: false, ttl: 0 });
    }
    this._rimFwd = new THREE.Vector3();

    // Zero-alloc loop: pre-bound callback (riset 2026: closure per frame = alokasi sia-sia)
    this._boundAnimate = this._animate.bind(this);

    this.renderer.init()
      .then(() => {
        // TSL post-processing (riset 2026): scenePass + bloom selektif — emisi neon/tracer/proyektil menyala
        try {
          const scenePass = pass(this.scene, this.camera);
          // sceneColor = scene+bloom (bukan hanya tekstur bloom — dulu layar hitam)
          const sceneColor = scenePass.getTextureNode('output');
          const bloomPass = bloom(scenePass, 0.55, 0.4, 0.72);
          const outputNode = sceneColor.add(bloomPass);
          this.renderPipeline = new THREE.RenderPipeline(this.renderer, outputNode);
          if (typeof this.renderPipeline.setResolutionScale === 'function') this.renderPipeline.setResolutionScale(0.35);
          else if (bloomPass && typeof bloomPass.setResolutionScale === 'function') bloomPass.setResolutionScale(0.35);
        } catch (e) {
          console.warn('Bloom pipeline tidak tersedia, lanjut tanpa post-processing:', e);
        }
        // Warm-up: satu kali render pipeline di init (compile shader bloom di luar RAF)
        if (this.renderPipeline) { try { this.renderPipeline.render(); } catch (e) { console.warn('pipeline warmup fail:', e); } }
        requestAnimationFrame(this._boundAnimate);
      })
      .catch((e) => {
        console.error('Renderer init failed:', e);
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#100;color:#f44;font-family:monospace;font-size:1.2rem;z-index:9999;';
        el.textContent = 'Renderer gagal init: ' + (e?.message || e);
        document.body.appendChild(el);
      });
  }

  _setupLighting() {
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffeecc, 1.8);
    dir.position.set(15, 25, 10);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024); // 2048->1024: -4.2M texel/frame
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

    // Bloom pipeline render; skip saat PAUSED (baterai) — kecuali first frame
    if (this.state === 3) return; // PAUSED: jangan render tiap frame
    if (this.renderPipeline) this.renderPipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }

  _update(dt) {
    // Mouse look
    if (this.input.isLocked) {
      const sensitivity = 0.002;
      this.player.yaw -= this.input.mouse.dx * sensitivity;
      this.player.pitch = Math.max(-1.4, Math.min(1.4, this.player.pitch - this.input.mouse.dy * sensitivity));
    }

    // Recoil — KOSMETIK kamera saja (dulu ditambahkan ke pitch/yaw tiap frame -> drift permanen)
    this.player.updateRecoil(dt);

    // Camera rotation: aim asli + offset recoil sementara (pulih sendiri, aim tak bergeser)
    const recoilPitch = this.player.pitch + this.player.recoilOffset.y;
    const recoilYaw = this.player.yaw + this.player.recoilOffset.x;
    this.camera.quaternion.setFromEuler(this._euler.set(
      Math.max(-1.5, Math.min(1.5, recoilPitch)),
      recoilYaw,
      0, 'YXZ'
    ));

    // Player physics (substep) — 5 -> 2: speed 7 m/s @60fps = 0.117 m/frame << 0.35 radius
    const substeps = 2;
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

    // Musik adaptif: intensity naik dengan jumlah musuh hidup + tekanan HP
    const alive = this.enemyManager.aliveEnemies.length;
    const pressure = Math.min(1, alive / 18 + (1 - this.player.hp / this.player.maxHp) * 0.4);
    this.music.setIntensity(pressure);
    // HUD
    this.hud.update(this.score, this.kills, this.wave, this.player, this.enemyManager, dt);

    // KRITIS: input di-clear di AKHIR frame — semua sistem sudah membaca justDown/mouseJustDown.
    // (Bug lama: clear di awal -> pistol/shotgun/roket & semua ability tak pernah aktif.)
    this.input.update();
  }

  _updateLights(dt) {
    for (let i = 0; i < this._lightPool.length; i++) {
      const s = this._lightPool[i];
      if (!s.active) continue;
      s.ttl -= dt;
      s.light.intensity *= (1 - dt * 8);
      if (s.ttl <= 0 || s.light.intensity < 0.1) {
        s.active = false;
        s.light.visible = false;
        s.light.intensity = 0;
      }
    }
  }

  // Reuse light dari pool — tidak ada alokasi / recompile material saat ledakan
  spawnExplosionLight(pos, color = 0xff6600, intensity = 8, radius = 10) {
    let slot = this._lightPool.find(s => !s.active);
    if (!slot) slot = this._lightPool[0]; // fallback: pakai tertua
    slot.active = true;
    slot.ttl = 0.4;
    slot.light.color.setHex(color);
    slot.light.distance = radius;
    slot.light.intensity = intensity;
    slot.light.position.copy(pos);
    slot.light.visible = true;
  }

  _checkEnemyCollisions(dt) {
    if (this.player.shieldActive) return;
    for (const enemy of this.enemyManager.enemies) {
      if (!enemy.alive) continue;
      if (this.enemyManager.collidesWith(enemy, this.player)) {
        this.player.takeDamage(enemy.collisionDamage * dt);
        this.hud.flashDamageFrom(enemy.mesh.position);
      }
    }
  }

  // Tension-release loop (riset 2026): lull -> warning (growl+radar) -> climax -> catharsis
  _updateWaves(dt) {
    if (this.waveCooldown > 0) {
      this.waveCooldown -= dt;
      if (this.waveCooldown <= 0 && this._waveIncoming) {
        this._waveIncoming = false;
        this.wave = this._nextWave;
        this.hud.announceWave(this.wave);
        this.enemyManager.startWave(this.wave);
      }
      return;
    }
    const alive = this.enemyManager.aliveEnemies.length;
    // Jangan announce wave baru selama telegraph wave lama masih pending (anti mixed wave)
    if (alive === 0 && !this.enemyManager.spawning && !this._waveIncoming && this.enemyManager.pendingSpawns === 0) {
      this._waveIncoming = true;
      this._nextWave = this.wave + 1;
      this.waveCooldown = 3.5;
      this.hud.announceIncoming(this._nextWave);
      this.audio.playWaveGrowl();
    }
  }

  _gameOver() {
    if (this.state === STATES.GAME_OVER) return;
    this.state = STATES.GAME_OVER;
    document.exitPointerLock();
    this.audio.playDeath();
    this.music.stop();
    this.hud.showGameOver(this.score, this.wave, this.kills);
  }

  setBlocker(el) { this.blocker = el; }

  // Restart instan — semua sistem sudah punya reset(), tak perlu location.reload()
  restart() {
    this.hud.hideGameOver();
    this.hud.resetCombo();
    this.hitStop(0);
    this._hitStopT = 0;
    this._fovKick = 0;
    this.shake.intensity = 0;
    this.score = 0;
    this.kills = 0;
    this.state = STATES.PLAYING;
    this.timer.reset();
    this.wave = 1;
    this._nextWave = 1;
    this.waveCooldown = 2.0;
    this._waveIncoming = true;
    this.player.reset();
    this.enemyManager.reset();
    this.weaponSystem.reset();
    this.abilitySystem.reset();
    this.hud.announceIncoming(this.wave);
    this.audio.playWaveGrowl();
    this.music.start();
    this.story.reset();
    this.story.playIntro();
    document.body.requestPointerLock();
  }

  start() {
    this.hud.hideGameOver();
    this.hud.resetCombo();
    this.state = STATES.PLAYING;
    this.timer.reset();
    this.wave = 1;
    this._nextWave = 1;
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
    this.music.start();
    // Intro story hanya sekali per sesi — retry instan (UX audit: friksi retry)
    if (!this._introShown) { this._introShown = true; this.story.reset(); this.story.playIntro(); }
    else { this.story.reset(); this.story.setObjective('Bertahan. Combo 5 = FEVER x1,5.'); }
  }
}
