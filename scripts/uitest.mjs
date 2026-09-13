import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const server = await createServer({ root: process.cwd(), server: { port: 5195, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
const SS = '/tmp/claude-0/-home-user-knights-in-browsers/db3d8e22-af50-5594-b2f7-bd43bbc65f30/scratchpad/ui';
await page.goto('http://127.0.0.1:5195/'); await page.waitForTimeout(400);
await page.screenshot({ path: `${SS}-menu.png` });
// menu -> campaign -> mission 1 -> briefing -> start
await page.click('#btn-campaign'); await page.waitForTimeout(200);
await page.screenshot({ path: `${SS}-missions.png` });
await page.click('#mission-list button'); await page.waitForTimeout(200);
await page.screenshot({ path: `${SS}-briefing.png` });
await page.click('#btn-start'); await page.waitForTimeout(500);
const log = [];
// pause so the scene is static
await page.keyboard.press(' ');
// screen position of a tile
const tileToScreen = (tx, ty) => page.evaluate(([tx, ty]) => { const r = window.renderer; const c = r.canvas.getBoundingClientRect(); return { x: c.left + (tx * 32 + 16 - r.cam.x) * r.zoom, y: c.top + (ty * 32 + 16 - r.cam.y) * r.zoom }; }, [tx, ty]);
// 1. place an inn through the build panel
await page.click('button[data-house="inn"]');
let st = await page.evaluate(() => { const s = window.game.s.houses[0]; return { x: s.x, y: s.y }; });
let p = await tileToScreen(st.x + 10, st.y + 1);
await page.mouse.move(p.x, p.y); await page.waitForTimeout(50);
await page.screenshot({ path: `${SS}-ghost.png` });
await page.mouse.click(p.x, p.y);
log.push('houses after inn click: ' + await page.evaluate(() => window.game.s.houses.map(h => h.type).join(',')));
// 2. draw a road by dragging
await page.click('button[data-tool="road"]');
const a = await tileToScreen(st.x + 4, st.y + 3), b = await tileToScreen(st.x + 12, st.y + 3);
await page.mouse.move(a.x, a.y); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y); await page.waitForTimeout(10); } await page.mouse.up();
log.push('road plans: ' + await page.evaluate(() => { let n = 0; for (const o of window.game.map.obj) if (o === 10) n++; return n; }));
await page.keyboard.press('Escape');
// 3. click a unit to select it
const u = await page.evaluate(() => { const u = window.game.s.units.find(u => u.type === 'serf'); return { x: u.x, y: u.y, id: u.id }; });
p = await tileToScreen(u.x, u.y);
await page.mouse.click(p.x, p.y); await page.waitForTimeout(100);
log.push('selected units: ' + await page.evaluate(() => window.ui.sel.units.map(u => u.type).join(',')));
log.push('info panel: ' + (await page.textContent('#info')).replace(/\s+/g, ' ').slice(0, 80));
// 4. click the school and queue a serf
const sc = await page.evaluate(() => { const h = window.game.s.houses.find(h => h.type === 'school'); return { x: h.x + 1, y: h.y }; });
p = await tileToScreen(sc.x, sc.y); await page.mouse.click(p.x, p.y); await page.waitForTimeout(100);
await page.click('#info button[data-act="train"][data-unit="serf"]');
log.push('school queue: ' + await page.evaluate(() => window.game.s.houses.find(h => h.type === 'school').queue.join(',')));
await page.screenshot({ path: `${SS}-school.png` });
// 5. stats & menu tabs, save, load
await page.click('#tabs button[data-tab="stats"]'); await page.waitForTimeout(100); await page.screenshot({ path: `${SS}-stats.png` });
await page.click('#tabs button[data-tab="menu"]'); await page.waitForTimeout(100);
await page.click('#tab-content button[data-act="save"]'); await page.waitForTimeout(100);
log.push('saved bytes: ' + await page.evaluate(() => (localStorage.getItem('kib-save-v1') || '').length));
// run a bit, then load and compare tick
await page.keyboard.press(' '); await page.waitForTimeout(700); await page.keyboard.press(' ');
const tickBefore = await page.evaluate(() => window.game.s.tick);
await page.click('#tab-content button[data-act="load"]'); await page.waitForTimeout(300);
log.push(`tick before load ${tickBefore}, after load ${await page.evaluate(() => window.game.s.tick)}`);
// 6. skirmish: drag select soldiers, right click move, attack enemy
await page.evaluate(() => window.__start('m2')); await page.waitForTimeout(300);
await page.keyboard.press(' ');
const sol = await page.evaluate(() => { const us = window.game.s.units.filter(u => u.task.kind === 'soldier' && u.owner === 1); const xs = us.map(u => u.x), ys = us.map(u => u.y); return { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, x1: Math.max(...xs) + 1, y1: Math.max(...ys) + 1, n: us.length }; });
await page.evaluate(([x, y]) => window.renderer.centerOn(x, y), [(sol.x0 + sol.x1) / 2, (sol.y0 + sol.y1) / 2]);
const s0 = await tileToScreen(sol.x0, sol.y0), s1 = await tileToScreen(sol.x1, sol.y1);
await page.mouse.move(s0.x, s0.y); await page.mouse.down(); await page.mouse.move(s1.x, s1.y, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(100);
log.push(`drag-selected ${await page.evaluate(() => window.ui.sel.units.length)} of ${sol.n} soldiers, groups ${await page.evaluate(() => window.ui.sel.groups.length)}`);
const mv = await tileToScreen(sol.x1 + 4, sol.y1 + 2);
await page.mouse.click(mv.x, mv.y, { button: 'right' }); await page.waitForTimeout(50);
log.push('group order: ' + await page.evaluate(() => window.game.s.groups.filter(g => g.owner === 1).map(g => g.order + '->' + JSON.stringify(g.dest)).join(' ')));
await page.screenshot({ path: `${SS}-army.png` });
await page.click('#info button[data-act="split"]'); await page.waitForTimeout(50);
log.push('groups after split: ' + await page.evaluate(() => window.game.s.groups.filter(g => g.owner === 1).map(g => g.units.length).join(',')));
// run 500 ticks unpaused at 8x to see units move
await page.click('#speed-btns button[data-speed="8"]'); await page.waitForTimeout(1500);
log.push('tick now: ' + await page.evaluate(() => window.game.s.tick));
await page.screenshot({ path: `${SS}-army2.png` });
// 7. barracks panel in m4
await page.evaluate(() => window.__start('m4')); await page.waitForTimeout(300); await page.keyboard.press(' ');
await page.evaluate(() => { for (let i = 0; i < 600; i++) window.game.update(); });
const br = await page.evaluate(() => { const h = window.game.s.houses.find(h => h.type === 'barracks'); window.renderer.centerOn(h.x, h.y); return { x: h.x + 1, y: h.y + 1, rec: h.recruits.length, stock: h.stock }; });
p = await tileToScreen(br.x, br.y); await page.mouse.click(p.x, p.y); await page.waitForTimeout(100);
log.push('barracks recruits ' + br.rec + ' stock ' + JSON.stringify(br.stock));
const canEquip = await page.$('#info button[data-act="equip"][data-unit="axeFighter"]:not([disabled])');
if (canEquip) { await canEquip.click(); log.push('equipped axe fighter; soldiers: ' + await page.evaluate(() => window.game.s.units.filter(u => u.owner === 1 && u.task.kind === 'soldier').length)); } else log.push('axe fighter button disabled');
await page.screenshot({ path: `${SS}-barracks.png` });
// storehouse panel
const sh = await page.evaluate(() => { const h = window.game.s.houses[0]; window.renderer.centerOn(h.x, h.y); return { x: h.x + 1, y: h.y + 1 }; });
p = await tileToScreen(sh.x, sh.y); await page.mouse.click(p.x, p.y); await page.waitForTimeout(100);
await page.click('#info .ware[data-ware="wood"]'); log.push('store wood blocked: ' + await page.evaluate(() => !!window.game.s.houses[0].blocked.wood));
await page.screenshot({ path: `${SS}-store.png` });
// zoom
await page.mouse.move(700, 400); await page.mouse.wheel(0, -100); await page.waitForTimeout(100); log.push('zoom: ' + await page.evaluate(() => window.renderer.zoom));
await page.screenshot({ path: `${SS}-zoom.png` });
console.log(log.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close(); await server.close();
