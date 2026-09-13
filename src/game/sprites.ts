// ---- Procedurally drawn pixel-art sprites ----
import { HOUSE_DEFS, UNIT_DEFS, WARES, PLAYER_COLORS } from './defs';
import type { HouseType, UnitType, Ware } from './defs';
import { Terrain, Obj } from './map';

export const TILE = 32;
const SEED_TILE_VARIANTS = 4;

type C2D = CanvasRenderingContext2D;

export function mkCanvas(w: number, h: number): [HTMLCanvasElement, C2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

// tiny deterministic rng for texture noise
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

export interface Sprites {
  terrain: Record<number, HTMLCanvasElement[]>;   // Terrain -> variants
  water: HTMLCanvasElement[];
  road: HTMLCanvasElement; roadPlan: HTMLCanvasElement; roadDig: HTMLCanvasElement;
  field: HTMLCanvasElement[]; wine: HTMLCanvasElement[]; fieldPlan: HTMLCanvasElement; winePlan: HTMLCanvasElement;
  tree: HTMLCanvasElement[]; sapling: HTMLCanvasElement; stump: HTMLCanvasElement; bush: HTMLCanvasElement; rock: HTMLCanvasElement;
  ore: Record<string, HTMLCanvasElement>;
  houses: Record<HouseType, { done: HTMLCanvasElement; stages: HTMLCanvasElement[]; icon: HTMLCanvasElement; ruin: HTMLCanvasElement }>;
  units: Record<string, HTMLCanvasElement[][]>;  // key `${type}-${owner}` -> [dir4][frame]
  wares: Record<Ware, HTMLCanvasElement>;
  flag: HTMLCanvasElement[];
}

export function buildSprites(): Sprites {
  const S: Sprites = { terrain: {}, water: [], road: null!, roadPlan: null!, roadDig: null!, field: [], wine: [], fieldPlan: null!, winePlan: null!, tree: [], sapling: null!, stump: null!, bush: null!, rock: null!, ore: {}, houses: {} as any, units: {}, wares: {} as any, flag: [] };

  // ----- terrain -----
  const terrainBase: Record<number, [string, string]> = {
    [Terrain.Grass]: ['#5f9a3c', '#4f8a30'], [Terrain.Sand]: ['#d8c88a', '#c8b878'], [Terrain.Mountain]: ['#8a8a86', '#6e6e6a'],
    [Terrain.Dirt]: ['#8c7a4e', '#7a6a40'], [Terrain.Snow]: ['#e8ecf0', '#d0d8e0'], [Terrain.Water]: ['#2f6fb0', '#2a62a0'],
  };
  for (const t of [Terrain.Grass, Terrain.Sand, Terrain.Mountain, Terrain.Dirt, Terrain.Snow]) {
    S.terrain[t] = [];
    for (let v = 0; v < SEED_TILE_VARIANTS; v++) {
      const [c, ctx] = mkCanvas(TILE, TILE);
      const r = rng(1000 + t * 10 + v);
      ctx.fillStyle = terrainBase[t][0]; ctx.fillRect(0, 0, TILE, TILE);
      for (let i = 0; i < 40; i++) { ctx.fillStyle = r() < 0.5 ? terrainBase[t][1] : shade(terrainBase[t][0], 1.08); ctx.fillRect((r() * TILE) | 0, (r() * TILE) | 0, 2, 2); }
      if (t === Terrain.Grass) { ctx.fillStyle = '#6fae48'; for (let i = 0; i < 6; i++) { const x = (r() * 30) | 0, y = (r() * 28) | 0; ctx.fillRect(x, y, 1, 3); ctx.fillRect(x + 2, y + 1, 1, 2); } }
      if (t === Terrain.Mountain) {
        ctx.fillStyle = '#5a5a56'; for (let i = 0; i < 5; i++) { const x = (r() * 26) | 0, y = (r() * 26) | 0; ctx.fillRect(x, y, 6 + (r() * 6 | 0), 2); }
        ctx.fillStyle = '#a4a49e'; for (let i = 0; i < 5; i++) { const x = (r() * 26) | 0, y = (r() * 26) | 0; ctx.fillRect(x, y, 4 + (r() * 5 | 0), 2); }
      }
      S.terrain[t].push(c);
    }
  }
  for (let f = 0; f < 3; f++) {
    const [c, ctx] = mkCanvas(TILE, TILE);
    ctx.fillStyle = terrainBase[Terrain.Water][0]; ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = '#4a8ad0';
    for (let i = 0; i < 6; i++) { const y = ((i * 5 + f * 2) % TILE); ctx.fillRect(((i * 7 + f * 4) % TILE), y, 8, 1); }
    ctx.fillStyle = '#2a5a98'; for (let i = 0; i < 5; i++) { ctx.fillRect(((i * 11 + f * 3 + 5) % TILE), (i * 6 + 3) % TILE, 6, 1); }
    S.water.push(c);
  }
  // road
  {
    const [c, ctx] = mkCanvas(TILE, TILE); const r = rng(77);
    ctx.fillStyle = '#a89468'; ctx.fillRect(0, 0, TILE, TILE);
    for (let i = 0; i < 30; i++) { ctx.fillStyle = r() < 0.5 ? '#988458' : '#b8a478'; ctx.fillRect((r() * TILE) | 0, (r() * TILE) | 0, 2, 2); }
    ctx.fillStyle = '#8a7a50'; for (let i = 0; i < 6; i++) ctx.fillRect((r() * 28) | 0, (r() * 28) | 0, 3, 2);
    S.road = c;
  }
  S.roadPlan = planTile('#e8e0b0'); S.fieldPlan = planTile('#f0d860'); S.winePlan = planTile('#d090e0');
  { const [c, ctx] = mkCanvas(TILE, TILE); ctx.fillStyle = '#7a6a40'; ctx.fillRect(0, 0, TILE, TILE); ctx.fillStyle = '#5a4a28'; for (let i = 0; i < 8; i++) ctx.fillRect((i * 9) % 30, (i * 13) % 30, 4, 2); S.roadDig = c; }
  // fields: 0 empty ploughed, 1..5 growing, 6 ripe
  for (let st = 0; st <= 6; st++) {
    const [c, ctx] = mkCanvas(TILE, TILE);
    ctx.fillStyle = '#7a5a30'; ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = '#6a4a22'; for (let y = 2; y < TILE; y += 6) ctx.fillRect(0, y, TILE, 2);
    if (st > 0) {
      const hgt = Math.min(14, 2 + st * 2);
      ctx.fillStyle = st >= 6 ? '#d8b830' : st >= 4 ? '#a8b040' : '#68a838';
      for (let x = 2; x < TILE; x += 5) for (let y = 4; y < TILE; y += 6) { ctx.fillRect(x, y + 2 - hgt / 2, 2, hgt / 2 + 1); }
      if (st >= 6) { ctx.fillStyle = '#f0d040'; for (let x = 2; x < TILE; x += 5) for (let y = 4; y < TILE; y += 6) ctx.fillRect(x - 1, y - 5, 4, 3); }
    }
    S.field.push(c);
  }
  for (let st = 0; st <= 6; st++) {
    const [c, ctx] = mkCanvas(TILE, TILE);
    ctx.fillStyle = '#6a5a3a'; ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = '#5a4a2a'; for (let x = 4; x < TILE; x += 10) ctx.fillRect(x, 0, 2, TILE);
    if (st > 0) {
      ctx.fillStyle = '#3e7a30';
      for (let x = 2; x < TILE; x += 10) for (let y = 2; y < TILE; y += 5) ctx.fillRect(x, y, 6, 3);
      if (st >= 5) { ctx.fillStyle = st >= 6 ? '#6a2a7a' : '#8a5a9a'; for (let x = 4; x < TILE; x += 10) for (let y = 5; y < TILE; y += 8) ctx.fillRect(x, y, 3, 3); }
    }
    S.wine.push(c);
  }
  // trees
  for (let v = 0; v < 3; v++) {
    const [c, ctx] = mkCanvas(TILE, TILE + 16);
    const r = rng(500 + v);
    ctx.fillStyle = '#5a3a1a'; ctx.fillRect(14, 30, 5, 16);
    const cols = v === 2 ? ['#2f6a2a', '#3f8a38', '#58a848'] : ['#2a6a30', '#3a8a40', '#54a858'];
    const cx = 16, cy = 22;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = cols[i];
      const rad = 13 - i * 3.5;
      ctx.beginPath(); ctx.ellipse(cx - i * 1.5, cy - i * 2, rad, rad * (v === 2 ? 1.3 : 0.9), 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#1e4a20'; for (let i = 0; i < 6; i++) ctx.fillRect((6 + r() * 20) | 0, (10 + r() * 20) | 0, 2, 2);
    S.tree.push(c);
  }
  { const [c, ctx] = mkCanvas(TILE, TILE); ctx.fillStyle = '#5a3a1a'; ctx.fillRect(15, 18, 3, 12); ctx.fillStyle = '#4a9a40'; ctx.beginPath(); ctx.ellipse(16, 15, 6, 7, 0, 0, Math.PI * 2); ctx.fill(); S.sapling = c; }
  { const [c, ctx] = mkCanvas(TILE, TILE); ctx.fillStyle = '#6a4a2a'; ctx.fillRect(12, 18, 9, 8); ctx.fillStyle = '#a88a5a'; ctx.fillRect(12, 16, 9, 4); S.stump = c; }
  { const [c, ctx] = mkCanvas(TILE, TILE); ctx.fillStyle = '#3a7a30'; ctx.beginPath(); ctx.ellipse(16, 22, 9, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#4f9a40'; ctx.beginPath(); ctx.ellipse(14, 20, 5, 4, 0, 0, Math.PI * 2); ctx.fill(); S.bush = c; }
  { const [c, ctx] = mkCanvas(TILE, TILE); ctx.fillStyle = '#7a7a76'; ctx.beginPath(); ctx.ellipse(16, 22, 10, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#9a9a96'; ctx.fillRect(10, 16, 8, 5); S.rock = c; }
  for (const [k, col] of [['coal', '#1a1a1a'], ['iron', '#b06a40'], ['gold', '#e8c030']] as const) {
    const [c, ctx] = mkCanvas(TILE, TILE);
    ctx.drawImage(S.terrain[Terrain.Mountain][0], 0, 0);
    ctx.fillStyle = col; const r = rng(k.length * 31);
    for (let i = 0; i < 9; i++) { ctx.fillRect((2 + r() * 26) | 0, (2 + r() * 26) | 0, 3, 3); }
    S.ore[k] = c;
  }

  // ----- wares -----
  for (const w of WARES) S.wares[w] = wareIcon(w);

  // ----- houses -----
  for (const t of Object.keys(HOUSE_DEFS) as HouseType[]) S.houses[t] = houseSprites(t, S);

  // ----- units -----
  for (const t of Object.keys(UNIT_DEFS) as UnitType[]) for (let o = 1; o < PLAYER_COLORS.length; o++) S.units[`${t}-${o}`] = unitSprites(t, PLAYER_COLORS[o], S);

  // flags
  for (let o = 0; o < PLAYER_COLORS.length; o++) { const [c, ctx] = mkCanvas(10, 14); ctx.fillStyle = '#5a3a1a'; ctx.fillRect(1, 0, 2, 14); ctx.fillStyle = PLAYER_COLORS[o]; ctx.fillRect(3, 1, 7, 5); S.flag.push(c); }
  return S;
}

function planTile(col: string): HTMLCanvasElement {
  const [c, ctx] = mkCanvas(TILE, TILE);
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.strokeRect(3, 3, TILE - 6, TILE - 6);
  return c;
}

function wareIcon(w: Ware): HTMLCanvasElement {
  const [c, ctx] = mkCanvas(16, 16);
  const box = (col: string) => { ctx.fillStyle = col; ctx.fillRect(3, 4, 10, 9); ctx.fillStyle = shade(col, 0.7); ctx.fillRect(3, 11, 10, 2); };
  switch (w) {
    case 'trunk': ctx.fillStyle = '#7a4a1a'; ctx.fillRect(2, 5, 12, 6); ctx.fillStyle = '#c8a070'; ctx.fillRect(12, 5, 2, 6); break;
    case 'wood': ctx.fillStyle = '#c8965a'; ctx.fillRect(2, 4, 12, 3); ctx.fillRect(2, 9, 12, 3); ctx.fillStyle = '#9a6a3a'; ctx.fillRect(2, 6, 12, 1); ctx.fillRect(2, 11, 12, 1); break;
    case 'stone': ctx.fillStyle = '#9a9a96'; ctx.fillRect(3, 5, 10, 8); ctx.fillStyle = '#c0c0bc'; ctx.fillRect(4, 5, 8, 3); break;
    case 'ironOre': ctx.fillStyle = '#8a8a86'; ctx.fillRect(3, 6, 10, 7); ctx.fillStyle = '#c06a30'; ctx.fillRect(5, 7, 2, 2); ctx.fillRect(9, 9, 2, 2); break;
    case 'goldOre': ctx.fillStyle = '#8a8a86'; ctx.fillRect(3, 6, 10, 7); ctx.fillStyle = '#f0d030'; ctx.fillRect(5, 7, 2, 2); ctx.fillRect(9, 9, 2, 2); break;
    case 'coal': ctx.fillStyle = '#222'; ctx.fillRect(3, 6, 10, 7); ctx.fillStyle = '#444'; ctx.fillRect(4, 6, 4, 2); break;
    case 'steel': ctx.fillStyle = '#b8c0c8'; ctx.fillRect(2, 5, 12, 3); ctx.fillRect(2, 9, 12, 3); ctx.fillStyle = '#e8ecf0'; ctx.fillRect(2, 5, 12, 1); break;
    case 'gold': ctx.fillStyle = '#e8c020'; ctx.fillRect(2, 5, 12, 3); ctx.fillRect(3, 9, 10, 3); ctx.fillStyle = '#fff090'; ctx.fillRect(2, 5, 12, 1); break;
    case 'wine': ctx.fillStyle = '#6a3a1a'; ctx.fillRect(4, 3, 8, 11); ctx.fillStyle = '#8a1a3a'; ctx.fillRect(5, 6, 6, 5); break;
    case 'corn': ctx.fillStyle = '#e0c040'; ctx.fillRect(7, 2, 2, 12); ctx.fillRect(4, 4, 3, 2); ctx.fillRect(9, 6, 3, 2); ctx.fillRect(4, 8, 3, 2); break;
    case 'flour': ctx.fillStyle = '#e8dcc0'; ctx.fillRect(3, 4, 10, 10); ctx.fillStyle = '#c8b898'; ctx.fillRect(3, 4, 10, 2); break;
    case 'bread': ctx.fillStyle = '#c88a40'; ctx.beginPath(); ctx.ellipse(8, 9, 6, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#e8b060'; ctx.fillRect(4, 6, 8, 2); break;
    case 'pig': ctx.fillStyle = '#e8a0a0'; ctx.beginPath(); ctx.ellipse(8, 9, 6, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#c07070'; ctx.fillRect(12, 8, 2, 2); break;
    case 'skin': ctx.fillStyle = '#c8a878'; ctx.fillRect(3, 3, 10, 10); ctx.fillStyle = '#a88858'; ctx.fillRect(4, 4, 3, 3); ctx.fillRect(9, 8, 3, 3); break;
    case 'leather': ctx.fillStyle = '#8a5a30'; ctx.fillRect(3, 4, 10, 9); ctx.fillStyle = '#a87a4a'; ctx.fillRect(3, 4, 10, 2); break;
    case 'sausage': ctx.fillStyle = '#a03030'; ctx.fillRect(2, 6, 12, 4); ctx.fillStyle = '#c05050'; ctx.fillRect(2, 6, 12, 1); ctx.fillStyle = '#6a2020'; ctx.fillRect(6, 6, 1, 4); ctx.fillRect(10, 6, 1, 4); break;
    case 'horse': ctx.fillStyle = '#8a5a30'; ctx.fillRect(3, 6, 10, 5); ctx.fillRect(11, 3, 3, 5); ctx.fillRect(4, 11, 2, 3); ctx.fillRect(10, 11, 2, 3); break;
    case 'shield': ctx.fillStyle = '#8a5a2a'; ctx.beginPath(); ctx.arc(8, 8, 6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#c8c8c8'; ctx.fillRect(7, 7, 2, 2); break;
    case 'ironShield': ctx.fillStyle = '#9098a8'; ctx.beginPath(); ctx.arc(8, 8, 6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#d8dce8'; ctx.fillRect(7, 7, 2, 2); break;
    case 'leatherArmor': ctx.fillStyle = '#8a5a30'; ctx.fillRect(4, 3, 8, 11); ctx.fillRect(2, 4, 12, 4); ctx.fillStyle = '#6a4020'; ctx.fillRect(7, 6, 2, 8); break;
    case 'ironArmor': ctx.fillStyle = '#a0a8b8'; ctx.fillRect(4, 3, 8, 11); ctx.fillRect(2, 4, 12, 4); ctx.fillStyle = '#e0e4ec'; ctx.fillRect(7, 6, 2, 8); break;
    case 'axe': ctx.fillStyle = '#7a5a2a'; ctx.fillRect(7, 3, 2, 12); ctx.fillStyle = '#c0c0c0'; ctx.fillRect(9, 3, 4, 5); break;
    case 'sword': ctx.fillStyle = '#d0d4dc'; ctx.fillRect(7, 1, 2, 10); ctx.fillStyle = '#7a5a2a'; ctx.fillRect(5, 11, 6, 2); ctx.fillRect(7, 13, 2, 2); break;
    case 'bow': ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(5, 8, 6, -Math.PI / 2, Math.PI / 2); ctx.stroke(); ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(5, 2); ctx.lineTo(5, 14); ctx.stroke(); break;
    case 'crossbow': ctx.fillStyle = '#7a5a2a'; ctx.fillRect(7, 3, 2, 12); ctx.fillStyle = '#c0c0c0'; ctx.fillRect(2, 5, 12, 2); break;
    case 'lance': ctx.fillStyle = '#7a5a2a'; ctx.fillRect(7, 3, 2, 13); ctx.fillStyle = '#d0d0d0'; ctx.fillRect(6, 0, 4, 4); break;
    case 'pike': ctx.fillStyle = '#5a4a3a'; ctx.fillRect(7, 3, 2, 13); ctx.fillStyle = '#e0e4ec'; ctx.fillRect(6, 0, 4, 4); ctx.fillRect(5, 3, 6, 1); break;
    default: box('#888');
  }
  return c;
}

function houseSprites(type: HouseType, S: Sprites) {
  const def = HOUSE_DEFS[type];
  const W = def.w * TILE, H = def.h * TILE;
  const roofH = Math.round(H * 0.45) + 8;
  const total = H + 10;
  const draw = (stage: number, ruin = false): HTMLCanvasElement => {
    const [c, ctx] = mkCanvas(W, total);
    const oy = 10; // roof overhang above the footprint
    const wall = ruin ? '#7a7068' : def.wall, roof = ruin ? '#4a4038' : def.roof;
    const frac = stage; // 0..1 completion
    // ground / foundation
    ctx.fillStyle = '#8a7a58'; ctx.fillRect(1, oy + 1, W - 2, H - 2);
    ctx.fillStyle = '#6a5a3c'; ctx.fillRect(1, oy + H - 3, W - 2, 2);
    if (frac < 0.25) {
      // stakes and a pile of materials
      ctx.fillStyle = '#7a5a2a'; for (let x = 4; x < W; x += 10) ctx.fillRect(x, oy + 4, 2, H - 8);
      ctx.drawImage(S.wares.wood, W / 2 - 12, oy + H / 2 - 8); ctx.drawImage(S.wares.stone, W / 2 + 2, oy + H / 2 - 8);
      return c;
    }
    const wallTop = oy + roofH - 4;
    const wallH = H - roofH + 4;
    const visibleWall = frac < 0.6 ? wallH * ((frac - 0.25) / 0.35) : wallH;
    // walls (built bottom-up)
    ctx.fillStyle = wall; ctx.fillRect(2, wallTop + wallH - visibleWall, W - 4, visibleWall);
    ctx.fillStyle = shade(wall, 0.8); ctx.fillRect(2, wallTop + wallH - visibleWall, 3, visibleWall); // shadow side
    // timber frame lines
    ctx.fillStyle = shade(wall, 0.55);
    for (let x = 8; x < W - 4; x += 14) ctx.fillRect(x, wallTop + wallH - visibleWall, 2, visibleWall);
    ctx.fillRect(2, wallTop + wallH - visibleWall, W - 4, 2);
    // door
    const dx = def.entrance * TILE + TILE / 2 - 6;
    if (frac >= 0.6 || ruin) { ctx.fillStyle = '#3a2a14'; ctx.fillRect(dx, oy + H - 16, 12, 14); ctx.fillStyle = '#5a4020'; ctx.fillRect(dx + 1, oy + H - 15, 10, 12); }
    // windows
    if (frac >= 0.6 && !ruin) { ctx.fillStyle = '#2a2a40'; for (let x = 8; x < W - 12; x += 22) { if (Math.abs(x - dx) < 12) continue; ctx.fillRect(x, oy + H - 20, 7, 7); ctx.fillStyle = '#f0e080'; ctx.fillRect(x + 1, oy + H - 19, 2, 2); ctx.fillStyle = '#2a2a40'; } }
    // roof
    if (frac >= 0.6) {
      const roofFrac = ruin ? 0.35 : Math.min(1, (frac - 0.6) / 0.4);
      const rh = Math.round(roofH * roofFrac);
      // roof as trapezoid rows
      for (let y = 0; y < rh; y++) {
        const t = 1 - y / roofH;
        const inset = Math.round(t * (W * 0.16));
        const yy = oy + roofH - 1 - y;
        ctx.fillStyle = (y % 5 === 0) ? shade(roof, 0.75) : roof;
        ctx.fillRect(inset, yy, W - inset * 2, 1);
      }
      ctx.fillStyle = shade(roof, 1.2); const inset = Math.round((1 - rh / roofH) * (W * 0.16)); ctx.fillRect(inset, oy + roofH - rh, W - inset * 2, 2);
      // ridge & chimney
      if (roofFrac >= 1) {
        ctx.fillStyle = shade(roof, 0.6); ctx.fillRect(Math.round(W * 0.16), oy, W - Math.round(W * 0.32), 2);
        if (def.recipes || def.special === 'inn' || def.special === 'mine') { ctx.fillStyle = '#5a5a5a'; ctx.fillRect(W - 14, oy + 2, 6, 10); }
      }
    }
    if (ruin) { ctx.fillStyle = 'rgba(30,20,10,0.35)'; ctx.fillRect(0, 0, W, total); ctx.fillStyle = '#2a2a2a'; ctx.fillRect(6, oy + H - 8, 10, 4); ctx.fillRect(W - 20, oy + H - 12, 12, 5); }
    if (frac >= 1 && !ruin) houseDecor(type, ctx, W, H, oy, S);
    return c;
  };
  const done = draw(1);
  const stages = [draw(0), draw(0.35), draw(0.7), draw(0.9)];
  const ruin = draw(1, true);
  const [icon, ictx] = mkCanvas(48, 40);
  const sc = Math.min(48 / W, 40 / total);
  ictx.drawImage(done, (48 - W * sc) / 2, (40 - total * sc) / 2, W * sc, total * sc);
  return { done, stages, icon, ruin };
}

function houseDecor(type: HouseType, ctx: C2D, W: number, H: number, oy: number, S: Sprites) {
  const sign = (w: Ware, x: number) => { ctx.fillStyle = '#e8dcc0'; ctx.fillRect(x - 2, oy + H - 30, 20, 20); ctx.drawImage(S.wares[w], x, oy + H - 28); };
  switch (type) {
    case 'storehouse': ctx.fillStyle = '#c8b090'; ctx.fillRect(6, oy + H - 12, 14, 10); ctx.fillStyle = '#5a3a1a'; ctx.fillRect(6, oy + H - 12, 14, 2); sign('wood', W - 26); break;
    case 'school': ctx.fillStyle = '#e8e0c0'; ctx.fillRect(W / 2 - 8, oy + 4, 16, 12); ctx.fillStyle = '#3b4c8c'; ctx.fillRect(W / 2 - 6, oy + 6, 12, 2); ctx.fillRect(W / 2 - 6, oy + 10, 12, 2); break;
    case 'inn': sign('wine', W - 24); ctx.fillStyle = '#f0e080'; ctx.fillRect(4, oy + H - 22, 5, 5); break;
    case 'quarry': ctx.fillStyle = '#b0b0ac'; ctx.fillRect(4, oy + H - 12, 10, 8); ctx.fillRect(16, oy + H - 9, 8, 5); break;
    case 'woodcutters': ctx.fillStyle = '#7a4a1a'; ctx.fillRect(4, oy + H - 10, 22, 4); ctx.fillRect(6, oy + H - 14, 18, 4); break;
    case 'sawmill': ctx.fillStyle = '#c8965a'; ctx.fillRect(W - 28, oy + H - 12, 24, 3); ctx.fillRect(W - 26, oy + H - 8, 20, 3); ctx.fillStyle = '#b0b0b0'; ctx.beginPath(); ctx.arc(10, oy + H - 20, 6, 0, Math.PI * 2); ctx.fill(); break;
    case 'farm': sign('corn', W - 24); break;
    case 'mill': { ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 3; const cx = W / 2, cy = oy + 12; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18); ctx.stroke(); } break; }
    case 'bakery': sign('bread', W - 24); break;
    case 'swineFarm': ctx.fillStyle = '#7a5a30'; for (let x = 4; x < W - 30; x += 6) ctx.fillRect(x, oy + H - 10, 2, 8); ctx.drawImage(S.wares.pig, 8, oy + H - 20); break;
    case 'butchers': sign('sausage', W - 24); break;
    case 'vineyard': sign('wine', W - 24); break;
    case 'tannery': sign('leather', W - 24); break;
    case 'coalMine': ctx.fillStyle = '#222'; ctx.fillRect(W / 2 - 8, oy + H - 18, 16, 16); ctx.drawImage(S.wares.coal, 4, oy + H - 18); break;
    case 'ironMine': ctx.fillStyle = '#222'; ctx.fillRect(W / 2 - 8, oy + H - 18, 16, 16); ctx.drawImage(S.wares.ironOre, 4, oy + H - 18); break;
    case 'goldMine': ctx.fillStyle = '#222'; ctx.fillRect(W / 2 - 8, oy + H - 18, 16, 16); ctx.drawImage(S.wares.goldOre, 4, oy + H - 18); break;
    case 'ironSmithy': sign('steel', W - 24); break;
    case 'metallurgists': sign('gold', W - 24); break;
    case 'weaponsWorkshop': sign('axe', W - 24); break;
    case 'armorWorkshop': sign('shield', W - 24); break;
    case 'weaponSmithy': sign('sword', W - 24); break;
    case 'armorSmithy': sign('ironArmor', W - 24); break;
    case 'stables': sign('horse', W - 24); ctx.fillStyle = '#7a5a30'; for (let x = 4; x < 30; x += 6) ctx.fillRect(x, oy + H - 10, 2, 8); break;
    case 'barracks': ctx.fillStyle = '#5a4a3a'; for (let x = 6; x < W - 6; x += 8) ctx.fillRect(x, oy + 2, 4, 6); sign('sword', W - 24); break;
    case 'watchtower': ctx.fillStyle = '#5a4a3a'; for (let x = 2; x < W - 2; x += 6) ctx.fillRect(x, oy - 2, 3, 5); break;
  }
}

function unitSprites(type: UnitType, ownerCol: string, S: Sprites): HTMLCanvasElement[][] {
  const def = UNIT_DEFS[type];
  const out: HTMLCanvasElement[][] = [];
  const W = 24, H = 32;
  for (let dir = 0; dir < 4; dir++) { // 0 down, 1 left, 2 up, 3 right
    const frames: HTMLCanvasElement[] = [];
    for (let f = 0; f < 3; f++) {
      const [c, ctx] = mkCanvas(W, H);
      const flip = dir === 3;
      if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      const d = flip ? 1 : dir;
      drawUnit(ctx, type, def.color, ownerCol, d, f, S);
      frames.push(c);
    }
    out.push(frames);
  }
  return out;
}

function drawUnit(ctx: C2D, type: UnitType, tunic: string, owner: string, dir: number, frame: number, S: Sprites) {
  const def = UNIT_DEFS[type];
  const mounted = !!def.mounted;
  const cx = 12;
  const base = mounted ? 20 : 28; // feet y
  const legOff = frame === 1 ? 2 : frame === 2 ? -2 : 0;
  const soldier = !!def.equipment;
  const heavy = type === 'swordFighter' || type === 'knight' || type === 'crossbowman' || type === 'pikeman';
  // horse
  if (mounted) {
    ctx.fillStyle = '#6a4a28';
    if (dir === 1) { ctx.fillRect(3, 16, 18, 8); ctx.fillRect(1, 12, 6, 7); ctx.fillRect(4, 24, 3, 6 + legOff); ctx.fillRect(15, 24, 3, 6 - legOff); ctx.fillStyle = '#3a2a18'; ctx.fillRect(19, 15, 3, 7); }
    else { ctx.fillRect(6, 16, 12, 9); ctx.fillRect(5, 24, 3, 6 + legOff); ctx.fillRect(16, 24, 3, 6 - legOff); if (dir === 0) { ctx.fillStyle = '#5a3a1a'; ctx.fillRect(8, 12, 8, 7); } }
    ctx.fillStyle = owner; ctx.fillRect(dir === 1 ? 8 : 7, 17, dir === 1 ? 8 : 10, 3); // saddle cloth
  } else {
    // legs
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(cx - 4, base - 6, 3, 6 + (dir === 1 ? legOff : 0));
    ctx.fillRect(cx + 1, base - 6, 3, 6 - (dir === 1 ? legOff : 0));
    if (dir !== 1 && legOff) { ctx.fillStyle = '#3a2a1a'; ctx.fillRect(cx - 4 + (legOff > 0 ? 0 : 5), base - 2, 3, 2); }
  }
  // body
  const bodyTop = base - 16;
  ctx.fillStyle = heavy ? '#8a94a8' : tunic;
  ctx.fillRect(cx - 5, bodyTop, 10, 11);
  ctx.fillStyle = shade(heavy ? '#8a94a8' : tunic, 0.75); ctx.fillRect(cx - 5, bodyTop, 2, 11);
  // owner colour band
  ctx.fillStyle = owner; ctx.fillRect(cx - 5, bodyTop + 8, 10, 2);
  // arms
  ctx.fillStyle = '#e8c8a0';
  if (dir === 1) ctx.fillRect(cx - 2, bodyTop + 4, 3, 5);
  else { ctx.fillRect(cx - 7, bodyTop + 3, 2, 6); ctx.fillRect(cx + 5, bodyTop + 3, 2, 6); }
  // head
  const headY = bodyTop - 7;
  ctx.fillStyle = '#e8c8a0'; ctx.fillRect(cx - 3, headY, 7, 7);
  if (dir === 2) { ctx.fillStyle = '#5a3a1a'; ctx.fillRect(cx - 3, headY, 7, 7); }
  // hair / helmet / hat
  if (soldier) {
    ctx.fillStyle = heavy ? '#c8d0dc' : '#8a8a8a';
    ctx.fillRect(cx - 4, headY - 2, 9, 4);
    if (heavy) ctx.fillRect(cx - 4, headY - 2, 9, 6), ctx.fillStyle = '#e8c8a0', dir !== 2 && ctx.fillRect(cx - 1, headY + 3, 3, 2);
  } else {
    ctx.fillStyle = type === 'serf' ? '#c8b48a' : type === 'laborer' ? '#3a2a1a' : type === 'miner' ? '#303030' : type === 'baker' || type === 'miller' ? '#f0f0f0' : type === 'recruit' ? '#6a6a6a' : '#7a5a2a';
    ctx.fillRect(cx - 4, headY - 2, 9, 3);
    if (type === 'farmer' || type === 'vintner') { ctx.fillStyle = '#d8b850'; ctx.fillRect(cx - 6, headY - 1, 13, 2); }
  }
  if (dir === 0 && !soldier) { ctx.fillStyle = '#222'; ctx.fillRect(cx - 2, headY + 3, 1, 1); ctx.fillRect(cx + 2, headY + 3, 1, 1); }
  // tools & weapons (drawn on the right-hand side)
  const hx = dir === 1 ? cx + 1 : cx + 7, hy = bodyTop + 2;
  ctx.fillStyle = '#7a5a2a';
  const wood = '#7a5a2a', metal = '#d0d4dc';
  switch (type) {
    case 'militia': case 'axeFighter': case 'scout': ctx.fillStyle = wood; ctx.fillRect(hx, hy - 6, 2, 12); ctx.fillStyle = metal; ctx.fillRect(hx + 2, hy - 6, 3, 4); break;
    case 'swordFighter': case 'knight': ctx.fillStyle = metal; ctx.fillRect(hx, hy - 10, 2, 12); ctx.fillStyle = wood; ctx.fillRect(hx - 2, hy + 1, 6, 2); break;
    case 'bowman': ctx.strokeStyle = wood; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, hy + 1, 7, -Math.PI / 2, Math.PI / 2); ctx.stroke(); break;
    case 'crossbowman': ctx.fillStyle = wood; ctx.fillRect(hx - 1, hy - 4, 2, 10); ctx.fillStyle = metal; ctx.fillRect(hx - 4, hy - 3, 8, 2); break;
    case 'lanceCarrier': ctx.fillStyle = wood; ctx.fillRect(hx, hy - 14, 2, 22); ctx.fillStyle = metal; ctx.fillRect(hx - 1, hy - 16, 4, 4); break;
    case 'pikeman': ctx.fillStyle = '#5a4a3a'; ctx.fillRect(hx, hy - 16, 2, 24); ctx.fillStyle = metal; ctx.fillRect(hx - 1, hy - 18, 4, 4); break;
    case 'woodcutter': ctx.fillStyle = wood; ctx.fillRect(hx, hy - 4, 2, 10); ctx.fillStyle = metal; ctx.fillRect(hx + 2, hy - 4, 3, 3); break;
    case 'stonemason': case 'miner': ctx.fillStyle = wood; ctx.fillRect(hx, hy - 4, 2, 10); ctx.fillStyle = metal; ctx.fillRect(hx - 2, hy - 5, 7, 2); break;
    case 'laborer': ctx.fillStyle = wood; ctx.fillRect(hx, hy - 4, 2, 10); ctx.fillStyle = '#6a6a6a'; ctx.fillRect(hx - 1, hy - 6, 4, 3); break;
    case 'farmer': ctx.fillStyle = wood; ctx.fillRect(hx, hy - 8, 2, 14); ctx.fillStyle = metal; ctx.fillRect(hx - 3, hy - 9, 6, 2); break;
    case 'smith': case 'armorer': ctx.fillStyle = wood; ctx.fillRect(hx, hy - 2, 2, 8); ctx.fillStyle = '#5a5a5a'; ctx.fillRect(hx - 2, hy - 4, 6, 3); break;
    case 'carpenter': ctx.fillStyle = metal; ctx.fillRect(hx, hy - 4, 2, 8); ctx.fillStyle = wood; ctx.fillRect(hx - 1, hy + 4, 4, 2); break;
  }
  // shields (left side)
  if (type === 'axeFighter' || type === 'scout') { ctx.fillStyle = '#8a5a2a'; ctx.beginPath(); ctx.arc(dir === 1 ? cx + 3 : cx - 7, bodyTop + 5, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#c8c8c8'; ctx.fillRect(dir === 1 ? cx + 2 : cx - 8, bodyTop + 4, 2, 2); }
  if (type === 'swordFighter' || type === 'knight') { ctx.fillStyle = '#9098a8'; ctx.beginPath(); ctx.arc(dir === 1 ? cx + 3 : cx - 7, bodyTop + 5, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = owner; ctx.fillRect(dir === 1 ? cx + 2 : cx - 8, bodyTop + 4, 2, 2); }
  void S;
}

/** Map 8-way direction to 4-way sprite direction (0 down, 1 left, 2 up, 3 right). */
export function dir4(d8: number): number {
  switch (d8) { case 0: return 0; case 1: case 2: return 1; case 3: case 4: case 5: return 2; case 6: case 7: return 3; }
  return 0;
}

export function objName(o: Obj): string { return String(o); }
