import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const server = await createServer({ root: process.cwd(), server: { port: 5196, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
await page.goto('http://127.0.0.1:5196/'); await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
const ticks = Number(process.argv[2] || 20000);
for (const id of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'skirmish']) {
  await page.evaluate(id => window.__start(id), id);
  await page.waitForTimeout(100);
  const r = await page.evaluate(({ ticks }) => {
    const g = window.game; const t0 = performance.now();
    let n = 0; for (; n < ticks; n++) { g.update(); if (g.s.outcome !== 'playing') break; }
    const ms = performance.now() - t0;
    const alive = o => g.s.units.filter(u => !u.dead && u.owner === o).length;
    const soldiers = o => g.s.units.filter(u => !u.dead && u.owner === o && u.task.kind === 'soldier').length;
    const houses = o => g.s.houses.filter(h => h.owner === o && h.state !== 'destroyed').length;
    return { ticks: n, ms: Math.round(ms), outcome: g.s.outcome, waves: g.s.wavesDone + '/' + g.s.waves.length, p: { units: alive(1), soldiers: soldiers(1), houses: houses(1) }, e2: { units: alive(2), soldiers: soldiers(2), houses: houses(2) }, e3: { units: alive(3), soldiers: soldiers(3), houses: houses(3) }, killed: g.s.stats.killed, lost: g.s.stats.lost, msgs: g.s.messages.slice(-4).map(m => m.text), produced: g.s.stats.produced };
  }, { ticks });
  console.log(id, JSON.stringify(r));
  await page.screenshot({ path: `/tmp/claude-0/-home-user-knights-in-browsers/db3d8e22-af50-5594-b2f7-bd43bbc65f30/scratchpad/all-${id}.png` });
}
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close(); await server.close();
