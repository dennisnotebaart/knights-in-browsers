import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const server = await createServer({ root: process.cwd(), server: { port: 5193, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
const SS = '/tmp/claude-0/-home-user-knights-in-browsers/db3d8e22-af50-5594-b2f7-bd43bbc65f30/scratchpad/flow';
await page.goto('http://127.0.0.1:5193/'); await page.waitForTimeout(400);

// victory flow
await page.evaluate(() => window.__start('m1'));
await page.evaluate(() => { window.game.s.objectives = [{ type: 'survive', ticks: 30, text: 'Survive' }]; });
await page.click('#speed-btns button[data-speed="8"]');
await page.waitForTimeout(2500);
console.log('outcome visible: ' + await page.evaluate(() => !document.getElementById('outcome').classList.contains('hidden')) + ' title=' + await page.textContent('#outcome-title'));
await page.screenshot({ path: `${SS}-victory.png` });
console.log('progress: ' + await page.evaluate(() => localStorage.getItem('kib-progress-v1')));
await page.click('#btn-next'); await page.waitForTimeout(200);
console.log('next briefing: ' + await page.textContent('#briefing-title'));
// campaign list shows mission 2 unlocked + mission 1 done
await page.click('#briefing .back'); await page.waitForTimeout(200);
console.log('mission buttons: ' + await page.evaluate(() => [...document.querySelectorAll('#mission-list button')].map(b => b.className.trim() || 'open').join('|')));
// defeat flow
await page.evaluate(() => window.__start('m2'));
await page.evaluate(() => { const g = window.game; for (const h of g.s.houses) if (h.owner === 1 && (h.type === 'storehouse' || h.type === 'school')) g.destroyHouse(h, true); for (const u of g.s.units) if (u.owner === 1 && u.task.kind === 'soldier') g.killUnit(u); });
await page.click('#speed-btns button[data-speed="8"]');
await page.waitForTimeout(5000);
console.log('defeat visible: ' + await page.evaluate(() => !document.getElementById('outcome').classList.contains('hidden')) + ' title=' + await page.textContent('#outcome-title') + ' next hidden=' + await page.evaluate(() => document.getElementById('btn-next').classList.contains('hidden')));
await page.screenshot({ path: `${SS}-defeat.png` });
// retry
await page.click('#btn-retry'); await page.waitForTimeout(200); console.log('retry briefing: ' + await page.textContent('#briefing-title'));
// destroyOwner objective on m5
await page.evaluate(() => window.__start('m5'));
const before = await page.evaluate(() => window.game.objectiveProgress(window.game.s.objectives[0]));
await page.evaluate(() => { const g = window.game; for (const h of g.s.houses) if (h.owner === 2) g.destroyHouse(h, true); for (const u of g.s.units) if (u.owner === 2) g.killUnit(u); for (let i = 0; i < 60; i++) g.update(); });
console.log(`m5 objective before "${before}" -> outcome ${await page.evaluate(() => window.game.s.outcome)}`);
// load from main menu
await page.evaluate(() => window.__start('m3'));
await page.evaluate(() => { for (let i = 0; i < 500; i++) window.game.update(); });
await page.click('#tabs button[data-tab="menu"]'); await page.click('#tab-content button[data-act="save"]');
await page.click('#tab-content button[data-act="quit"]'); await page.waitForTimeout(200);
console.log('menu visible: ' + await page.evaluate(() => !document.getElementById('menu').classList.contains('hidden')));
await page.click('#btn-load'); await page.waitForTimeout(300);
console.log('loaded: mission=' + await page.evaluate(() => window.game.s.missionId + ' tick=' + window.game.s.tick + ' houses=' + window.game.s.houses.length + ' units=' + window.game.s.units.length));
// keep running loaded game for a while to ensure no errors after load
await page.click('#speed-btns button[data-speed="8"]'); await page.waitForTimeout(3000);
console.log('after load run tick=' + await page.evaluate(() => window.game.s.tick));
await page.screenshot({ path: `${SS}-loaded.png` });

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close(); await server.close();
