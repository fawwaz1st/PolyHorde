import { Game } from './game/Game.js';

const canvas = document.createElement('canvas');
document.body.prepend(canvas);

const game = new Game(canvas);
window.__game = game;

// Menu wiring
const playBtn = document.getElementById('play-btn');
const resumeBtn = document.getElementById('resume-btn');
const restartBtn = document.getElementById('restart-btn');
const goRestart = document.getElementById('go-restart');

function requestLock() {
  const p = document.body.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

playBtn?.addEventListener('click', () => {
  game.start();
  requestLock();
});
resumeBtn?.addEventListener('click', () => requestLock());
restartBtn?.addEventListener('click', () => { game.restart(); });
goRestart?.addEventListener('click', () => { game.restart(); requestLock(); });

// Pause overlay klik = resume (kecuali settings)
document.getElementById('pause')?.addEventListener('click', (e) => {
  if (e.target.closest('input, button, .settings')) return;
  requestLock();
});

// Settings persisten
const sens = document.getElementById('set-sens');
const vol = document.getElementById('set-vol');
const mute = document.getElementById('set-mute');
const reduced = document.getElementById('set-reduced');
let settings = { sens: 1, vol: 0.8, mute: false, reduced: false };
try {
  const s = JSON.parse(localStorage.getItem('polyHordeSettings') || 'null');
  if (s && typeof s === 'object') settings = { ...settings, ...s };
} catch {}
if (!localStorage.getItem('polyHordeSettings') && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) settings.reduced = true;
if (sens) sens.value = String(settings.sens);
if (vol) vol.value = String(settings.vol);
if (mute) mute.checked = !!settings.mute;
if (reduced) reduced.checked = !!settings.reduced;

function applySettings() {
  game.sensitivity = settings.sens;
  game.reducedMotion = settings.reduced;
  if (game.audio) { game.audio.setVolume(settings.vol); game.audio.setEnabled(!settings.mute); }
  if (game.music) game.music.bus.gain.value = settings.mute ? 0 : 0.4;
  document.body.classList.toggle('reduced-motion', settings.reduced);
  // Crosshair customization (aksesibilitas)
  const cross = document.getElementById('crosshair');
  if (cross) {
    const scale = parseFloat(document.getElementById('set-cross')?.value || '1');
    const color = document.getElementById('set-cross-color')?.value || '#fff';
    cross.style.fontSize = (scale * 10) + 'px';
    cross.querySelectorAll('span').forEach(s => { s.style.background = color; });
  }
}
function saveSettings() { try { localStorage.setItem('polyHordeSettings', JSON.stringify(settings)); } catch {} }

sens?.addEventListener('input', () => { settings.sens = parseFloat(sens.value); applySettings(); saveSettings(); });
vol?.addEventListener('input', () => { settings.vol = parseFloat(vol.value); applySettings(); saveSettings(); });
mute?.addEventListener('change', () => { settings.mute = mute.checked; applySettings(); saveSettings(); });
reduced?.addEventListener('change', () => { settings.reduced = reduced.checked; applySettings(); saveSettings(); });
document.getElementById('set-cross')?.addEventListener('input', applySettings);
document.getElementById('set-cross-color')?.addEventListener('change', applySettings);

// High score di menu
try {
  const high = parseInt(localStorage.getItem('polyHordeHigh') || '0');
  if (high > 0) {
    const el = document.getElementById('menu-high');
    if (el) { el.textContent = 'BEST ' + high.toLocaleString('id-ID'); el.style.display = 'block'; }
  }
} catch {}

// Init
game.init().then(() => {
  applySettings();
}).catch((e) => {
  console.error('Init gagal:', e);
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#07070f;color:#f87171;font:1rem sans-serif;z-index:9999;';
  el.textContent = 'Gagal memuat: ' + (e?.message || e);
  document.body.appendChild(el);
});
