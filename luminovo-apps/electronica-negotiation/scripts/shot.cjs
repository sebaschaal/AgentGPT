// node scripts/shot.cjs <out-prefix> [actions...]  — screenshots the local preview
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || 'shot';
  const actions = process.argv.slice(3);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto('http://localhost:5174/');
  const frame = () => page.frames().find((f) => f.url().includes('5173'));
  await page.waitForTimeout(4500);
  let i = 0;
  for (const a of actions) {
    const [kind, arg] = a.split('=');
    const f = frame();
    if (kind === 'click') await f.click(arg, { timeout: 5000 }).catch((e) => errors.push('CLICK ' + arg + ' ' + e.message.split('\n')[0]));
    if (kind === 'wait') await page.waitForTimeout(Number(arg));
    if (kind === 'shot') await page.screenshot({ path: `${out}-${arg || i++}.png`, fullPage: true });
  }
  if (!actions.some((a) => a.startsWith('shot'))) await page.screenshot({ path: `${out}.png`, fullPage: true });
  console.log(JSON.stringify(errors.slice(0, 20), null, 1));
  await browser.close();
})();
