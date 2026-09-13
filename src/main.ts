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
const SAVE_KEY = 'kib-save-v1', PROGRESS_KEY = 'kib-progress-v1';

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
    playerHasPlacedHouse: false, hints: [...m.hints],
  };
}

function startMission(m: Mission, state?: GameState) {
  mission = m;
  const s = state ?? createState(m);
  game = new Game(s);
  if (!state) { m.setup(game); game.rebuildIndexes(); game.dirtyTiles.length = 0; for (const u of game.s.units) u.condition = u.task.kind === 'soldier' ? 0.85 + Math.random() * 0.15 : 0.6 + Math.random() * 0.4; }
  game.onSound = n => audio.play(n);
  game.onMessage = msg => { if (msg.kind === 'alert') audio.play('alarm'); else if (msg.kind === 'good') audio.play('message'); };
  const canvas = $('c') as HTMLCanvasElement;
  if (!renderer) renderer = new Renderer(canvas, game, sprites, assets); else renderer.setGame(game);
  if (!ui) { ui = new UI(game, renderer, sprites); ui.onSave = saveGame; ui.onLoad = loadGame; ui.onQuit = () => { stopLoop(); audio.stopMusic(); show('menu'); }; } else ui.setGame(game);
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
  const idx = MISSIONS.indexOf(mission);
  const next = won && mission.campaign && idx + 1 < MISSIONS.length && MISSIONS[idx + 1].campaign ? MISSIONS[idx + 1] : null;
  $('btn-next').classList.toggle('hidden', !next);
  $('btn-next').onclick = () => { if (next) showBriefing(next); };
  $('btn-retry').onclick = () => { if (mission) showBriefing(mission); };
  stopLoop();
  audio.stopMusic();
  show('outcome');
}

// ---------- save / load ----------
function serialize(s: GameState): string {
  const m = s.map;
  const map = { w: m.w, h: m.h, terrain: Array.from(m.terrain), obj: Array.from(m.obj), data: Array.from(m.data), house: Array.from(m.house), owner: Array.from(m.owner) };
  return JSON.stringify({ ...s, map, groups: s.groups.map(g => ({ ...g, facing: (g as any).facing })) });
}
function deserialize(json: string): GameState {
  const o = JSON.parse(json);
  const map: MapData = createMap(o.map.w, o.map.h);
  map.terrain.set(o.map.terrain); map.obj.set(o.map.obj); map.data.set(o.map.data); map.house.set(o.map.house); map.owner.set(o.map.owner);
  return { ...o, map };
}
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

$('btn-campaign').onclick = () => { audio.init(); showMissions(); };
$('btn-skirmish').onclick = () => { audio.init(); showBriefing(MISSIONS.find(m => !m.campaign)!); };
$('btn-load').onclick = () => { audio.init(); if (!loadGame()) alert('No saved game found.'); };
$('btn-help').onclick = () => show('help');
for (const b of document.querySelectorAll('.back') as NodeListOf<HTMLElement>) b.addEventListener('click', () => { const t = b.dataset.back || 'menu'; if (t === 'missions') showMissions(); else show(t); });

// dev helpers
(window as any).__start = (id: string) => { audio.init(); startMission(missionById(id)); };
(window as any).__missions = MISSIONS;
(window as any).__dev = { findPath, TILE };

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
