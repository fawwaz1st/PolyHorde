# PolyHorde

Browser FPS arena shooter: wave-based enemy hordes dalam arena polygonal. Three.js (WebGPURenderer, auto-fallback ke WebGL2) + Vite, ES modules, pointer lock.

```bash
npm install
npm run dev      # port 5173, browser auto-open
npm run build
```

## Struktur `src/`

| Folder | Isi |
|---|---|
| `engine/` | `Game.js` (state machine MENU/PLAYING/GAME_OVER, FOV punch, hit-stop, pacing wave), `Input.js`, `Audio.js` (SFX prosedural berlapis), `EventBus.js` |
| `player/` | `Player.js` — capsule physics, dash, shield, recoil |
| `world/` | `Arena.js` — radius 18, wall height 6, 32 segmen, `Octree` collision |
| `weapons/` | `WeaponSystem.js` — 4 senjata (pistol/AR/shotgun/roket), hitscan zero-alloc |
| `abilities/` | `AbilitySystem.js` — dash (trail kontinu), shield, grenade (pool) |
| `enemies/` | `EnemyManager.js` — 4 tipe musuh, geometry/material cache, SpatialHash separation, `waveSize()` |
| `systems/` | `Particles.js` (pool 5000), `ShakeController.js`, `SpatialHash.js` (queryInto zero-alloc), `CelOutline.js` |
| `ui/` | `HUD.js` — radar taktis 10Hz, dirty-check DOM, pool score popup |

## Fitur juice & performa (pass 2026)

Hasil riset best-practice 2026 (Three.js WebGPU/TSL, game-feel horde shooter, zero-allocation game loop):

- **Zero-allocation game loop** — RAF callback pre-bound, `meshList` persisten untuk hitscan (tanpa `.map()` per tembakan), geometry/musuh & pool grenade/roket/proyekil di-cache, HUD dirty-check, tanpa `setTimeout` di hot path.
- **Layered hit audio** — crunch + armor-ping + kill confirmation tick; compressor di master bus.
- **Tension-release pacing** — warning "WAVE N INCOMING" + growl & radar blip 3.5 detik sebelum spawn, catharsis slow-mo (hit-stop 0.45s) + chord saat wave clear.
- **FOV punch** — kick saat tembak roket/ledakan/dash, decay balik ke base FOV.
- **Hit-stop** — mikro-pause pada kill dan ledakan berat.
- **Radar taktis** — blip posisi musuh relatif pemain (10 Hz, pool dot DOM).
- **Enemy separation** — SpatialHash mencegah musuh bertumpuk.

High score tersimpan di `localStorage` (`polyHordeHigh`).
