// ---- Procedurally drawn pixel-art sprites ----
import { HOUSE_DEFS, UNIT_DEFS, WARES, PLAYER_COLORS } from './defs';
import type { HouseType, UnitType, Ware } from './defs';
import type { Assets } from './assets';

export const TILE = 40;

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

export interface HouseArt { img: HTMLImageElement | null; done: HTMLCanvasElement; ruin: HTMLCanvasElement; icon: HTMLCanvasElement; }

export interface Sprites {
  houses: Record<HouseType, HouseArt>;
  units: Record<string, HTMLCanvasElement[][]>;  // key `${type}-${owner}` -> [dir4][frame]
  wares: Record<Ware, HTMLCanvasElement>;
  flag: HTMLCanvasElement[];
  masks: { edge: HTMLCanvasElement[]; corner: HTMLCanvasElement[] }; // terrain blending masks (N E S W / NE SE SW NW)
  hd: boolean; // image-based unit sprites (64x96 cells) rather than 24x32 pixel art
}

export function buildSprites(A: Assets): Sprites {
  const S: Sprites = { houses: {} as any, units: {}, wares: {} as any, flag: [], masks: { edge: [], corner: [] }, hd: false };
  for (const w of WARES) {
    const img = A.wares[w];
    if (img) { const [c, ctx] = mkCanvas(32, 32); ctx.imageSmoothingEnabled = true; ctx.drawImage(img, 0, 0, 32, 32); S.wares[w] = c; }
    else S.wares[w] = wareIcon(w);
  }
  for (const t of Object.keys(HOUSE_DEFS) as HouseType[]) S.houses[t] = houseArt(t, A.houses[t] ?? null, S);
  for (const t of Object.keys(UNIT_DEFS) as UnitType[]) for (let o = 1; o < PLAYER_COLORS.length; o++) {
    const sheet = A.units[t];
    S.units[`${t}-${o}`] = sheet ? unitFromSheet(sheet, PLAYER_COLORS[o], o) : unitSprites(t, PLAYER_COLORS[o], S);
  }
  S.hd = Object.keys(A.units).length > 0;
  for (let o = 0; o < PLAYER_COLORS.length; o++) { const [c, ctx] = mkCanvas(10, 14); ctx.fillStyle = '#5a3a1a'; ctx.fillRect(1, 0, 2, 14); ctx.fillStyle = PLAYER_COLORS[o]; ctx.fillRect(3, 1, 7, 5); S.flag.push(c); }
  S.masks = buildMasks();
  return S;
}

/** Feathered, slightly wavy alpha masks used to blend a neighbouring terrain over a tile edge. */
function buildMasks() {
  const edge: HTMLCanvasElement[] = [], corner: HTMLCanvasElement[] = [];
  const r = rng(4242);
  const wob = new Float32Array(TILE * 2); for (let i = 0; i < wob.length; i++) wob[i] = (r() - 0.5) * 7;
  const feather = TILE * 0.42;
  const sm = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  for (let d = 0; d < 4; d++) {
    const [c, ctx] = mkCanvas(TILE, TILE);
    const img = ctx.createImageData(TILE, TILE);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const along = d % 2 === 0 ? x : y;
      const dist = d === 0 ? y : d === 1 ? TILE - 1 - x : d === 2 ? TILE - 1 - y : x;
      const a = 1 - sm((dist + wob[(along + d * 17) % wob.length]) / feather);
      img.data[(y * TILE + x) * 4 + 3] = Math.round(255 * a);
    }
    ctx.putImageData(img, 0, 0); edge.push(c);
  }
  for (let d = 0; d < 4; d++) { // NE SE SW NW
    const [c, ctx] = mkCanvas(TILE, TILE);
    const img = ctx.createImageData(TILE, TILE);
    const cx = d === 0 || d === 1 ? TILE : 0, cy = d === 1 || d === 2 ? TILE : 0;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + wob[(x + y + d * 23) % wob.length] * 0.6;
      const a = 1 - sm(dist / (feather * 0.9));
      img.data[(y * TILE + x) * 4 + 3] = Math.round(255 * a);
    }
    ctx.putImageData(img, 0, 0); corner.push(c);
  }
  return { edge, corner };
}

function houseArt(type: HouseType, img: HTMLImageElement | null, S: Sprites): HouseArt {
  const def = HOUSE_DEFS[type];
  const W = def.w * TILE, H = def.h * TILE;
  if (!img) { // fallback: flat coloured block
    const [c, ctx] = mkCanvas(W, H + 10);
    ctx.fillStyle = def.wall; ctx.fillRect(0, 10, W, H); ctx.fillStyle = def.roof; ctx.fillRect(0, 0, W, Math.round(H * 0.45) + 10);
    const [icon, ictx] = mkCanvas(48, 40); ictx.drawImage(c, 0, 0, 48, 40);
    return { img: null, done: c, ruin: c, icon };
  }
  // done: the image itself at native (2x) resolution
  const [done, dctx] = mkCanvas(img.width, img.height); dctx.drawImage(img, 0, 0);
  // ruin: lower 62% with a jagged top edge, darkened and desaturated
  const [ruin, rctx] = mkCanvas(img.width, img.height);
  const r = rng(type.length * 977);
  rctx.save();
  rctx.beginPath();
  const top = img.height * 0.38;
  rctx.moveTo(0, img.height);
  rctx.lineTo(0, top + 20);
  for (let x = 0; x <= img.width; x += img.width / 9) rctx.lineTo(x, top + (r() - 0.5) * img.height * 0.22);
  rctx.lineTo(img.width, img.height); rctx.closePath(); rctx.clip();
  rctx.drawImage(img, 0, 0);
  rctx.globalCompositeOperation = 'source-atop';
  rctx.fillStyle = 'rgba(30,22,14,0.62)'; rctx.fillRect(0, 0, img.width, img.height);
  rctx.restore();
  const [icon, ictx] = mkCanvas(48, 40);
  const sc = Math.min(46 / img.width, 38 / img.height);
  ictx.drawImage(img, (48 - img.width * sc) / 2, (40 - img.height * sc) / 2, img.width * sc, img.height * sc);
  void S;
  return { img, done, ruin, icon };
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

export const SHEET_W = 64;

/** Cut a normalised 4x3 sheet into frames; enemies get a colour wash so sides are easy to tell apart. */
function unitFromSheet(sheet: HTMLImageElement, ownerCol: string, owner: number): HTMLCanvasElement[][] {
  const out: HTMLCanvasElement[][] = [];
  const cw = sheet.width / 3, ch = sheet.height / 4;
  for (let dir = 0; dir < 4; dir++) {
    const frames: HTMLCanvasElement[] = [];
    for (let f = 0; f < 3; f++) {
      const [c, ctx] = mkCanvas(cw, ch);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sheet, f * cw, dir * ch, cw, ch, 0, 0, cw, ch);
      // team colour: a light wash for non-player owners
      ctx.globalCompositeOperation = 'source-atop';
      if (owner !== 1) { ctx.fillStyle = ownerCol; ctx.globalAlpha = 0.28; ctx.fillRect(0, 0, cw, ch); ctx.globalAlpha = 1; }
      ctx.globalCompositeOperation = 'source-over';
      frames.push(c);
    }
    out.push(frames);
  }
  return out;
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

