// ---- Entry point: menus, game loop, save/load ----
import { Game } from './game/sim';
import { generateMap, createMap, findPath } from './game/map';
import type { MapData } from './game/map';
import { buildSprites, TILE } from './game/sprites';
import { loadAssets } from './game/assets';
import type { Assets } from './game/assets';
import type { Sprites } from './game/sprites';
import { Renderer } from './game/renderer';
import { UI } from './game/ui';
import { Audio } from './game/audio';
import { MISSIONS, missionById } from './game/missions';
import type { Mission } from './game/missions';
import type { GameState } from './game/state';
import { TICKS_PER_SEC } from './game/defs';

const $ = (id: string) => document.getElementById(id)!;
const SAVE_KEY = 'kib-save-v1', AUTO_KEY = 'kib-autosave-v1', PROGRESS_KEY = 'kib-progress-v1';
const AUTOSAVE_MS = 30000;
let lastAutosave = 0;

let sprites: Sprites;
let assets: Assets;
const audio = new Audio();
(window as any).__audioEnabled = true;
(window as any).__toggleAudio = () => { audio.enabled = !audio.enabled; (window as any).__audioEnabled = audio.enabled; };
(window as any).__musicEnabled = true;
(window as any).__toggleMusic = () => { audio.musicOn = !audio.musicOn; (window as any).__musicEnabled = audio.musicOn; };

let game: Game | null = null;
let renderer: Renderer | null = null;
let ui: UI | null = null;
let mission: Mission | null = null;
let raf = 0;
let acc = 0, lastT = 0;
let outcomeShown = false;
let outcomeFrames = 0;

function show(id: string) {
  for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
  $('game').classList.add('hidden');
  $(id).classList.remove('hidden');
  if (id === 'menu') refreshContinue();
}

// ---------- progress ----------
function progress(): { done: string[] } { try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{"done":[]}'); } catch { return { done: [] }; } }
function markDone(id: string) { const p = progress(); if (!p.done.includes(id)) p.done.push(id); localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); }

// ---------- state creation ----------
function createState(m: Mission): GameState {
  const map = generateMap(m.map);
  return {
    tick: 0, map, houses: [], units: [], groups: [], projectiles: [], fx: [], messages: [], nextId: 1, player: 1,
    stats: { produced: {}, trained: {}, killed: 0, lost: 0 }, tileIncoming: {}, outcome: 'playing', outcomeTick: 0,
    missionId: m.id, objectives: m.objectives.map(o => ({ ...o })), waves: m.waves.map(w => ({ ...w })), wavesDone: 0, aiTimers: {}, pairCooldown: {},
    playerHasPlacedHouse: false, hints: [...m.hints], freePlay: false,
  };
}

function startMission(m: Mission, state?: GameState) {
  mission = m;
  const s = state ?? createState(m);
  game = new Game(s);
  if (!state) { m.setup(game); game.rebuildIndexes(); game.dirtyTiles.length = 0; for (const u of game.s.units) u.condition = u.task.kind === 'soldier' ? 0.85 + Math.random() * 0.15 : 0.6 + Math.random() * 0.4; }
  game.updateFog();
  game.onSound = n => audio.play(n);
  game.onMessage = msg => { if (msg.kind === 'alert') audio.play('alarm'); else if (msg.kind === 'good') audio.play('message'); };
  const canvas = $('c') as HTMLCanvasElement;
  if (!renderer) renderer = new Renderer(canvas, game, sprites, assets); else renderer.setGame(game);
  if (!ui) { ui = new UI(game, renderer, sprites); ui.onSave = saveGame; ui.onLoad = loadGame; ui.onQuit = () => { autosave(); stopLoop(); audio.stopMusic(); show('menu'); }; ui.onNext = () => { const n = nextMission(); if (n) { autosave(); stopLoop(); audio.stopMusic(); showBriefing(n); } }; ui.hasNext = () => !!nextMission(); } else ui.setGame(game);
  ui.setSpeed(1); ui.setTab('build');
  outcomeShown = false; outcomeFrames = 0;
  show('game');
  resize();
  renderer.centerOn(m.camera.x, m.camera.y);
  if (!state) { game.msg(`Mission: ${m.name}. ${m.objectives[0]?.text ?? ''}`, 'info'); }
  startLoop();
  audio.startMusic();
  (window as any).game = game; (window as any).ui = ui; (window as any).renderer = renderer;
}

function resize() {
  const c = $('c') as HTMLCanvasElement;
  const v = $('view');
  c.width = v.clientWidth; c.height = v.clientHeight;
  renderer?.clampCam();
}
window.addEventListener('resize', resize);

// ---------- loop ----------
function startLoop() { stopLoop(); lastT = performance.now(); acc = 0; raf = requestAnimationFrame(frame); }
function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
function frame(t: number) {
  raf = requestAnimationFrame(frame);
  if (!game || !renderer || !ui) return;
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  ui.update(dt);
  if (!ui.paused && game.s.outcome === 'playing') {
    acc += dt * ui.speed;
    const step = 1 / TICKS_PER_SEC;
    let n = 0;
    while (acc >= step && n < 40) { game.update(); acc -= step; n++; }
    if (n >= 40) acc = 0;
  }
  renderer.render(ui.sel, ui.place, ui.showTerritory);
  if (game.s.outcome === 'playing' && t - lastAutosave > AUTOSAVE_MS) autosave();
  if (game.s.outcome !== 'playing' && !outcomeShown && ++outcomeFrames > 75) { outcomeShown = true; showOutcome(); }
}

function showOutcome() {
  if (!game || !mission) return;
  const won = game.s.outcome === 'won';
  audio.play(won ? 'victory' : 'defeat');
  ($('outcome-art') as HTMLImageElement).src = won ? 'art/victory.jpg' : 'art/defeat.jpg';
  $('outcome-title').textContent = won ? 'Victory!' : 'Defeat';
  const min = Math.floor(game.s.tick / 600);
  $('outcome-text').textContent = won
    ? `${mission.name} is complete after ${min} minutes. Enemies slain: ${game.s.stats.killed}. Our losses: ${game.s.stats.lost}.`
    : `The settlement has fallen after ${min} minutes. Enemies slain: ${game.s.stats.killed}. Our losses: ${game.s.stats.lost}.`;
  if (won && mission.campaign) markDone(mission.id);
  try { localStorage.removeItem(AUTO_KEY); } catch { /* ignore */ }
  const idx = MISSIONS.indexOf(mission);
  const next = won && mission.campaign && idx + 1 < MISSIONS.length && MISSIONS[idx + 1].campaign ? MISSIONS[idx + 1] : null;
  $('btn-next').classList.toggle('hidden', !next);
  $('btn-next').onclick = () => { if (next) showBriefing(next); };
  $('btn-keep').classList.toggle('hidden', !won);
  $('btn-keep').onclick = keepPlaying;
  $('btn-retry').onclick = () => { if (mission) showBriefing(mission); };
  stopLoop();
  audio.stopMusic();
  show('outcome');
}

/** After a victory: keep the settlement running with no further objectives. */
function keepPlaying() {
  if (!game || !mission) return;
  game.s.outcome = 'playing'; game.s.freePlay = true;
  outcomeShown = false; outcomeFrames = 0;
  show('game'); resize();
  startLoop(); audio.startMusic();
  lastAutosave = performance.now();
  game.msg('Mission complete. Keep building for as long as you like; the next mission waits in the Menu tab.', 'good');
}
function nextMission(): Mission | null {
  if (!mission || !mission.campaign) return null;
  const i = MISSIONS.indexOf(mission);
  return i + 1 < MISSIONS.length && MISSIONS[i + 1].campaign ? MISSIONS[i + 1] : null;
}

// ---------- save / load ----------
function serialize(s: GameState): string {
  const m = s.map;
  const map = { w: m.w, h: m.h, terrain: Array.from(m.terrain), obj: Array.from(m.obj), data: Array.from(m.data), house: Array.from(m.house), owner: Array.from(m.owner), fog: Array.from(m.fog) };
  return JSON.stringify({ ...s, map, groups: s.groups.map(g => ({ ...g, facing: (g as any).facing })) });
}
function deserialize(json: string): GameState {
  const o = JSON.parse(json);
  const map: MapData = createMap(o.map.w, o.map.h);
  map.terrain.set(o.map.terrain); map.obj.set(o.map.obj); map.data.set(o.map.data); map.house.set(o.map.house); map.owner.set(o.map.owner);
  if (o.map.fog) map.fog.set(o.map.fog); else map.fog.fill(1); // saves from before fog of war
  return { ...o, map };
}
function autosave() {
  if (!game || game.s.outcome !== 'playing') return;
  lastAutosave = performance.now();
  try {
    localStorage.setItem(AUTO_KEY, serialize(game.s));
    const n = $('autosave-note'); n.textContent = 'Autosaved'; n.classList.remove('hidden'); setTimeout(() => n.classList.add('hidden'), 1800);
  } catch (e) { console.warn('autosave failed', e); }
}
function autosaveInfo(): { mission: string; minutes: number } | null {
  try {
    const json = localStorage.getItem(AUTO_KEY); if (!json) return null;
    const o = JSON.parse(json); const m = missionById(o.missionId);
    return { mission: m ? m.name : o.missionId, minutes: Math.floor((o.tick ?? 0) / 600) };
  } catch { return null; }
}
function continueGame() {
  const json = localStorage.getItem(AUTO_KEY);
  if (!json) return false;
  try { const s = deserialize(json); startMission(missionById(s.missionId), s); lastAutosave = performance.now(); game?.msg('Resumed from autosave.', 'good'); return true; }
  catch (e) { console.error(e); return false; }
}
// keep progress when the tab is closed, refreshed or hidden
window.addEventListener('pagehide', () => autosave());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosave(); });

function saveGame() {
  if (!game) return;
  try { localStorage.setItem(SAVE_KEY, serialize(game.s)); game.msg('Game saved.', 'good'); } catch (e) { game.msg('Could not save: ' + (e as Error).message, 'warn'); }
}
function loadGame() {
  const json = localStorage.getItem(SAVE_KEY);
  if (!json) { game?.msg('No saved game found.', 'warn'); return false; }
  try {
    const s = deserialize(json);
    const m = missionById(s.missionId);
    startMission(m, s);
    lastAutosave = performance.now();
    game?.msg('Game loaded.', 'good');
    return true;
  } catch (e) { console.error(e); game?.msg('Could not load the saved game.', 'warn'); return false; }
}

// ---------- menus ----------
function showMissions() {
  const p = progress();
  const list = $('mission-list');
  list.innerHTML = '';
  const camp = MISSIONS.filter(m => m.campaign);
  camp.forEach((m, i) => {
    const unlocked = i === 0 || p.done.includes(camp[i - 1].id) || location.hash === '#unlock';
    const b = document.createElement('button');
    b.className = (unlocked ? '' : 'locked ') + (p.done.includes(m.id) ? 'done' : '');
    b.innerHTML = `<span class="n">${i + 1}.</span><img src="${m.art}" alt=""><span>${m.name}</span>`;
    if (unlocked) b.onclick = () => showBriefing(m);
    list.appendChild(b);
  });
  show('missions');
}

function showBriefing(m: Mission) {
  ($('briefing-art') as HTMLImageElement).src = m.art;
  $('briefing-title').textContent = m.name;
  $('briefing-body').innerHTML = m.briefing.map(p => `<p>${p}</p>`).join('');
  $('briefing-objectives').innerHTML = m.objectives.map(o => `<li>${o.text}</li>`).join('');
  $('btn-start').onclick = () => { audio.init(); startMission(m); };
  (document.querySelector('#briefing .back') as HTMLElement).dataset.back = m.campaign ? 'missions' : 'menu';
  show('briefing');
}

function refreshContinue() {
  const b = $('btn-continue') as HTMLButtonElement;
  const info = autosaveInfo();
  b.disabled = !info;
  b.textContent = info ? `Continue: ${info.mission} (${info.minutes} min)` : 'Continue';
}
$('btn-continue').onclick = () => { audio.init(); if (!continueGame()) alert('No autosave found.'); };
$('btn-campaign').onclick = () => { audio.init(); showMissions(); };
$('btn-skirmish').onclick = () => { audio.init(); showBriefing(MISSIONS.find(m => !m.campaign)!); };
$('btn-load').onclick = () => { audio.init(); if (!loadGame()) alert('No saved game found.'); };
$('btn-help').onclick = () => show('help');
for (const b of document.querySelectorAll('.back') as NodeListOf<HTMLElement>) b.addEventListener('click', () => { const t = b.dataset.back || 'menu'; if (t === 'missions') showMissions(); else show(t); });

// dev helpers
(window as any).__start = (id: string) => { audio.init(); startMission(missionById(id)); };
(window as any).__missions = MISSIONS;
(window as any).__dev = { findPath, TILE, autosave, continueGame };

async function boot() {
  const bar = $('loading-bar');
  assets = await loadAssets((d, t) => { bar.style.width = `${Math.round(100 * d / t)}%`; });
  sprites = buildSprites(assets);
  if (assets.tex.wood) { $('panel').style.backgroundImage = "url('art/tex/wood.webp')"; for (const b of document.querySelectorAll('.menu-box, .briefing-box') as NodeListOf<HTMLElement>) b.style.backgroundImage = "linear-gradient(rgba(28,20,12,0.82), rgba(28,20,12,0.82)), url('art/tex/wood.webp')"; }
  $('loading').classList.add('hidden');
  (window as any).__ready = true;
  show('menu');
}
boot();
