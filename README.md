# PolyHorde

Arena FPS horde wave di browser. Low-poly, tanpa aset eksternal — semua mesh dan SFX dibuat prosedural saat runtime. Dibangun di Three.js r185 (WebGPURenderer, fallback WebGL2 otomatis) + Vite, total satu dependensi runtime.

Play: `npm install && npm run dev` — buka http://localhost:5173, klik untuk pointer lock.

## Kontrol

WASD gerak, mouse lihat, klik kiri tembak. 1–4 / scroll ganti senjata, R reload, Q dash, E shield, F grenade, Space lompat, ESC pause.

## Yang ada di dalam

- 4 senjata dengan peran beda: pistol presisi (30 dmg, spread tipis), AR penyapu (100 DPS), shotgun dengan knockback besar, roket AoE dengan self-damage 35%.
- 4 tipe musuh: grunt, shooter, heavy (charge attack), bomber (pemicu <1,2 m + beep makin cepat). HP musuh naik 12%/wave, komposisi berubah tiap wave.
- Ekonomi health Quake-style: kill dalam radius 8 m menjatuhkan shard HP yang termagnet ke pemain — berhenti mundur, masuk ke dalam horde.
- Spawn ditelegraf ring 0,8 detik dan tidak pernah muncul di depan mata pemain (min 10 m, di luar kerucut pandang).
- FEVER: combo 5/15/30 kill memberi multiplier skor x1,5/x2/x3.
- Radar taktis 10 Hz (sort jarak), indikator arah serangan, hit-stop, FOV punch, slow-mo saat wave clear.
- SFX Web Audio prosedural berlapis (crunch + armor-ping + kill tick), compressor di master bus.

## Performa

Loop game zero-allocation: pool objek untuk proyektil/partikel/popup, SpatialHash dengan integer key, material musuh Lambert dengan geometry di-cache, shadow map 1024. Chunk terpisah: app ~61 kB + three 782 kB (gzip 214 kB). Diuji headless Chrome: klik → tembak → dash → switch senjata, 0 error.

High score disimpan di localStorage (`polyHordeHigh`).

## Yang baru (overhaul 2026)

- **Bloom post-processing TSL** (RenderPipeline + BloomNode) — emisi neon/tracer/proyektil menyala, threshold 0.72 agar material tetap crisp.
- **Musik prosedural adaptif** (Web Audio API, zero aset) — layer calm (pad + arpeggio) crossfade ke layer combat (bass + drum) berdasarkan kepadatan musuh & tekanan HP.
- **Story mode JIT narrative** — briefing 1-2 kalimat antar wave + objective aktif di HUD atas, tanpa dump teks di awal.
- **AI cover & flanking** — shooter swing wide ke flank, cover seek saat pemain menembak, obstacle avoidance; musuh beranimasi prosedural (idle sway, scale lunge).
- **Precision**: headshot/weak-point multiplier, knockback per senjata (shotgun 1.5 m, rocket 0.6 m).

## Struktur

`src/engine/` game state, input, audio, event bus · `src/player/` kapsul fisika · `src/enemies/` AI + shard + telegraph · `src/weapons/` · `src/abilities/` · `src/systems/` partikel, hash, outline · `src/ui/` HUD + radar · `index.html` menu/HUD markup.