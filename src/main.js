import { Game } from './engine/Game.js';

let game;

function init() {
  try {
    game = new Game();
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
      try { document.body.requestPointerLock(); } catch (err) { console.warn(err); }
    });
    document.getElementById('pause-restart')?.addEventListener('click', () => {
      game?.restart();
    });

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

