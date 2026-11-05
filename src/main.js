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
      const p = document.body.requestPointerLock();
      // requestPointerLock() mengembalikan Promise (browser modern) — tangkap rejection
      if (p && typeof p.catch === 'function') p.catch((e) => {
        console.warn('Pointer lock rejected:', e);
        showLockWarn();
      });
      else { try { p; } catch (e) { showLockWarn(); } }
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
      // Jangan resume bila klik pada elemen settings/label (bug: klik label memicu lock)
      if (e.target && (e.target.closest('#pause-overlay label, #pause-overlay input, #pause-restart'))) return;
      const p = document.body.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch((err) => { console.warn(err); showLockWarn(); });
    });
    document.getElementById('pause-restart')?.addEventListener('click', () => {
      game?.restart();
    });

    // Settings: sensitivitas, volume musik, mute, reduced motion — PERSISTEN via localStorage
    const sensEl = document.getElementById('set-sens');
    const musicEl = document.getElementById('set-music');
    const muteEl = document.getElementById('set-mute');
    const reducedEl = document.getElementById('set-reduced');
    let settings = { sens: 1, music: 0.55, mute: false, reduced: false };
    try {
      const saved = JSON.parse(localStorage.getItem('polyHordeSettings') || 'null');
      if (saved && typeof saved === 'object') settings = { ...settings, ...saved };
    } catch {}
    // prefers-reduced-motion OS -> default reduced
    if (!localStorage.getItem('polyHordeSettings') && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settings.reduced = true;
    }
    if (sensEl) sensEl.value = String(settings.sens);
    if (musicEl) musicEl.value = String(settings.music);
    if (muteEl) muteEl.checked = !!settings.mute;
    if (reducedEl) reducedEl.checked = !!settings.reduced;
    const applySettings = () => {
      if (!game) return;
      game.sensitivity = settings.sens;
      game.reducedMotion = settings.reduced;
      if (game.music) game.music.master.gain.value = settings.mute ? 0 : settings.music;
      if (game.audio) game.audio.enabled = !settings.mute;
      document.body.classList.toggle('reduced-motion', settings.reduced);
    };
    const saveSettings = () => {
      try { localStorage.setItem('polyHordeSettings', JSON.stringify(settings)); } catch {}
    };
    sensEl?.addEventListener('input', () => { settings.sens = parseFloat(sensEl.value); applySettings(); saveSettings(); });
    musicEl?.addEventListener('input', () => { settings.music = parseFloat(musicEl.value); applySettings(); saveSettings(); });
    muteEl?.addEventListener('change', () => { settings.mute = muteEl.checked; applySettings(); saveSettings(); });
    reducedEl?.addEventListener('change', () => { settings.reduced = reducedEl.checked; applySettings(); saveSettings(); });
    // Terapkan settings tersimpan segera
    applySettings();
    // Tombol Settings di menu utama
    const menuSettingsBtn = document.getElementById('menu-settings');
    menuSettingsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (game) { game.state = 3; game.hud.showPause(); }
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

