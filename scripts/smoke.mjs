import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const server = await createServer({ root: process.cwd(), server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message + '\n' + (e.stack || '')));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push('CONSOLE ' + m.text()); });
await page.goto('http://127.0.0.1:5199/');
await page.waitForTimeout(500);
const out = process.argv[2] || 'scratch';
const mission = process.argv[3] || 'm1';
const ticks = Number(process.argv[4] || 9000);
await page.evaluate(id => window.__start(id), mission);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}-0.png` });
const report = await page.evaluate(async ({ mission, ticks }) => {
  const g = window.game, ui = window.ui, { findPath } = window.__dev;
  const log = [];
  const st = g.s.houses.find(h => h.type === 'storehouse');
  const sf = g.frontPos(st);
  const roadTo = (from) => { const pass = (x, y) => { const i = y * g.map.w + x; const o = g.map.obj[i], t = g.map.terrain[i]; if (t === 1 || t === 3) return false; if (g.map.house[i] >= 0) return g.doorTiles.has(i); return o === 0 || o === 4 || o === 10 || o === 14 || o === 3; }; const p = findPath(g.map, from.x, from.y, sf.x, sf.y, pass, 20000); if (!p) { log.push('no road path from ' + JSON.stringify(from)); return; } for (const pt of [from, ...p]) { const i = pt.y * g.map.w + pt.x; if (g.map.obj[i] === 4 || g.map.house[i] >= 0) continue; g.placePlan('road', pt.x, pt.y, 1); } };
  const place = (type, x, y) => { const r = g.canPlaceHouse(type, x, y, 1); if (r) { log.push(`cannot place ${type} at ${x},${y}: ${r}`); return null; } const h = g.placeHouse(type, x, y, 1); roadTo(g.frontPos(h)); return h; };
  const school = g.s.houses.find(h => h.type === 'school');
  if (mission === 'm1') {
    place('inn', st.x + 9, st.y + 1);
    place('woodcutters', st.x - 2, st.y + 6);
    place('sawmill', st.x + 1, st.y + 6);
    place('quarry', st.x + 20, st.y + 1);
    place('farm', st.x + 5, st.y + 9);
    for (let y = st.y + 12; y < st.y + 15; y++) for (let x = st.x + 5; x < st.x + 11; x++) g.placePlan('field', x, y, 1);
    for (const t of ['woodcutter', 'carpenter', 'stonemason', 'farmer', 'serf', 'laborer']) g.schoolTrain(school, t);
  }
  const t0 = performance.now();
  const snap = () => ({ tick: g.s.tick, houses: g.s.houses.filter(h => h.owner === 1).map(h => `${h.type}:${h.state}${h.state==='building'?`(${h.progress},w${h.delivered.wood}/s${h.delivered.stone})`:''}${h.workerId>=0?'*':''}`).join(' '), units: g.s.units.filter(u=>!u.dead && u.owner===1).length, produced: JSON.stringify(g.s.stats.produced), store: JSON.stringify(st.stock), msgs: g.s.messages.slice(-3).map(m=>m.text) });
  const snaps = [];
  for (let i = 0; i < ticks; i++) { g.update(); if (i % 1500 === 0) snaps.push(snap()); if (g.s.outcome !== 'playing') break; }
  snaps.push(snap());
  const ms = performance.now() - t0;
  const tasks = {}; for (const u of g.s.units) { if (u.dead) continue; const k = u.owner + ':' + u.type + ':' + u.task.kind; tasks[k] = (tasks[k] || 0) + 1; }
  const hungry = g.s.units.filter(u => !u.dead && u.owner === 1 && u.condition < 0.3).length;
  return { log, snaps, ms, tasks, hungry, objectives: g.s.objectives.map(o => o.text + ' ' + g.objectiveProgress(o) + (g.objectiveDone(o) ? ' DONE' : '')), outcome: g.s.outcome, cooldown: Object.keys(g.s.pairCooldown) };
}, { mission, ticks });
console.log(JSON.stringify(report, null, 1));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}-1.png` });
await page.evaluate(() => { const g = window.game, ui = window.ui, r = window.renderer; const st = g.s.houses[0]; r.centerOn(st.x + 8, st.y + 6); ui.sel = { house: g.s.houses.find(h => h.type === 'sawmill') || st, units: [], groups: [] }; ui.renderInfo(true); });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}-2.png` });
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close(); await server.close();
