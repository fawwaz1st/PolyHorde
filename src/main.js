import { Game } from './engine/Game.js';

let game;

function init() {
  try {
    game = new Game();
    window.__game = game; // exposed for debugging/testing
    const blocker = document.getElementById('blocker');
    game.setBlocker(blocker);

    // High score dari run terakhir — tampil di menu (localStorage)
    try {
      const high = parseInt(localStorage.getItem('polyHordeHigh') || '0');
      if (high > 0) {
        const el = document.getElementById('menu-high');
        if (el) { el.textContent = 'BEST: ' + high.toLocaleString('id-ID'); el.style.display = 'block'; }
      }
    } catch {}

    // Single click handler on blocker — use pointer lock on document body
    blocker.addEventListener('click', () => {
      try {
        document.body.requestPointerLock();
      } catch (e) {
        console.warn('Pointer lock request failed:', e);
        showLockWarn();
      }
    });

    // Pointer lock change — start game
    document.addEventListener('pointerlockerror', showLockWarn);
    document.addEventListener('pointerlockchange', () => {
      try {
        if (document.pointerLockElement && game && game.state === 0) {
          game.start();
        }
      } catch (e) {
        console.error('Start error:', e);
      }
    });

    // Pause overlay: klik untuk resume (pointer lock kembali -> onPointerLock resume state)
    const pauseEl = document.getElementById('pause-overlay');
    pauseEl?.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'pause-restart') return; // tombol restart ditangani sendiri
      if (e.target && (e.target.id === 'set-sens' || e.target.id === 'set-music' || e.target.id === 'set-mute' || e.target.id === 'set-reduced')) return;
      try { document.body.requestPointerLock(); } catch (err) { console.warn(err); }
    });
    document.getElementById('pause-restart')?.addEventListener('click', () => {
      game?.restart();
    });

    // Settings: sensitivitas, volume musik, mute, reduced motion
    const sensEl = document.getElementById('set-sens');
    const musicEl = document.getElementById('set-music');
    const muteEl = document.getElementById('set-mute');
    const reducedEl = document.getElementById('set-reduced');
    sensEl?.addEventListener('input', () => { if (game) game.sensitivity = parseFloat(sensEl.value); });
    musicEl?.addEventListener('input', () => { if (game && game.music) game.music.master.gain.value = parseFloat(musicEl.value); });
    muteEl?.addEventListener('change', () => { if (game && game.audio) game.audio.enabled = !muteEl.checked; if (game && game.music) game.music.master.gain.value = muteEl.checked ? 0 : parseFloat(musicEl.value); });
    reducedEl?.addEventListener('change', () => { document.body.classList.toggle('reduced-motion', reducedEl.checked); if (game) game.reducedMotion = reducedEl.checked; });

  } catch (e) {
    console.error('Game init failed:', e);
  }
}

function showLockWarn() {
  const el = document.getElementById('lock-warn');
  if (el) el.style.display = 'block';
}

// Wait for DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

