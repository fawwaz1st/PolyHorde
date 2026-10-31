// Procedural SFX via Web Audio API — no external assets
// 2026 juice research: layered hit audio (crunch + armor-ping + kill confirmation tick)
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Master bus: compressor mencegah clipping saat hujan SFX bertumpuk
      this._master = this.ctx.createGain();
      this._master.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      this._master.connect(comp).connect(this.ctx.destination);
    } catch {
      this.enabled = false;
    }
  }

  _ensureResumed() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  // Route: semua node ke master bus (bukan destination langsung)
  _out() { return this._master ?? this.ctx.destination; }

  // Short percussive noise burst
  _noise(duration, gain = 0.3) {
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * duration));
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * gain * Math.exp(-i / (sr * duration * 0.3));
    }
    return buf;
  }

  _tone(type, f0, f1, t0, dur, gain, dest) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(dest ?? this._out());
    osc.start(t0);
    osc.stop(t0 + dur);
    return osc;
  }

  playShoot() {
    if (!this.enabled) return;
    this._ensureResumed();
    const t = this.ctx.currentTime;
    this._tone('sawtooth', 800, 200, t, 0.08, 0.15);
    // Layer 2: transient punch
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(0.04, 0.5);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1200;
    src.connect(hp).connect(this._out());
    src.start(t);
  }

  playReload() {
    if (!this.enabled) return;
    this._ensureResumed();
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      this._tone('square', 300 + i * 100, 300 + i * 100, t + i * 0.15, 0.05, 0.08);
    }
  }

  // Layered hit: wet crunch (noise) + armor-ping (metallic ping) — riset 2026
  playHit() {
    if (!this.enabled) return;
    this._ensureResumed();
    const t = this.ctx.currentTime;
    // Crunch layer
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(0.05, 0.2);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, t);
    src.connect(filter).connect(this._out());
    src.start(t);
    // Armor-ping layer: metallic ringing partials
    this._tone('triangle', 2400 + Math.random() * 600, 1800, t, 0.09, 0.045);
  }

  // Kill confirmation: crisp high tick — research: confirm kill di atas keramaian visual
  playKillTick() {
    if (!this.enabled) return;
    this._ensureResumed();
    const t = this.ctx.currentTime;
    this._tone('square', 1900, 2600, t, 0.05, 0.05);
  }

  // Distant growl — tension-release loop: sinyal wave incoming (riset 2026)
  playWaveGrowl() {
    if (!this.enabled) return;
    this._ensureResumed();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(55, t);
    osc.frequency.linearRampToValueAtTime(38, t + 1.4);
    lfo.frequency.value = 7;
    lfoGain.gain.value = 9;
    lfo.connect(lfoGain).connect(osc.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 240;
    osc.connect(lp).connect(g).connect(this._out());
    osc.start(t); lfo.start(t);
    osc.stop(t + 1.6); lfo.stop(t + 1.6);
    // Radar blip di atasnya
    for (let i = 0; i < 3; i++) {
      this._tone('sine', 880, 880, t + 0.15 + i * 0.4, 0.08, 0.035);
    }
  }

  // Catharsis: chord naik saat wave clear
  playWaveClear() {
    if (!this.enabled) return;
    this._ensureResumed();
    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5-E5-G5
    for (let i = 0; i < notes.length; i++) {
      this._tone('triangle', notes[i], notes[i], t + i * 0.07, 0.45, 0.07);
    }
  }

  playDeath() {
    if (!this.enabled) return;
    this._ensureResumed();
    this._tone('sawtooth', 400, 40, this.ctx.currentTime, 0.5, 0.25);
  }

  playExplosion() {
    if (!this.enabled) return;
    this._ensureResumed();
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(0.35, 0.45);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(50, t + 0.3);
    src.connect(filter).connect(this._out());
    src.start(t);
    // Sub thump
    this._tone('sine', 120, 30, t, 0.25, 0.3);
  }

  playDash() {
    if (!this.enabled) return;
    this._ensureResumed();
    this._tone('sine', 200, 800, this.ctx.currentTime, 0.2, 0.12);
  }

  playShield() {
    if (!this.enabled) return;
    this._ensureResumed();
    this._tone('sine', 400, 1200, this.ctx.currentTime, 0.3, 0.1);
  }

  playPlayerHit() {
    if (!this.enabled) return;
    this._ensureResumed();
    this._tone('sine', 200, 60, this.ctx.currentTime, 0.2, 0.15);
  }
}
