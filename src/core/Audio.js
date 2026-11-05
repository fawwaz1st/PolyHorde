// Audio: SFX prosedural berlapis + musik adaptif + panning stereo.
// Semua node di-disconnect saat selesai (anti leak). Zero aset.
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.25;
      this.master.connect(comp).connect(this.ctx.destination);
    } catch { this.enabled = false; }

    this._noise = new Map();
    this._listenerPos = { x: 0, y: 0, z: 0 };
    this._listenerYaw = 0;
  }

  _out() { return this.master ?? this.ctx.destination; }
  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = this.enabled ? v : 0; }
  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.value = on ? this.volume : 0; }

  updateListener(pos, yaw) {
    this._listenerPos.x = pos.x; this._listenerPos.y = pos.y; this._listenerPos.z = pos.z;
    this._listenerYaw = yaw;
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) { l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z; }
    else if (l.setPosition) l.setPosition(pos.x, pos.y, pos.z);
    if (l.forwardX) { l.forwardX.value = -Math.sin(yaw); l.forwardY.value = 0; l.forwardZ.value = -Math.cos(yaw); }
    else if (l.setOrientation) l.setOrientation(-Math.sin(yaw), 0, -Math.cos(yaw), 0, 1, 0);
  }

  // Panning stereo dari posisi dunia relatif yaw pemain
  _pan(pos) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = 0;
    if (pos) {
      const dx = pos.x - this._listenerPos.x;
      const dz = pos.z - this._listenerPos.z;
      const rx = Math.cos(this._listenerYaw);
      const rz = -Math.sin(this._listenerYaw);
      const len = Math.hypot(dx, dz) || 1;
      p.pan.value = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / len));
    }
    p.connect(this._out());
    return p;
  }

  _noiseBuf(dur) {
    const k = Math.round(dur * 1000);
    if (!this._noise.has(k)) {
      const sr = this.ctx.sampleRate;
      const len = Math.max(1, Math.floor(sr * dur));
      const buf = this.ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const decay = sr * dur * 0.3;
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / decay);
      this._noise.set(k, buf);
    }
    return this._noise.get(k);
  }

  _tone(type, f0, f1, t0, dur, gain, dest) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(dest ?? this._out());
    o.start(t0); o.stop(t0 + dur);
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch {} };
  }

  _burst(dur, gain, filterType, f0, f1, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf(dur);
    const flt = this.ctx.createBiquadFilter();
    flt.type = filterType;
    flt.frequency.setValueAtTime(f0, this.ctx.currentTime);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, this.ctx.currentTime + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    src.connect(flt).connect(g).connect(dest ?? this._out());
    src.start(); src.stop(this.ctx.currentTime + dur);
    src.onended = () => { try { src.disconnect(); flt.disconnect(); g.disconnect(); } catch {} };
  }

  // --- SFX ---
  shoot(kind) {
    if (!this.enabled) return; this.resume();
    const t = this.ctx.currentTime;
    if (kind === 'shotgun') { this._burst(0.12, 0.4, 'lowpass', 1200, 200); this._tone('square', 180, 60, t, 0.12, 0.25); }
    else if (kind === 'rocket') { this._burst(0.25, 0.3, 'lowpass', 600, 100); this._tone('sawtooth', 300, 80, t, 0.3, 0.2); }
    else if (kind === 'pistol') { this._tone('sawtooth', 900, 300, t, 0.08, 0.18); this._burst(0.04, 0.25, 'highpass', 1500); }
    else { this._tone('sawtooth', 700, 250, t, 0.06, 0.12); this._burst(0.03, 0.2, 'highpass', 1800); }
  }

  hit(pos) {
    if (!this.enabled) return; this.resume();
    const p = this._pan(pos);
    const t = this.ctx.currentTime;
    this._burst(0.05, 0.18, 'lowpass', 2200, 800, p);
    this._tone('triangle', 2400, 1600, t, 0.08, 0.04, p);
    p.onended?.();
  }

  kill(pos) {
    if (!this.enabled) return; this.resume();
    const p = this._pan(pos);
    this._tone('square', 1800, 2600, this.ctx.currentTime, 0.06, 0.07, p);
  }

  explosion(pos, big = false) {
    if (!this.enabled) return; this.resume();
    const p = this._pan(pos);
    const t = this.ctx.currentTime;
    this._burst(big ? 0.5 : 0.3, big ? 0.5 : 0.35, 'lowpass', 800, 50, p);
    this._tone('sine', 110, 30, t, 0.3, 0.3, p);
  }

  playerHurt(pos) {
    if (!this.enabled) return; this.resume();
    const p = this._pan(pos);
    this._tone('sine', 220, 70, this.ctx.currentTime, 0.2, 0.2, p);
  }

  dash() { if (!this.enabled) return; this.resume(); this._tone('sine', 250, 900, this.ctx.currentTime, 0.2, 0.12); }
  shield() { if (!this.enabled) return; this.resume(); this._tone('sine', 400, 1400, this.ctx.currentTime, 0.3, 0.1); }
  pickup() { if (!this.enabled) return; this.resume(); const t = this.ctx.currentTime; this._tone('sine', 700, 1400, t, 0.1, 0.07); this._tone('sine', 1400, 2100, t + 0.06, 0.09, 0.05); }
  reload() { if (!this.enabled) return; this.resume(); const t = this.ctx.currentTime; for (let i = 0; i < 3; i++) this._tone('square', 320 + i * 120, 320 + i * 120, t + i * 0.12, 0.05, 0.06); }
  beep(urgency) { if (!this.enabled) return; this.resume(); this._tone('square', 1500, 1500, this.ctx.currentTime, 0.05, 0.04 + urgency * 0.06); }
  spawnTick() { if (!this.enabled) return; this.resume(); this._tone('sine', 500, 800, this.ctx.currentTime, 0.06, 0.035); }
  waveClear() {
    if (!this.enabled) return; this.resume();
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this._tone('triangle', f, f, t + i * 0.08, 0.5, 0.08));
  }
  lowHp() { if (!this.enabled) return; this.resume(); const t = this.ctx.currentTime; this._tone('sine', 90, 60, t, 0.1, 0.09); this._tone('sine', 90, 60, t + 0.2, 0.1, 0.07); }
  gameOver() { if (!this.enabled) return; this.resume(); this._tone('sawtooth', 400, 40, this.ctx.currentTime, 0.8, 0.25); }
}

// --- Musik adaptif: layer calm + combat, crossfade by intensity ---
export class Music {
  constructor(audio) {
    this.audio = audio;
    this.ctx = audio.ctx;
    this.enabled = !!this.ctx;
    if (!this.enabled) return;
    this.bus = this.ctx.createGain();
    this.bus.gain.value = 0.4;
    this.bus.connect(audio.master);
    this.calm = this.ctx.createGain(); this.calm.gain.value = 1;
    this.combat = this.ctx.createGain(); this.combat.gain.value = 0;
    this.calm.connect(this.bus); this.combat.connect(this.bus);
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass'; this.filter.frequency.value = 1400;
    this.filter.connect(this.calm);
    this.scale = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3, 784];
    this.intensity = 0; this._target = 0;
    this._next = 0; this._bar = 0; this._running = false; this._timer = null;
  }
  setIntensity(v) { this._target = Math.max(0, Math.min(1, v)); }
  start() {
    if (!this.enabled || this._running) return;
    this.audio.resume();
    this._running = true;
    this._next = this.ctx.currentTime + 0.1;
    this._timer = setInterval(() => this._tick(), 100);
  }
  stop() { this._running = false; if (this._timer) { clearInterval(this._timer); this._timer = null; } }
  _tick() {
    if (!this._running) return;
    const t = this.ctx.currentTime;
    this.intensity += (this._target - this.intensity) * 0.08;
    const i = this.intensity;
    this.calm.gain.setTargetAtTime(1 - i * 0.65, t, 0.25);
    this.combat.gain.setTargetAtTime(i, t, 0.25);
    this.filter.frequency.setTargetAtTime(900 + (1 - i) * 900, t, 0.3);
    if (this._next < t - 0.05) this._next = t;
    while (this._next < t + 0.25) { this._bar0(this._next); this._next += 0.5; this._bar++; }
  }
  _bar0(t) {
    const i = this.intensity, root = this.scale[0];
    // calm pad
    for (const off of [0, 4, 7]) this.audio._tone('sine', root * Math.pow(2, off / 12), root * Math.pow(2, off / 12), t, 0.5, 0.05, this.filter);
    // calm arp
    if (Math.random() < 0.7 - i * 0.5) this.audio._tone('triangle', this.scale[(Math.random() * 5) | 0], this.scale[(Math.random() * 5) | 0], t, 0.2, 0.06, this.calm);
    // combat bass
    if (i > 0.15) this.audio._tone('sawtooth', root / 2, root / 2, t, 0.45, 0.1 * i, this.combat);
    // drums
    if (i > 0.25) {
      this.audio._tone('sine', 110, 40, t, 0.15, 0.2 * i, this.combat);
      if (i > 0.5) this.audio._burst(0.04, 0.04 * i, 'highpass', 6000, null, this.combat);
    }
  }
}
