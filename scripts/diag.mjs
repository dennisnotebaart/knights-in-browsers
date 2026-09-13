import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const server = await createServer({ root: process.cwd(), server: { port: 5198, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5198/');
await page.waitForTimeout(400);
await page.evaluate(() => window.__start('m1'));
const r = await page.evaluate(() => {
  const g = window.game;
  const st = g.s.houses.find(h => h.type === 'storehouse');
  const sf = g.frontPos(st);
  const place = (type, x, y) => { const h = g.placeHouse(type, x, y, 1); const f = g.frontPos(h); let cx = f.x, cy = f.y; const placed = []; while (cy !== sf.y) { cy += Math.sign(sf.y - cy); placed.push(g.placePlan('road', cx, cy, 1)); } while (cx !== sf.x) { cx += Math.sign(sf.x - cx); placed.push(g.placePlan('road', cx, cy, 1)); } return { h, placed }; };
  const w = place('woodcutters', st.x - 2, st.y + 6);
  const s = place('sawmill', st.x + 1, st.y + 6);
  const info = [];
  for (let i = 0; i < 1200; i++) { g.update(); if (i % 200 === 0) info.push({ tick: g.s.tick, serfs: g.s.units.filter(u => u.type === 'serf').map(u => u.task.kind + (u.task.kind === 'deliver' ? `(${u.task.ware}->${u.task.to >= 0 ? g.house(u.task.to).type : 't' + u.task.tile} ph${u.task.phase} fails${u.pathFails})` : '') + `@${Math.round(u.x)},${Math.round(u.y)}`), labs: g.s.units.filter(u => u.type === 'laborer').map(u => u.task.kind + JSON.stringify(u.task)), cooldown: Object.keys(g.s.pairCooldown), wc: `${w.h.state} ${JSON.stringify(w.h.delivered)} inc ${JSON.stringify(w.h.incoming)}`, store: JSON.stringify(st.stock), tileIncoming: Object.keys(g.s.tileIncoming).length }); }
  // road check
  const d1 = g.doorPos(st), d2 = g.doorPos(w.h);
  const { findPath } = window.__map || {};
  return { placed: w.placed, sf, d1, d2, info, roadTiles: (() => { const out = []; for (let y = st.y; y < st.y + 12; y++) { let row = ''; for (let x = st.x - 4; x < st.x + 12; x++) { const i = y * g.map.w + x; row += g.doorTiles.has(i) ? 'D' : g.map.house[i] >= 0 ? '#' : g.map.obj[i] === 4 ? '=' : g.map.obj[i] === 10 ? (g.map.data[i] >= 20 ? 'p' : '.') : g.map.terrain[i] === 3 ? 'M' : g.map.terrain[i] === 1 ? '~' : ' '; } out.push(row); } return out; })() };
});
console.log(JSON.stringify(r, null, 1));
await browser.close(); await server.close();
