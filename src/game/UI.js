// UI: HUD diegetik (auto-fade di luar tempur), reticle reaktif, menu modern, settings
export class UI {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      menu: document.getElementById('menu'),
      pause: document.getElementById('pause'),
      gameover: document.getElementById('gameover'),
      healthFill: document.getElementById('health-fill'),
      healthText: document.getElementById('health-text'),
      ammo: document.getElementById('ammo'),
      weaponName: document.getElementById('weapon-name'),
      wave: document.getElementById('wave'),
      score: document.getElementById('score'),
      enemies: document.getElementById('enemies'),
      objective: document.getElementById('objective'),
      combo: document.getElementById('combo'),
      crosshair: document.getElementById('crosshair'),
      hitmarker: document.getElementById('hitmarker'),
      damageVignette: document.getElementById('damage-vignette'),
      radar: document.getElementById('radar'),
      announce: document.getElementById('announce'),
      hint: document.getElementById('hint'),
      bossBar: document.getElementById('boss-bar'),
      bossFill: document.getElementById('boss-fill'),
      abilities: document.getElementById('abilities'),
    };
    this._last = {};
    this._fadeT = 0;
    this._bloom = 0;
    this._hitT = 0;
    this._dmgDirT = 0;
    this._radarDots = [];
    for (let i = 0; i < 18; i++) {
      const d = document.createElement('div');
      d.className = 'radar-dot';
      d.style.opacity = '0';
      this.el.radar?.appendChild(d);
      this._radarDots.push(d);
    }
    this._radarBuf = [];
    for (let i = 0; i < 36; i++) this._radarBuf.push({ e: null, dx: 0, dz: 0, dist: 0 });
    this._hintT = null;
  }

  // --- Reticle reaktif ---
  setHitMarker(on) {
    this._hitT = on ? 0.18 : 0;
    this.el.hitmarker?.classList.toggle('show', on);
  }
  bumpBloom(v) { this._bloom = Math.min(this._bloom + v, 1); }

  hurtDirection(pos, playerPos, yaw) {
    const dx = pos.x - playerPos.x, dz = pos.z - playerPos.z;
    const ang = Math.atan2(-dx, -dz) - (-yaw) + Math.PI;
    const deg = -(ang * 180) / Math.PI;
    const arc = this.el.damageVignette;
    if (arc) {
      arc.style.setProperty('--dir', deg + 'deg');
      arc.classList.add('show');
      this._dmgDirT = 0.4;
    }
  }

  // Killfeed: daftar kill terbaru
  killfeed(text) {
    if (!this._feed) this._feed = [];
    this._feed.unshift(text);
    if (this._feed.length > 5) this._feed.pop();
    let el = document.getElementById('killfeed');
    if (!el) {
      el = document.createElement('div');
      el.id = 'killfeed';
      el.style.cssText = 'position:fixed;top:4rem;right:1.2rem;z-index:20;text-align:right;font-family:var(--mono);font-size:0.75rem;color:var(--dim);pointer-events:none';
      document.body.appendChild(el);
    }
    el.innerHTML = this._feed.map(f => '<div style="opacity:0.8">' + f + '</div>').join('');
  }

  showHint(text) {
    if (!this.el.hint) return;
    this.el.hint.textContent = text;
    this.el.hint.classList.add('show');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => this.el.hint.classList.remove('show'), 2600);
  }

  announce(text, sub = '', incoming = false) {
    if (!this.el.announce) return;
    this.el.announce.innerHTML = text + (sub ? '<div class="sub">' + sub + '</div>' : '');
    this.el.announce.classList.toggle('incoming', incoming);
    this.el.announce.style.opacity = '1';
    clearTimeout(this._annT);
    this._annT = setTimeout(() => { this.el.announce.style.opacity = '0'; }, incoming ? 3400 : 3000);
  }

  _cd(v, max) { return max > 0 ? Math.max(0, v) : 0; }
  setBoss(hp, max) {
    if (!this.el.bossBar) return;
    this.el.bossBar.style.display = hp > 0 ? 'block' : 'none';
    this.el.bossFill.style.width = Math.max(0, (hp / max) * 100) + '%';
  }

  update(dt, game) {
    const p = game.player;
    const e = game.enemies;

    // Health
    const hpPct = Math.max(0, p.hp / p.maxHp * 100);
    const hpKey = Math.ceil(hpPct) + ':' + Math.ceil(p.hp);
    if (hpKey !== this._last.hp) {
      this.el.healthFill.style.width = hpPct + '%';
      this.el.healthText.textContent = Math.ceil(p.hp);
      this.el.healthFill.style.background = hpPct > 50 ? '#4ade80' : hpPct > 25 ? '#facc15' : '#f87171';
      this._last.hp = hpKey;
    }

    // Ammo & weapon
    const w = game.weapons.current;
    const ammoTxt = w.ammo + ' / ' + w.mag;
    if (ammoTxt !== this._last.ammo) {
      this.el.ammo.textContent = ammoTxt;
      this.el.weaponName.textContent = w.name;
      this._last.ammo = ammoTxt;
    }

    // Wave & score
    const wv = 'WAVE ' + game.wave;
    if (wv !== this._last.wave) { this.el.wave.textContent = wv; this._last.wave = wv; }
    const sc = 'SCORE ' + game.score;
    if (sc !== this._last.score) { this.el.score.textContent = sc; this._last.score = sc; }
    const ec = String(e.list.length + (game.spawnQueue?.length || 0));
    if (ec !== this._last.ec) { this.el.enemies.textContent = ec; this._last.ec = ec; }

    // Combo
    if (game.combo > 0) {
      const txt = 'COMBO ' + game.combo + (game.comboTier >= 2 ? '  x2' : game.comboTier >= 1 ? '  x1.5' : '');
      if (txt !== this._last.combo) { this.el.combo.textContent = txt; this._last.combo = txt; }
      this.el.combo.style.opacity = '1';
    } else if (this._last.combo !== '') { this.el.combo.style.opacity = '0'; this._last.combo = ''; }

    // Crosshair spread (diegetik: gap via CSS var)
    this._bloom *= (1 - dt * 10);
    const spread = (w.spread || 0.02) * 120 + this._bloom * 80;
    const gap = Math.round(5 + spread * 0.5);
    if (gap !== this._last.gap) {
      this.el.crosshair?.style.setProperty('--gap', gap + 'px');
      this._last.gap = gap;
    }
    // Hitmarker fade
    if (this._hitT > 0) { this._hitT -= dt; if (this._hitT <= 0) this.el.hitmarker?.classList.remove('show'); }

    // Damage vignette fade
    if (this._dmgDirT > 0) { this._dmgDirT -= dt; if (this._dmgDirT <= 0) this.el.damageVignette?.classList.remove('show'); }

    // HUD auto-fade: sembunyikan elemen non-esensial saat tidak ada musuh dekat
    const nearEnemy = e.list.some(x => x.pos.distanceTo(p.position) < 18);
    this._fadeT = nearEnemy ? 2 : Math.max(0, this._fadeT - dt);
    const hudOp = this._fadeT > 0 ? 1 : 0.35;
    if (this.el.enemies) this.el.enemies.style.opacity = String(hudOp);

    // Radar 10Hz
    this._radarT = (this._radarT || 0) - dt;
    if (this._radarT <= 0) { this._radarT = 0.1; this._updateRadar(game); }

    // Boss bar
    const boss = game.enemies.list.find(e => e.type === 'boss');
    this.setBoss(boss ? boss.hp : 0, boss ? boss.maxHp : 1);

    // Ability cooldowns (diegetik di pojok kanan bawah)
    const dashCd = Math.max(0, game.player.dashCd);
    const shieldCd = Math.max(0, game.player.shieldCd);
    const abTxt = 'Q ' + dashCd.toFixed(0) + '  E ' + shieldCd.toFixed(0) + '  F ' + game.grenades;
    if (abTxt !== this._last.abTxt) { this.el.abilities.textContent = abTxt; this._last.abTxt = abTxt; }

    // Objective
    if (game.objective && game.objective !== this._last.obj) {
      this.el.objective.textContent = game.objective;
      this._last.obj = game.objective;
    }
  }

  _updateRadar(game) {
    const p = game.player;
    const sin = Math.sin(-p.yaw), cos = Math.cos(-p.yaw);
    let n = 0;
    const buf = this._radarBuf;
    for (let i = 0; i < game.enemies.list.length && n < 36; i++) {
      const e = game.enemies.list[i];
      const dx = e.pos.x - p.position.x, dz = e.pos.z - p.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 22) { const s = buf[n++]; s.dx = dx; s.dz = dz; s.dist = dist; s.e = e; }
    }
    // Seleksi 18 terdekat
    const count = n;
    for (let i = 0; i < Math.min(count, 18); i++) {
      let best = i;
      for (let j = i + 1; j < count; j++) if (buf[j].dist < buf[best].dist) best = j;
      if (best !== i) { const t = buf[i]; buf[i] = buf[best]; buf[best] = t; }
    }
    let di = 0;
    for (let i = 0; i < count && di < 18; i++) {
      const s = buf[i];
      const rx = s.dx * cos - s.dz * sin;
      const rz = s.dx * sin + s.dz * cos;
      const px = 50 + (rx / 22) * 46;
      const py = 50 + (rz / 22) * 46;
      const dot = this._radarDots[di++];
      dot.style.opacity = '0.9';
      dot.style.left = px + '%';
      dot.style.top = py + '%';
      dot.style.transform = 'translate(-50%,-50%)';
      const big = s.e.type === 'heavy' || s.e.type === 'boss';
      dot.style.width = dot.style.height = big ? '9px' : '6px';
      dot.style.background = s.e.type === 'bomber' ? '#4ade80' : s.e.type === 'boss' ? '#fbbf24' : s.e.type === 'heavy' ? '#c084fc' : '#f87171';
      dot.style.border = s.e.type === 'bomber' ? '2px solid #4ade80' : 'none';
      dot.style.borderRadius = s.e.type === 'bomber' ? '50%' : '2px';
    }
    // Telegraf
    for (let i = 0; i < (game.spawnQueue?.length || 0) && di < 18; i++) {
      const s = game.spawnQueue[i];
      const dx = s.x - p.position.x, dz = s.z - p.position.z;
      const rx = dx * cos - dz * sin, rz = dx * sin + dz * cos;
      const px = 50 + (rx / 22) * 46, py = 50 + (rz / 22) * 46;
      const dot = this._radarDots[di++];
      dot.style.opacity = '0.7';
      dot.style.left = px + '%'; dot.style.top = py + '%';
      dot.style.transform = 'translate(-50%,-50%)';
      dot.style.width = dot.style.height = '6px';
      dot.style.background = '#fb923c';
      dot.style.border = 'none'; dot.style.borderRadius = '50%';
    }
    for (; di < 18; di++) this._radarDots[di].style.opacity = '0';
  }

  // --- Menu / pause / gameover ---
  showHUD() { this.el.hud?.classList.add('show'); }
  hideHUD() { this.el.hud?.classList.remove('show'); }
  showMenu() { this.el.menu?.classList.add('show'); }
  hideMenu() { this.el.menu?.classList.remove('show'); }
  showPause() { this.el.pause?.classList.add('show'); }
  hidePause() { this.el.pause?.classList.remove('show'); }
  showDraft(cards, onPick) {
    const el = document.getElementById('draft');
    if (!el) { onPick(cards[0]); return; }
    el.querySelector('.cards').innerHTML = '';
    for (const c of cards) {
      const btn = document.createElement('button');
      btn.className = 'card';
      btn.innerHTML = '<div class="card-name">' + c.name + '</div><div class="card-desc">' + c.desc + '</div>';
      btn.addEventListener('click', () => { el.classList.remove('show'); onPick(c); });
      el.querySelector('.cards').appendChild(btn);
    }
    el.classList.add('show');
  }

  showGameOver(score, wave, kills, high) {
    this.el.gameover?.classList.add('show');
    document.getElementById('go-score').textContent = 'Score ' + score;
    document.getElementById('go-wave').textContent = 'Wave ' + wave;
    document.getElementById('go-kills').textContent = 'Kills ' + kills;
    document.getElementById('go-high').style.display = high ? 'block' : 'none';
  }
  hideGameOver() { this.el.gameover?.classList.remove('show'); }
};
