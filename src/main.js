import './style.css';
import { Game } from './engine/Game.js';

let game;

function init() {
  try {
    game = new Game();
    const blocker = document.getElementById('blocker');
    game.setBlocker(blocker);

    // Single click handler on blocker — use pointer lock on document body
    blocker.addEventListener('click', () => {
      try {
        document.body.requestPointerLock();
      } catch (e) {
        console.warn('Pointer lock request failed:', e);
      }
    });

    // Pointer lock change — start game
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

// Wait for DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

