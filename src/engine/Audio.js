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

  // Cache buffer noise unit (zero-alloc: 1 AudioBuffer per durasi, gain via node)
  // Riset 2026: createBuffer per tembakan = GC churn di mid-combat
  _noise(duration, gain = 0.3) {
    const key = Math.round(duration * 1000);
    if (!this._noiseCache) this._noiseCache = new Map();
    let buf = this._noiseCache.get(key);
    if (!buf) {
      const sr = this.ctx.sampleRate;
      const len = Math.max(1, Math.floor(sr * duration));
      buf = this.ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      const decay = sr * duration * 0.3;
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / decay);
      }
      this._noiseCache.set(key, buf);
    }
    // Envelope & gain diterapkan via GainNode — buffer tetap reusable
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration * 0.55);
    g.connect(this._out());
    return { buffer: buf, gainNode: g };
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
    // Disconnect setelah selesai -> cegah leak node (dulu node menumpuk tak terbatas)
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch {} };
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
    const n = this._noise(0.04, 0.5);
    const src = this.ctx.createBufferSource();
    src.buffer = n.buffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1200;
    src.connect(hp).connect(n.gainNode);
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
    const n = this._noise(0.05, 0.2);
    const src = this.ctx.createBufferSource();
    src.buffer = n.buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, t);
    src.connect(filter).connect(n.gainNode);
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

  // Beep bomber accelerando — makin dekat makin cepat (keterbacaan ancaman, riset 2026)
  playBomberBeep(dist) {
    if (!this.enabled) return;
    this._ensureResumed();
    const t = this.ctx.currentTime;
    const urgency = Math.max(0, Math.min(1, 1 - dist / 12));
    this._tone('square', 1400, 1400, t, 0.05, 0.03 + urgency * 0.05);
  }

  // Tick telegraf spawn (ring membesar di lantai)
  playSpawnTick() {
    if (!this.enabled) return;
    this._ensureResumed();
    this._tone('sine', 620, 940, this.ctx.currentTime, 0.07, 0.04);
  }

  // Pickup health shard
  playPickup() {
    if (!this.enabled) return;
    this._ensureResumed();
    const t = this.ctx.currentTime;
    this._tone('sine', 700, 1400, t, 0.12, 0.08);
    this._tone('sine', 1400, 2100, t + 0.06, 0.1, 0.05);
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
    const n = this._noise(0.35, 0.45);
    const src = this.ctx.createBufferSource();
    src.buffer = n.buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(50, t + 0.3);
    src.connect(filter).connect(n.gainNode);
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

// ============================================================================
// Procedural adaptive music (riset 2026): zero-asset, Web Audio API synth.
// Dua layer: calm (pad + arpeggio) dan combat (bass + drum), crossfade by intensity.
// ============================================================================
export class Music {
  constructor(ctx) {
    this.ctx = ctx;
    this.enabled = !!ctx;
    if (!this.enabled) return;

    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    this.calmGain = ctx.createGain();
    this.calmGain.gain.value = 1;
    this.combatGain = ctx.createGain();
    this.combatGain.gain.value = 0;
    this.calmGain.connect(this.master);
    this.combatGain.connect(this.master);

    this.calmFilter = ctx.createBiquadFilter();
    this.calmFilter.type = 'lowpass';
    this.calmFilter.frequency.value = 1400;
    this.calmFilter.connect(this.calmGain);

    this.scale = [220, 261.63, 293.66, 329.63, 392.00, 440, 523.25, 587.33, 659.25, 783.99];

    this.intensity = 0;
    this._targetIntensity = 0;
    this._nextNoteTime = 0;
    this._bar = 0;
    this._scheduler = null;
    this._running = false;
    this._noiseCache = new Map();
  }

  setIntensity(v) {
    this._targetIntensity = Math.max(0, Math.min(1, v));
  }

  start() {
    if (!this.enabled || this._running) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this._running = true;
    const ctx = this.ctx;
    this._nextNoteTime = ctx.currentTime + 0.1;
    this._scheduler = setInterval(() => this._schedule(), 100);
  }

  stop() {
    this._running = false;
    if (this._scheduler) { clearInterval(this._scheduler); this._scheduler = null; }
  }

  _updateGains() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.intensity += (this._targetIntensity - this.intensity) * 0.08;
    const i = this.intensity;
    this.calmGain.gain.setTargetAtTime(1 - i * 0.6, t, 0.25);
    this.combatGain.gain.setTargetAtTime(i, t, 0.25);
    this.calmFilter.frequency.setTargetAtTime(900 + (1 - i) * 900, t, 0.3);
  }

  _schedule() {
    if (!this._running) return;
    this._updateGains();
    const ctx = this.ctx;
    const lookahead = 0.25;
    while (this._nextNoteTime < ctx.currentTime + lookahead) {
      this._playBar(this._nextNoteTime);
      this._nextNoteTime += 0.5;
      this._bar++;
    }
  }

  _playBar(t0) {
    const i = this.intensity;
    const scale = this.scale;
    const root = scale[0];

    // Calm pad: chord lambat
    for (const off of [0, 4, 7]) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = root * Math.pow(2, off / 12);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.48);
      osc.connect(g).connect(this.calmFilter);
      osc.start(t0); osc.stop(t0 + 0.5);
      osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch {} };
    }

    // Calm arpeggio
    if (Math.random() < 0.7 - i * 0.5) {
      const note = scale[Math.floor(Math.random() * 5)];
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = note;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.connect(g).connect(this.calmGain);
      osc.start(t0); osc.stop(t0 + 0.25);
      osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch {} };
    }

    // Combat bass
    if (i > 0.15) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = root / 2;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12 * i, t0 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 400 + i * 600;
      osc.connect(lp).connect(g).connect(this.combatGain);
      osc.start(t0); osc.stop(t0 + 0.5);
      osc.onended = () => { try { osc.disconnect(); g.disconnect(); lp.disconnect(); } catch {} };
    }

    // Combat drum
    if (i > 0.25) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, t0);
      osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.12);
      g.gain.setValueAtTime(0.22 * i, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      osc.connect(g).connect(this.combatGain);
      osc.start(t0); osc.stop(t0 + 0.18);
      osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch {} };

      if (i > 0.5) {
        const n = this._noiseBuffer(0.05);
        const src = this.ctx.createBufferSource();
        src.buffer = n;
        const g2 = this.ctx.createGain();
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 6000;
        g2.gain.setValueAtTime(0.05 * i, t0 + 0.25);
        g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
        src.connect(hp).connect(g2).connect(this.combatGain);
        src.start(t0 + 0.25); src.stop(t0 + 0.3);
        src.onended = () => { try { src.disconnect(); g2.disconnect(); hp.disconnect(); } catch {} };
      }
    }
  }

  _noiseBuffer(dur) {
    const key = Math.round(dur * 1000);
    let buf = this._noiseCache.get(key);
    if (!buf) {
      const sr = this.ctx.sampleRate;
      const len = Math.max(1, Math.floor(sr * dur));
      buf = this.ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      this._noiseCache.set(key, buf);
    }
    return buf;
  }
}
