
const { chromium } = require('playwright-core');
const http = require('http');
const fsr = require('fs');
const path = require('path');
(async () => {
  const root = path.join(process.cwd(), 'dist');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = http.createServer((req, res) => {
    let p = req.url.split('?')[0].replace(/^\/PolyHorde/, '') || '/';
    if (p === '/') p = '/index.html';
    try { const data = fsr.readFileSync(path.join(root, p)); res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(data); }
    catch { res.writeHead(404); res.end('nf'); }
  });
  await new Promise(r => server.listen(8983, r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)));
  await page.goto('http://127.0.0.1:8983/PolyHorde/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'docs/v4-menu.png' });
  await page.click('#play-btn');
  await page.waitForTimeout(2000);
  // spawn musuh dekat untuk shot yang bagus
  await page.evaluate(() => {
    const g = window.__game;
    g.enemies.reset();
    g.spawnQueue = [];
    g._waveIncoming = false;
    g._startWave(2);
  });
  await page.keyboard.down('KeyW'); await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up(); await page.keyboard.up('KeyW');
  await page.evaluate(() => { const g = window.__game; g.player.yaw = 0.5; g.player.pitch = -0.05; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'docs/v4-gameplay.png' });
  console.log('ERRORS(' + errors.length + '):', errors.slice(0, 3).join(' | ') || '(none)');
  await browser.close(); server.close(); process.exit(0);
})().catch(e => { console.error('FAIL:', e.message.slice(0, 300)); process.exit(1); });
