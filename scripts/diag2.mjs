import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const server = await createServer({ root: process.cwd(), server: { port: 5197, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5197/'); await page.waitForTimeout(400);
await page.evaluate(() => window.__start('m1'));
const r = await page.evaluate(() => {
  const g = window.game, { findPath } = window.__dev;
  const st = g.s.houses.find(h => h.type === 'storehouse'); const sf = g.frontPos(st);
  const roadTo = (from) => { const pass = (x, y) => { const i = y * g.map.w + x; const o = g.map.obj[i], t = g.map.terrain[i]; if (t === 1 || t === 3) return false; if (g.map.house[i] >= 0) return g.doorTiles.has(i); return o === 0 || o === 4 || o === 10 || o === 14 || o === 3; }; const p = findPath(g.map, from.x, from.y, sf.x, sf.y, pass, 20000); for (const pt of [from, ...p]) { const i = pt.y * g.map.w + pt.x; if (g.map.obj[i] === 4 || g.map.house[i] >= 0) continue; g.placePlan('road', pt.x, pt.y, 1); } };
  const q = g.placeHouse('quarry', st.x + 20, st.y + 1, 1); roadTo(g.frontPos(q));
  for (let i = 0; i < 3000; i++) g.update();
  const d1 = g.doorPos(st), d2 = g.doorPos(q);
  const p = findPath(g.map, d1.x, d1.y, d2.x, d2.y, g.roadWalkable, 3000);
  const rows = []; for (let y = st.y - 1; y < st.y + 8; y++) { let row = ''; for (let x = st.x - 2; x < st.x + 26; x++) { const i = y * g.map.w + x; const o = g.map.obj[i]; row += g.doorTiles.has(i) ? 'D' : g.map.house[i] >= 0 ? '#' : o === 4 ? '=' : o === 10 ? (g.map.data[i] >= 21 ? 'P' : g.map.data[i] >= 20 ? 'p' : '.') : o === 1 ? 'T' : g.map.terrain[i] === 3 ? 'M' : g.map.terrain[i] === 1 ? '~' : ' '; } rows.push(row); }
  return { path: p ? p.length : null, rows, cooldown: g.s.pairCooldown, q: { state: q.state, delivered: q.delivered, incoming: q.incoming }, store: st.stock, serfs: g.s.units.filter(u => u.type === 'serf').map(u => u.task.kind + '@' + Math.round(u.x) + ',' + Math.round(u.y) + ' fails' + u.pathFails) };
});
console.log(JSON.stringify(r, null, 1));
await browser.close(); await server.close();
