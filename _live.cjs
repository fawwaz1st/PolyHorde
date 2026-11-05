
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + (e.stack || e.message).slice(0, 300)));
  page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url().slice(0, 120)));
  await page.goto('https://fawwaz1st.github.io/PolyHorde/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(6000);
  const state1 = await page.evaluate(() => ({
    hasCanvas: !!document.querySelector('canvas'),
    menuVisible: document.getElementById('menu')?.classList.contains('show'),
    title: document.title
  }));
  console.log('LIVE_STATE:', JSON.stringify(state1));
  await page.click('#play-btn');
  await page.waitForTimeout(2500);
  await page.keyboard.down('KeyW'); await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up(); await page.keyboard.up('KeyW');
  await page.waitForTimeout(2500);
  const state2 = await page.evaluate(() => ({
    hud: document.getElementById('hud')?.classList.contains('show'),
    wave: document.getElementById('wave')?.textContent,
    enemies: document.getElementById('enemies')?.textContent,
    hp: document.getElementById('health-text')?.textContent
  }));
  console.log('LIVE_GAME:', JSON.stringify(state2));
  console.log('ERRORS(' + errors.length + '):', errors.slice(0, 4).join(' | ') || '(none)');
  await browser.close(); process.exit(0);
})().catch(e => { console.error('FAIL:', e.message.slice(0, 400)); process.exit(1); });
