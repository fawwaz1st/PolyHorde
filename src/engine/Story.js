// Story mode: JIT narrative (riset 2026) — lore diumpankan bertahap, bukan dump di awal.
// Intermission antar wave: briefing 1-2 kalimat + objective aktif di HUD.
import { Events } from './EventBus.js';

export const BRIEFINGS = {
  intro: [
    'Arena ini dulunya fasilitas penelitian polygonal.',
    'Setelah Protokol Kadaluarsa, semua penghuninya berubah — dan lapar.',
    'Kamu satu-satunya sinyal hidup di dalam perimeter. Kamu tahu apa yang harus dilakukan.'
  ],
  wave2: 'Mereka belajar. Sekarang ada yang menembak dari jauh — hancurkan sebelum sempat membidik.',
  wave4: 'Deteksi kelas berat. Perisainya tebal — peluru biasa cuma membuatnya marah. Roket atau pukul dari sisi.',
  wave6: 'Bip. Bip. Bip. Kamu sudah hafal suara itu. Bomber: jangan biarkan mendekat 1 meter.',
  wave10: 'Perimeter melemah. Gelombang tidak lagi punya batas — bertahan selama mungkin.',
  wave15: 'Log: ...reaktor masih menyala. Ada yang menjaga gelombang ini dari dalam.',
  wave20: 'Kamu bukan mangsa. Kamu adalah gangguan pada protokol mereka. Terus jadi gangguan.'
};

// Objective per fase — JIT narrative di HUD atas
export function objectiveFor(wave) {
  if (wave === 1) return 'Bertahan: waves pertama. Pelajari pola spawn (ring merah = musuh datang).';
  if (wave < 4) return 'Clear semua musuh. Kill dekat (< 8 m) menjatuhkan shard HP.';
  if (wave < 6) return 'Hati-hati heavy — charge-nya menyakitkan. Dash menghindar, shotgun mendorong.';
  if (wave < 10) return 'Bomber aktif. Dengarkan beep-nya makin cepat — bunuh dari jarak.';
  return 'Endless: setiap wave lebih tebal. FEVER x3 pada combo 30.';
}

export class Story {
  constructor(game) {
    this.game = game;
    this.shown = new Set();
    this.el = {
      narrative: document.getElementById('narrative'),
      text: document.getElementById('narrative-text'),
      objective: document.getElementById('objective')
    };
    this._queue = null;
    this._onAdvance = null;

    // Klik = advance narrative
    // Advance via klik overlay ATAU keyboard (Space/Enter) — robust di headless & pointer lock
    const adv = () => this._advance();
    this.el.narrative?.addEventListener('click', adv);
    document.addEventListener('keydown', (e) => {
      if ((e.code === 'Space' || e.code === 'Enter') && this.el.narrative?.classList.contains('show')) {
        e.preventDefault();
        adv();
      }
    });

    // Wave clear -> tampilkan briefing untuk wave berikutnya (intermission JIT)
    Events.on('wave-clear', () => {
      const next = this.game.wave + 1;
      this._maybeBrief(next);
    });
  }

  reset() {
    this.shown.clear();
    this._queue = null;
    this.el.narrative?.classList.remove('show');
    if (this.el.objective) this.el.objective.textContent = '';
  }

  // Dipanggil saat pointer lock hilang (ESC) — narrative tidak boleh override pause manual
  _isShowing() { return !!this._queue || (this.el.narrative?.classList.contains('show') ?? false); }

  // Briefing intro — dipanggil dari Game.start() sebelum wave 1
  playIntro() {
    if (this.shown.has('intro')) return;
    this.shown.add('intro');
    this._queue = BRIEFINGS.intro.slice();
    this._showNextLine();
  }

  _maybeBrief(wave) {
    const key = 'wave' + wave;
    if (BRIEFINGS[key] && !this.shown.has(key)) {
      this.shown.add(key);
      this._queue = [BRIEFINGS[key]];
      this._showNextLine();
    }
  }

  _showNextLine() {
    if (!this._queue || this._queue.length === 0) { this._advance(); return; }
    const line = this._queue.shift();
    if (this.el.text) this.el.text.textContent = line;
    if (this.el.narrative) this.el.narrative.classList.add('show');
    // Pause world saat narrative tampil — JIT narrative tidak boleh menutupi gameplay yang berjalan
    this.game.state = 3; // PAUSED
  }

  _advance() {
    if (this._queue && this._queue.length > 0) { this._showNextLine(); return; }
    this._queue = null;
    this.el.narrative?.classList.remove('show');
    // Resume world
    if (this.game.state === 3) this.game.state = 1; // PLAYING
    // Setelah narrative selesai: baris objective di HUD
    this.setObjective(objectiveFor(this.game.wave));
  }

  setObjective(text) {
    if (this.el.objective) this.el.objective.textContent = text;
  }
}
