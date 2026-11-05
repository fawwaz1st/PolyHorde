import { Events } from '../engine/EventBus.js';
import { waveSize } from '../enemies/EnemyManager.js';

const RADAR_RANGE = 20;
const RADAR_DOTS = 18;
const POPUP_POOL = 10;

export class HUD {
  constructor(weaponSystem, abilitySystem, game) {
    this.weaponSystem = weaponSystem;
    this.abilitySystem = abilitySystem;
    this.game = game;

    this.el = {
      hud: document.getElementById('hud'),
      waveDisplay: document.getElementById('wave-display'),
      enemyCount: document.getElementById('enemy-count'),
      scoreDisplay: document.getElementById('score-display'),
      healthFill: document.getElementById('health-fill'),
      healthText: document.getElementById('health-text'),
      weaponHud: document.getElementById('weapon-hud'),
      abilityHud: document.getElementById('ability-hud'),
      crosshair: document.getElementById('crosshair'),
      crosshairHit: document.getElementById('crosshair-hit'),
      damageOverlay: document.getElementById('damage-overlay'),
      waveAnnounce: document.getElementById('wave-announce'),
      gameOver: document.getElementById('game-over'),
      goScore: document.getElementById('go-score'),
      goWave: document.getElementById('go-wave'),
      goKills: document.getElementById('go-kills'),
      goNewHigh: document.getElementById('go-new-high'),
      comboDisplay: document.getElementById('combo-display'),
      radar: document.getElementById('radar'),
      pause: document.getElementById('pause-overlay'),
      goRestart: document.getElementById('go-restart'),
      damageArc: document.getElementById('damage-arc'),
      fever: document.getElementById('fever-display'),
      hintToast: document.getElementById('hint-toast')
    };

    this.damageFlashTimer = 0;
    this._damageArcT = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.waveAnnounceTimer = 0;
    this._fireBloom = 0;
    this._hitConfirmT = 0;
    this._radarT = 0;

    // Dirty-check cache — hindari DOM churn per frame (riset 2026)
    this._last = {
      score: '', wave: '', enemy: '', hp: '', combo: ''
    };

    this._buildWeaponHUD();
    this._buildAbilityHUD();
    this._buildRadar();
    this._buildPopupPool();

    // Listen for kills → combo + popup skor (popup dulu dead code)
    Events.on('enemy-killed', (data) => {
      this.addCombo();
      if (data?.pos) this._scorePopup(data.pos, data.score);
    });

    // Restart instan tanpa reload halaman
    this.el.goRestart?.addEventListener('click', () => this.game.restart());
  }

  addCombo() {
    this.combo++;
    this.comboTimer = 2;
  }

  bumpFireBloom(amount = 0.3) {
    this._fireBloom = Math.min(this._fireBloom + amount, 1);
  }

  // ===== Kill popup pool — zero-alloc per kill =====
  _buildPopupPool() {
    this._popups = [];
    for (let i = 0; i < POPUP_POOL; i++) {
      const el = document.createElement('div');
      el.className = 'score-popup';
      el.style.cssText = 'position:fixed;z-index:30;font-family:Courier New,monospace;font-weight:bold;' +
        'font-size:1.3rem;color:#ff4;text-shadow:0 0 10px rgba(255,255,68,0.5);' +
        'pointer-events:none;opacity:0;';
      document.body.appendChild(el);
      this._popups.push({ el, active: false, t: 0, y: 0 });
    }
    this._popupIdx = 0;
  }

  _scorePopup(pos, score) {
    const tier = this.game.comboTier || 0;
    const feverMul = tier >= 3 ? 3 : tier >= 2 ? 2 : tier >= 1 ? 1.5 : 1;
    const val = Math.round(score * Math.max(1, this.combo) * feverMul);
    const p = this._popups[this._popupIdx];
    this._popupIdx = (this._popupIdx + 1) % POPUP_POOL;
    const v = this._toScreen(pos);
    const startX = v ? v.x : window.innerWidth / 2;
    const startY = v ? v.y : window.innerHeight / 2;
    p.el.textContent = '+' + val;
    p.el.style.left = startX + 'px';
    p.el.style.top = startY + 'px';
    p.el.style.opacity = '1';
    p.el.style.transition = 'none';
    p.el.style.transform = 'translate(-50%, -50%)';
    p.active = true;
    p.t = 0.8;
    p.y = startY;
    // trigger transition pada frame berikutnya
    requestAnimationFrame(() => {
      p.el.style.transition = 'all 0.8s ease-out';
      p.el.style.top = (p.y - 60) + 'px';
      p.el.style.opacity = '0';
    });
  }

  // ===== Radar — pool dot DOM, update 10Hz =====
  _buildRadar() {
    if (!this.el.radar) return;
    this._radarDots = [];
    for (let i = 0; i < RADAR_DOTS; i++) {
      const d = document.createElement('div');
      d.className = 'radar-dot';
      d.style.opacity = '0';
      this.el.radar.appendChild(d);
      this._radarDots.push(d);
    }
    // Ring radar jarak 3/6/9
    for (const r of [0.25, 0.5, 0.75]) {
      const ring = document.createElement('div');
      ring.className = 'radar-ring';
      ring.style.width = ring.style.height = (r * 100) + '%';
      this.el.radar.appendChild(ring);
    }
  }

  _updateRadar(dt, enemyManager, player) {
    this._radarT -= dt;
    if (this._radarT > 0) return;
    this._radarT = 0.1; // 10 Hz — hemat DOM work
    if (!this.el.radar) return;

    const sin = Math.sin(-player.yaw);
    const cos = Math.cos(-player.yaw);
    let di = 0;
    // Sort jarak: musuh terdekat WAJIB terlihat dulu (dulu bisa terselimuti 35 musuh)
    const enemies = enemyManager.aliveEnemies;
    if (!this._radarBuf) this._radarBuf = [];
    this._radarBuf.length = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const dx = e.mesh.position.x - player.position.x;
      const dz = e.mesh.position.z - player.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= RADAR_RANGE) this._radarBuf.push({ e, dx, dz, dist });
    }
    this._radarBuf.sort((a, b) => a.dist - b.dist);
    for (let n = 0; n < this._radarBuf.length && di < RADAR_DOTS; n++) {
      const { e, dx, dz } = this._radarBuf[n];
      // Rotasi ke frame pemain: forward = atas radar
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      const px = 50 + (rx / RADAR_RANGE) * 46;
      const py = 50 + (rz / RADAR_RANGE) * 46;
      const dot = this._radarDots[di++];
      dot.style.opacity = '0.9';
      dot.style.left = '50%';
      dot.style.top = '50%';
      dot.style.transform = 'translate3d(' + (px - 50) + '%, ' + (py - 50) + '%, 0) translate(-50%, -50%)';
      dot.style.willChange = 'transform';
      dot.style.background = e.type === 'bomber' ? '#4f4' : e.type === 'heavy' ? '#a6f' : '#f66';
    }
    // Telegraf aktif -> blip oranye berkedip (menghilangkan blind spot tension phase)
    const telegraphs = this.game?.enemyManager?._telegraphs;
    if (telegraphs && telegraphs.length > 0) {
      const blink = Math.sin(performance.now() / 180) > 0 ? 0.95 : 0.35;
      for (let t = 0; t < telegraphs.length && di < RADAR_DOTS; t++) {
        const tg = telegraphs[t];
        const dx = tg.x - player.position.x;
        const dz = tg.z - player.position.z;
        const sin = Math.sin(-player.yaw);
        const cos = Math.cos(-player.yaw);
        const rx = dx * cos - dz * sin;
        const rz = dx * sin + dz * cos;
        const px = 50 + (rx / RADAR_RANGE) * 46;
        const py = 50 + (rz / RADAR_RANGE) * 46;
        const dot = this._radarDots[di++];
        dot.style.opacity = String(blink);
        dot.style.left = px + '%';
        dot.style.top = py + '%';
        dot.style.background = '#fa4';
        dot.style.borderRadius = '50%';
      }
    }
    for (; di < RADAR_DOTS; di++) this._radarDots[di].style.opacity = '0';
  }

  _toScreen(worldPos) {
    const v = worldPos.clone().project(this.game.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  _buildWeaponHUD() {
    this.el.weaponHud.innerHTML = '';
    const labels = ['1', '2', '3', '4'];
    const names = ['PISTOL', 'ASSAULT', 'SHOTGUN', 'ROCKET'];
    this.weaponSlots = [];
    this._ammoEls = [];

    for (let i = 0; i < 4; i++) {
      const slot = document.createElement('div');
      slot.className = 'weapon-slot';
      slot.innerHTML = '<span class="key-hint">' + labels[i] + '</span>' + names[i] + '<div class="ammo">0/0</div>';
      this.el.weaponHud.appendChild(slot);
      this.weaponSlots.push(slot);
      this._ammoEls.push(slot.querySelector('.ammo'));
    }

    this._onWheel = (e) => {
      const delta = e.deltaY > 0 ? 1 : -1;
      const idx = this.weaponSystem.currentIndex;
      this.weaponSystem.switchWeapon((idx + delta + 4) % 4);
    };
    this._onKey = (e) => {
      const n = parseInt(e.key);
      if (n >= 1 && n <= 4) this.weaponSystem.switchWeapon(n - 1);
      if (e.key === 'r' || e.key === 'R') this.weaponSystem.reload();
    };
    document.addEventListener('wheel', this._onWheel);
    document.addEventListener('keydown', this._onKey);
  }

  dispose() {
    document.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('keydown', this._onKey);
    for (const p of this._popups) p.el.remove();
  }

  _buildAbilityHUD() {
    this.abilitySlots = {};
    this.el.abilityHud.innerHTML = '';
    for (const { key, name, id } of [{ key: 'Q', name: 'DASH', id: 'dash' }, { key: 'E', name: 'SHIELD', id: 'shield' }, { key: 'F', name: 'GRENADE', id: 'grenade' }]) {
      const slot = document.createElement('div');
      slot.className = 'ability-slot ready';
      slot.innerHTML = '<span class="key-hint">' + key + '</span> ' + name;
      this.el.abilityHud.appendChild(slot);
      this.abilitySlots[id] = slot;
    }
  }

  show() { this.el.hud.classList.add('show'); }
  hide() { this.el.hud.classList.remove('show'); }

  showPause() { this.el.pause?.classList.add('show'); }
  hidePause() { this.el.pause?.classList.remove('show'); }
  hideGameOver() {
    this.el.gameOver.classList.remove('show');
    if (this.el.goNewHigh) this.el.goNewHigh.style.display = 'none';
  }
  // Micro-hint: toast kontekstual JIT — sekali per run per event (onboarding)
  showHint(id, text) {
    if (this._hints?.has(id)) return;
    if (!this._hints) this._hints = new Set();
    this._hints.add(id);
    if (!this.el.hintToast) return;
    this.el.hintToast.textContent = text;
    this.el.hintToast.classList.add('show');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => this.el.hintToast?.classList.remove('show'), 2600);
  }

  resetCombo() {
    this.combo = 0;
    this.comboTimer = 0;
    this._last.combo = '';
    if (this.el.comboDisplay) this.el.comboDisplay.style.opacity = 0;
    if (this._hints) this._hints.clear();
  }

  flashDamage() {
    this.damageFlashTimer = 0.15;
    this.el.damageOverlay.classList.add('hit');
  }

  // Indikator arah serangan: putar arc sesuai azimuth penyerang relatif hadap pemain
  flashDamageFrom(attackerPos) {
    this.flashDamage();
    if (!this.el.damageArc || !attackerPos) return;
    const p = this.game.player;
    const dx = attackerPos.x - p.position.x;
    const dz = attackerPos.z - p.position.z;
    // Sudut absolut serangan, dikurangi hadap pemain (yaw) -> sudut layar
    const angleWorld = Math.atan2(-dx, -dz); // 0 = utara pemain hadap
    const angleRel = angleWorld - (-p.yaw) + Math.PI;
    const deg = -(angleRel * 180) / Math.PI;
    const arc = this.el.damageArc.firstElementChild;
    if (arc) arc.style.transform = 'rotate(' + deg + 'deg)';
    this.el.damageArc.classList.add('show');
    this._damageArcT = 0.35;
  }

  // Warning: wave incoming (tension phase)
  announceIncoming(wave) {
    this.waveAnnounceTimer = 3.4;
    this.el.waveAnnounce.innerHTML = 'WAVE ' + wave + ' INCOMING<div class="sub">— ' + waveSize(wave) + ' enemies — dengar growl… —</div>';
    this.el.waveAnnounce.classList.add('incoming');
    this.el.waveAnnounce.style.opacity = 1;
  }

  announceWave(wave) {
    this.waveAnnounceTimer = 3;
    this.el.waveAnnounce.classList.remove('incoming');
    this.el.waveAnnounce.innerHTML = 'WAVE ' + wave + '<div class="sub">— ' + waveSize(wave) + ' enemies —</div>';
    this.el.waveAnnounce.style.opacity = 1;
  }

  announceCascade() {
    this.waveAnnounceTimer = 2;
    this.el.waveAnnounce.classList.remove('incoming');
    this.el.waveAnnounce.innerHTML = 'KILL CASCADE<div class="sub">— domino ledakan —</div>';
    this.el.waveAnnounce.style.opacity = 1;
  }

  announceClear() {
    this.waveAnnounceTimer = 2;
    this.el.waveAnnounce.classList.remove('incoming');
    this.el.waveAnnounce.innerHTML = 'WAVE CLEAR<div class="sub">+' + (this.game.wave * 50) + ' — bersiap…</div>';
    this.el.waveAnnounce.style.opacity = 1;
  }

  showGameOver(score, wave, kills) {
    this.el.gameOver.classList.add('show');
    this.el.goScore.textContent = 'Score: ' + score;
    this.el.goWave.textContent = 'Wave: ' + wave;
    this.el.goKills.textContent = 'Kills: ' + kills;
    try {
      const high = parseInt(localStorage.getItem('polyHordeHigh') || '0');
      if (score > high) {
        localStorage.setItem('polyHordeHigh', score.toString());
        this.el.goNewHigh.style.display = 'block';
      }
    } catch {}
  }

  update(score, kills, wave, player, enemyManager, dt) {
    // Dirty-check — hanya sentuh DOM saat berubah
    const s = String(score);
    if (s !== this._last.score) { this.el.scoreDisplay.textContent = 'SCORE: ' + s; this._last.score = s; }
    const w = 'WAVE ' + wave;
    if (w !== this._last.wave) { this.el.waveDisplay.textContent = w; this._last.wave = w; }
    const total = enemyManager.aliveEnemies.length + enemyManager.spawnQueue.length + (enemyManager._telegraphs?.length || 0);
    const ec = String(total);
    if (ec !== this._last.enemy) { this.el.enemyCount.textContent = 'Musuh: ' + ec; this._last.enemy = ec; }
    const hpPct = Math.max(0, (player.hp / player.maxHp) * 100);
    const hpKey = Math.ceil(hpPct) + ':' + Math.ceil(player.hp);
    if (hpKey !== this._last.hp) {
      this.el.healthFill.style.width = hpPct + '%';
      this.el.healthText.textContent = Math.ceil(player.hp) + ' HP';
      const col = hpPct > 50 ? '#4f4' : hpPct > 25 ? '#ff6' : '#f44';
      this.el.healthFill.style.background = col;
      this._last.hp = hpKey;
    }

    // Combo + FEVER jadi satu chip (dulu dua teks terpisah untuk satu sistem)
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 0; this.el.comboDisplay.style.opacity = 0; this._last.combo = ''; }
      else {
        const tier = this.game.comboTier || 0;
        const mul = tier >= 3 ? 'x3' : tier >= 2 ? 'x2' : tier >= 1 ? 'x1.5' : 'x1';
        const c = 'COMBO ' + this.combo + '  ' + mul;
        if (c !== this._last.combo) { this.el.comboDisplay.textContent = c; this._last.combo = c; }
        this.el.comboDisplay.style.opacity = 1;
      }
    } else if (this.el.comboDisplay.style.opacity !== '0') {
      this.el.comboDisplay.style.opacity = 0;
    }

    // Crosshair spread feedback
    const wdef = this.weaponSystem.current;
    this._fireBloom *= (1 - dt * 12);
    if (this._fireBloom < 0.001) this._fireBloom = 0;
    const spread = (wdef ? wdef.spread : 0.02) * 150 + this._fireBloom * 100;
    const gap = Math.round(6 + spread * 0.5);
    if (this._last.cross !== gap) {
      this.el.crosshair.style.setProperty('--gap', gap + 'px');
      this._last.cross = gap;
    }

    // Weapon slots
    for (let i = 0; i < this.weaponSlots.length; i++) {
      const isCurrent = i === this.weaponSystem.currentIndex;
      if ((this.weaponSlots[i].classList.contains('active') ? 1 : 0) !== (isCurrent ? 1 : 0)) {
        this.weaponSlots[i].classList.toggle('active', isCurrent);
      }
      const wd = this.weaponSystem.weapons[this.weaponSystem.weaponList[i]];
      const showReload = isCurrent && this.weaponSystem.isReloading;
      const txt = wd.ammo + '/' + wd.maxAmmo + (showReload ? ' RELOAD...' : '');
      if (txt !== this._last['ammo' + i]) {
        this._ammoEls[i].textContent = txt;
        this._last['ammo' + i] = txt;
      }
    }

    // Ability slots (entries di-cache — tanpa alokasi per frame)
    if (!this._abilityEntries) this._abilityEntries = Object.entries(this.abilitySlots);
    for (const [id, slot] of this._abilityEntries) {
      const state = this.abilitySystem.getAbilityState(id);
      const ready = state.ready;
      if ((slot.classList.contains('ready') ? 1 : 0) !== (ready ? 1 : 0)) {
        slot.classList.toggle('ready', ready);
        slot.classList.toggle('cooldown', !ready);
      }
      slot.classList.toggle('active', state.active);
      const names = { dash: 'DASH', shield: 'SHIELD', grenade: 'GRENADE' };
      const label = state.count !== undefined ? names[id] + ' (' + state.count + ')' : names[id];
      const txt = ready ? label : id.toUpperCase() + ' ' + Math.ceil(state.cd) + 's';
      if (txt !== this._last['ab_' + id]) {
        slot.innerHTML = ready
          ? '<span class="key-hint">' + (id === 'dash' ? 'Q' : id === 'shield' ? 'E' : 'F') + '</span> ' + label
          : txt;
        this._last['ab_' + id] = txt;
      }
    }

    // Damage flash
    if (this.damageFlashTimer > 0) this.damageFlashTimer -= dt;
    else this.el.damageOverlay.classList.remove('hit');

    // Damage arc fade
    if (this._damageArcT > 0) {
      this._damageArcT -= dt;
      if (this._damageArcT <= 0) this.el.damageArc?.classList.remove('show');
    }

    // FEVER combo tier — combo jadi sistem gameplay, bukan hanya pengali skor
    const combo = this.combo;
    const feverTier = combo >= 30 ? 3 : combo >= 15 ? 2 : combo >= 5 ? 1 : 0;
    if (feverTier !== (this._last.feverTier ?? 0)) {
      if (feverTier === 1) this.showHint('fever1', 'FEVER I — skor x1.5. Combo 15 = x2 + tembak cepat.');
      if (feverTier > 0 && this.el.fever) {
        const labels = ['', 'FEVER I', 'FEVER II', 'FURY'];
        this.el.fever.textContent = labels[feverTier];
        this.el.fever.className = 'fever tier' + feverTier;
        this.el.fever.style.opacity = 1;
      } else if (this.el.fever) {
        this.el.fever.style.opacity = 0;
      }
      this._last.feverTier = feverTier;
    }
    this.game.comboTier = feverTier;

    // Low HP pulse
    if (player.hp < player.maxHp * 0.25 && player.hp > 0) {
      const pulse = Math.sin(performance.now() / 300) * 0.3 + 0.3;
      this.el.damageOverlay.style.borderColor = 'rgba(255,0,0,' + pulse + ')';
      this.el.damageOverlay.style.borderWidth = '12px';
    } else if (!this.el.damageOverlay.classList.contains('hit')) {
      this.el.damageOverlay.style.borderColor = 'transparent';
      this.el.damageOverlay.style.borderWidth = '8px';
    }

    // Wave announcement fade
    if (this.waveAnnounceTimer > 0) {
      this.waveAnnounceTimer -= dt;
      if (this.waveAnnounceTimer <= 0) this.el.waveAnnounce.style.opacity = 0;
    }

    // Radar 10Hz
    this._updateRadar(dt, enemyManager, player);
  }
}
