// ---- Canvas renderer: textured terrain with blended edges, image houses, procedural units ----
import { HOUSE_DEFS, UNIT_DEFS, PLAYER_COLORS } from './defs';
import type { HouseType } from './defs';
import { Obj, Terrain, idx, inBounds } from './map';
import type { Game } from './sim';
import type { House, Unit } from './state';
import { TILE, dir4, mkCanvas } from './sprites';
import type { Sprites } from './sprites';
import type { Assets } from './assets';

export interface Placement { kind: 'house' | 'road' | 'field' | 'wine' | 'demolish' | null; house?: HouseType; x: number; y: number; ok: boolean; }
export interface Selection { house: House | null; units: Unit[]; groups: number[]; }

const TEX_SIZE = 480; // texture images are 480px square
// source pixels per tile: larger = finer detail (must divide TEX_SIZE)
const TEX_SCALE: Record<string, number> = { grass: 80, road: 96, water: 60, rock: 60, dirt: 80, sand: 80, cornyoung: 48, cornripe: 48, vine: 48, plough: 60 };
const UNIT_SCALE = 1.25;

// blending priority: higher bleeds over lower
const PRIO: Record<number, number> = { [Terrain.Grass]: 1, [Terrain.Dirt]: 2, [Terrain.Snow]: 2.5, [Terrain.Mountain]: 3, [Terrain.Sand]: 4, [Terrain.Water]: 5 };
const ROAD_PRIO = 6;

function hash(x: number, y: number, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

export class Renderer {
  ctx: CanvasRenderingContext2D;
  cam = { x: 0, y: 0 };
  zoom = 1;
  staticLayer: HTMLCanvasElement;
  sctx: CanvasRenderingContext2D;
  tmp: HTMLCanvasElement; tctx: CanvasRenderingContext2D;
  frame = 0;
  dragRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  hoverTile = { x: -1, y: -1 };
  shade: Float32Array = new Float32Array(0);
  fogCanvas: HTMLCanvasElement; fogCtx: CanvasRenderingContext2D;   // 1 px per tile, alpha = unexplored
  fogSoft: HTMLCanvasElement; fogSoftCtx: CanvasRenderingContext2D; // blurred copy for soft edges
  fogEnabled = true;

  constructor(public canvas: HTMLCanvasElement, public g: Game, public S: Sprites, public A: Assets) {
    this.ctx = canvas.getContext('2d')!;
    this.staticLayer = document.createElement('canvas');
    this.sctx = this.staticLayer.getContext('2d')!;
    [this.tmp, this.tctx] = mkCanvas(TILE, TILE);
    [this.fogCanvas, this.fogCtx] = mkCanvas(1, 1);
    [this.fogSoft, this.fogSoftCtx] = mkCanvas(1, 1);
    this.setGame(g);
  }

  setGame(g: Game) {
    this.g = g;
    this.staticLayer.width = g.map.w * TILE; this.staticLayer.height = g.map.h * TILE;
    // low-frequency shade map to break texture repetition
    const m = g.map; this.shade = new Float32Array(m.w * m.h);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const n = (this.vnoise(x / 6, y / 6, 1) * 0.6 + this.vnoise(x / 2.5, y / 2.5, 2) * 0.4);
      this.shade[y * m.w + x] = n;
    }
    this.buildStatic();
    const F = 3; // fog resolution: 3 px per tile
    this.fogCanvas.width = m.w * F; this.fogCanvas.height = m.h * F;
    this.fogSoft.width = m.w * F; this.fogSoft.height = m.h * F;
    g.fogChanged = true;
    this.rebuildFog();
  }

  rebuildFog() {
    const m = this.g.map, F = 3;
    const ctx = this.fogCtx;
    ctx.clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
    ctx.fillStyle = '#05070a';
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (!m.fog[y * m.w + x]) ctx.fillRect(x * F, y * F, F, F);
    const sc = this.fogSoftCtx;
    sc.clearRect(0, 0, this.fogSoft.width, this.fogSoft.height);
    sc.filter = 'blur(2px)';
    sc.drawImage(this.fogCanvas, 0, 0);
    sc.filter = 'none';
    // a second, harder pass keeps the deep interior fully opaque
    sc.globalAlpha = 0.85; sc.drawImage(this.fogCanvas, 0, 0); sc.globalAlpha = 1;
    this.g.fogChanged = false;
  }

  explored(x: number, y: number) { return !this.fogEnabled || (inBounds(this.g.map, x, y) && this.g.map.fog[idx(this.g.map, x, y)] === 1); }

  vnoise(x: number, y: number, s: number) {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const sm = (t: number) => t * t * (3 - 2 * t);
    const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
    return (a * (1 - sm(tx)) + b * sm(tx)) * (1 - sm(ty)) + (c * (1 - sm(tx)) + d * sm(tx)) * sm(ty);
  }

  buildStatic() { for (let y = 0; y < this.g.map.h; y++) for (let x = 0; x < this.g.map.w; x++) this.drawTile(x, y); }

  /** Draw a texture tile (wrapping every TEX_TILES tiles) into ctx at (px,py). */
  tex(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, px: number, py: number) {
    const img = this.A.tex[name];
    if (!img) { ctx.fillStyle = name === 'water' ? '#2f6fb0' : name === 'rock' ? '#8a8a86' : name === 'sand' ? '#d8c88a' : name === 'road' ? '#a89468' : name === 'dirt' ? '#8c7a4e' : '#5f9a3c'; ctx.fillRect(px, py, TILE, TILE); return; }
    const s = TEX_SCALE[name] ?? 40, n = TEX_SIZE / s;
    const sx = (((x % n) + n) % n) * s, sy = (((y % n) + n) % n) * s;
    ctx.drawImage(img, sx, sy, s, s, px, py, TILE, TILE);
  }

  /** Effective terrain priority + texture of a tile for blending purposes. */
  surface(x: number, y: number): { prio: number; tex: string } {
    const m = this.g.map;
    if (!inBounds(m, x, y)) return { prio: 0, tex: 'grass' };
    const i = idx(m, x, y);
    const o = m.obj[i];
    if (o === Obj.Road) return { prio: ROAD_PRIO, tex: 'road' };
    const t = m.terrain[i];
    return { prio: PRIO[t] ?? 1, tex: t === Terrain.Water ? 'water' : t === Terrain.Mountain ? 'rock' : t === Terrain.Sand ? 'sand' : t === Terrain.Dirt ? 'dirt' : t === Terrain.Snow ? 'sand' : 'grass' };
  }

  blendEdge(x: number, y: number, tex: string, mask: HTMLCanvasElement, px: number, py: number) {
    const t = this.tctx;
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, TILE, TILE);
    this.tex(t, tex, x, y, 0, 0);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(mask, 0, 0);
    t.globalCompositeOperation = 'source-over';
    this.sctx.drawImage(this.tmp, px, py);
  }

  drawTile(x: number, y: number) {
    const m = this.g.map, ctx = this.sctx, A = this.A;
    const i = idx(m, x, y);
    const px = x * TILE, py = y * TILE;
    const o = m.obj[i], d = m.data[i];
    const me = this.surface(x, y);
    ctx.globalAlpha = 1;
    // base
    if (o === Obj.Field || o === Obj.WineField || o === Obj.FieldPlan || o === Obj.WinePlan || o === Obj.RoadPlan) this.tex(ctx, me.tex, x, y, px, py);
    else this.tex(ctx, me.tex, x, y, px, py);
    // neighbour blending
    if (o !== Obj.Field && o !== Obj.WineField) {
      const n = [this.surface(x, y - 1), this.surface(x + 1, y), this.surface(x, y + 1), this.surface(x - 1, y)];
      for (let k = 0; k < 4; k++) if (n[k].prio > me.prio) this.blendEdge(x, y, n[k].tex, this.S.masks.edge[k], px, py);
      const diag = [this.surface(x + 1, y - 1), this.surface(x + 1, y + 1), this.surface(x - 1, y + 1), this.surface(x - 1, y - 1)];
      const adj = [[0, 1], [1, 2], [2, 3], [3, 0]];
      for (let k = 0; k < 4; k++) {
        const dg = diag[k];
        if (dg.prio > me.prio && n[adj[k][0]].prio < dg.prio && n[adj[k][1]].prio < dg.prio) this.blendEdge(x, y, dg.tex, this.S.masks.corner[k], px, py);
      }
    }
    // fields
    if (o === Obj.Field || o === Obj.WineField) {
      const wine = o === Obj.WineField;
      if (d === 0) { if (A.tex.plough) this.tex(ctx, 'plough', x, y, px, py); else { this.tex(ctx, 'dirt', x, y, px, py); ctx.fillStyle = 'rgba(40,25,10,0.35)'; for (let yy = 3; yy < TILE; yy += 8) ctx.fillRect(px, py + yy, TILE, 3); } }
      else if (wine) this.tex(ctx, 'vine', x, y, px, py);
      else {
        this.tex(ctx, 'cornyoung', x, y, px, py);
        if (d >= 4) { ctx.globalAlpha = d >= 6 ? 1 : (d - 3) / 3; this.tex(ctx, 'cornripe', x, y, px, py); ctx.globalAlpha = 1; }
        if (d >= 1 && d < 4) { ctx.globalAlpha = 1 - d / 4; if (A.tex.plough) this.tex(ctx, 'plough', x, y, px, py); ctx.globalAlpha = 1; }
      }
      ctx.strokeStyle = 'rgba(40,30,15,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
    }
    // plans and digging
    if (o === Obj.RoadPlan || o === Obj.WinePlan || o === Obj.FieldPlan) {
      const dug = o === Obj.FieldPlan ? d / 40 : Math.min(1, d / 20);
      if (dug > 0) { ctx.globalAlpha = dug; this.tex(ctx, 'dirt', x, y, px, py); ctx.globalAlpha = 1; }
      if (o !== Obj.FieldPlan && d > 21) { ctx.globalAlpha = (d - 21) / 19; this.tex(ctx, o === Obj.RoadPlan ? 'road' : 'vine', x, y, px, py); ctx.globalAlpha = 1; }
      ctx.strokeStyle = o === Obj.RoadPlan ? 'rgba(240,230,190,0.9)' : o === Obj.FieldPlan ? 'rgba(240,215,90,0.9)' : 'rgba(215,150,230,0.9)';
      ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.strokeRect(px + 3, py + 3, TILE - 6, TILE - 6); ctx.setLineDash([]);
    }
    // ore deposits
    if (o === Obj.Coal || o === Obj.Iron || o === Obj.Gold) {
      if (d > 0) {
        ctx.fillStyle = o === Obj.Coal ? '#141414' : o === Obj.Iron ? '#b8683a' : '#f0c830';
        for (let k = 0; k < 9; k++) { const hx = hash(x, y, k), hy = hash(y, x, k + 50); ctx.beginPath(); ctx.ellipse(px + 4 + hx * (TILE - 8), py + 4 + hy * (TILE - 8), 2.5 + hash(x, y, k + 9) * 2, 2 + hash(x, y, k + 19) * 1.5, 0, 0, Math.PI * 2); ctx.fill(); }
        if (o === Obj.Gold) { ctx.fillStyle = 'rgba(255,255,220,0.8)'; for (let k = 0; k < 4; k++) ctx.fillRect(px + 6 + hash(x, y, k + 70) * (TILE - 12), py + 6 + hash(y, x, k + 80) * (TILE - 12), 2, 2); }
      }
    }
    // small objects
    const obj = (name: string, w: number) => { const img = A.objs[name]; if (!img) return; const h = img.height * (w / img.width); ctx.drawImage(img, px + (TILE - w) / 2, py + TILE - h - 2, w, h); };
    if (o === Obj.Stump) obj('stump', 22);
    else if (o === Obj.Bush) obj('bush', 30);
    else if (o === Obj.Rock) obj('boulder', 30);
    else if (o === Obj.Sapling) obj('sapling', 16 + (d / 255) * 8);
    // shading to break repetition (skip fields/roads)
    if (o !== Obj.Field && o !== Obj.WineField && o !== Obj.Road) {
      const sh = this.shade[i];
      if (sh < 0.42) { ctx.fillStyle = `rgba(20,40,10,${(0.42 - sh) * 0.45})`; ctx.fillRect(px, py, TILE, TILE); }
      else if (sh > 0.62) { ctx.fillStyle = `rgba(255,250,200,${(sh - 0.62) * 0.3})`; ctx.fillRect(px, py, TILE, TILE); }
    }
    // cliff shadow at the foot of mountains, shore foam on water
    const t = m.terrain[i];
    if (t !== Terrain.Mountain && t !== Terrain.Water && y > 0 && m.terrain[idx(m, x, y - 1)] === Terrain.Mountain) { const gr = ctx.createLinearGradient(0, py, 0, py + 12); gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.fillRect(px, py, TILE, 12); }
    if (t === Terrain.Water) {
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        if (inBounds(m, x + dx, y + dy) && m.terrain[idx(m, x + dx, y + dy)] !== Terrain.Water) {
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          if (dy === -1) ctx.fillRect(px, py, TILE, 3); else if (dy === 1) ctx.fillRect(px, py + TILE - 3, TILE, 3); else if (dx === -1) ctx.fillRect(px, py, 3, TILE); else ctx.fillRect(px + TILE - 3, py, 3, TILE);
        }
      }
    }
  }

  flushDirty() {
    const m = this.g.map;
    if (!this.g.dirtyTiles.length) return;
    const set = new Set<number>();
    for (const i of this.g.dirtyTiles) { const x = i % m.w, y = (i / m.w) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < m.w && yy < m.h) set.add(idx(m, xx, yy)); } }
    this.g.dirtyTiles.length = 0;
    for (const i of set) this.drawTile(i % m.w, (i / m.w) | 0);
  }

  screenToWorld(sx: number, sy: number) { return { x: (sx / this.zoom + this.cam.x) / TILE, y: (sy / this.zoom + this.cam.y) / TILE }; }
  screenToTile(sx: number, sy: number) { const w = this.screenToWorld(sx, sy); return { x: Math.floor(w.x), y: Math.floor(w.y) }; }
  centerOn(tx: number, ty: number) { this.cam.x = tx * TILE - this.canvas.width / this.zoom / 2; this.cam.y = ty * TILE - this.canvas.height / this.zoom / 2; this.clampCam(); }
  clampCam() {
    const vw = this.canvas.width / this.zoom, vh = this.canvas.height / this.zoom;
    this.cam.x = Math.max(0, Math.min(this.g.map.w * TILE - vw, this.cam.x));
    this.cam.y = Math.max(0, Math.min(this.g.map.h * TILE - vh, this.cam.y));
    if (this.g.map.w * TILE < vw) this.cam.x = (this.g.map.w * TILE - vw) / 2;
    if (this.g.map.h * TILE < vh) this.cam.y = (this.g.map.h * TILE - vh) / 2;
  }

  render(sel: Selection, place: Placement, showTerritory: boolean) {
    this.frame++;
    this.flushDirty();
    const ctx = this.ctx, g = this.g, S = this.S, m = g.map, A = this.A;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#10161c'; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(this.zoom, 0, 0, this.zoom, 0, 0);
    ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y));
    ctx.imageSmoothingEnabled = true;
    const vw = W / this.zoom, vh = H / this.zoom;
    const x0 = Math.max(0, Math.floor(this.cam.x / TILE)), y0 = Math.max(0, Math.floor(this.cam.y / TILE));
    const x1 = Math.min(m.w - 1, Math.ceil((this.cam.x + vw) / TILE)), y1 = Math.min(m.h - 1, Math.ceil((this.cam.y + vh) / TILE));
    ctx.drawImage(this.staticLayer, x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE, x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
    // water shimmer
    if (A.tex.water) {
      const s = TEX_SCALE.water, n = TEX_SIZE / s;
      const off = (this.frame * 0.4) % TEX_SIZE;
      ctx.globalAlpha = 0.35;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (m.terrain[idx(m, x, y)] === Terrain.Water) {
        const sx = ((((x % n) + n) % n) * s + off) % TEX_SIZE;
        const w1 = Math.min(s, TEX_SIZE - sx);
        const sy = (((y % n) + n) % n) * s;
        ctx.drawImage(A.tex.water, sx, sy, w1, s, x * TILE, y * TILE, w1 * TILE / s, TILE);
        if (w1 < s) ctx.drawImage(A.tex.water, 0, sy, s - w1, s, x * TILE + w1 * TILE / s, y * TILE, (s - w1) * TILE / s, TILE);
      }
      ctx.globalAlpha = 1;
    }
    if (showTerritory) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const o = m.owner[idx(m, x, y)]; if (o) { ctx.fillStyle = PLAYER_COLORS[o]; ctx.globalAlpha = 0.12; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); } }
      ctx.globalAlpha = 1;
    }
    // tile placement ghost
    if (place.kind && place.kind !== 'house' && place.x >= 0) {
      if (place.kind !== 'demolish') { ctx.globalAlpha = 0.6; this.tex(ctx, place.kind === 'road' ? 'road' : place.kind === 'field' ? 'cornripe' : 'vine', place.x, place.y, place.x * TILE, place.y * TILE); ctx.globalAlpha = 1; }
      ctx.strokeStyle = place.ok ? '#40ff60' : '#ff4040'; ctx.lineWidth = 2; ctx.strokeRect(place.x * TILE + 1, place.y * TILE + 1, TILE - 2, TILE - 2);
    }
    // selection marks
    for (const u of sel.units) { if (u.dead || u.inHouse >= 0) continue; ctx.strokeStyle = '#f0f0a0'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(u.x * TILE + TILE / 2, u.y * TILE + TILE - 4, 12, 6, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (sel.house && sel.house.state !== 'destroyed') { const d = HOUSE_DEFS[sel.house.type]; ctx.strokeStyle = '#f0f0a0'; ctx.lineWidth = 2; ctx.strokeRect(sel.house.x * TILE + 1, sel.house.y * TILE + 1, d.w * TILE - 2, d.h * TILE - 2); }
    // dynamic drawables sorted by y
    type D = { y: number; draw: () => void };
    const list: D[] = [];
    for (let y = Math.max(0, y0 - 1); y <= Math.min(m.h - 1, y1 + 2); y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (!inBounds(m, x, y)) continue;
      const i = idx(m, x, y);
      if (m.obj[i] === Obj.Tree && this.explored(x, y)) list.push({ y: y + 0.95, draw: () => this.drawTree(x, y, m.data[i]) });
    }
    for (const h of g.s.houses) {
      const d = HOUSE_DEFS[h.type];
      if (h.x + d.w < x0 - 1 || h.x > x1 + 1 || h.y + d.h < y0 - 2 || h.y > y1 + 3) continue;
      if (!this.explored(h.x + (d.w >> 1), h.y + (d.h >> 1))) continue;
      list.push({ y: h.y + d.h - 0.6, draw: () => this.drawHouse(h) });
    }
    for (const u of g.s.units) {
      if (u.inHouse >= 0) continue;
      if (u.x < x0 - 1 || u.x > x1 + 1 || u.y < y0 - 1 || u.y > y1 + 1) continue;
      if (!this.explored(Math.round(u.x), Math.round(u.y))) continue;
      list.push({ y: u.y + 0.5, draw: () => this.drawUnit(u, sel) });
    }
    for (const p of g.s.projectiles) {
      if (!this.explored(Math.round(p.tx), Math.round(p.ty))) continue;
      const t = p.t / p.dur;
      const x = p.sx + (p.tx - p.sx) * t, y = p.sy + (p.ty - p.sy) * t - Math.sin(t * Math.PI) * (p.kind === 'stone' ? 2.2 : 1.2);
      list.push({ y: y + 2, draw: () => {
        const px = x * TILE + TILE / 2, py = y * TILE + TILE / 2;
        if (p.kind === 'stone') { ctx.fillStyle = '#9a9a96'; ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill(); }
        else { const a = Math.atan2(p.ty - p.sy, p.tx - p.sx); ctx.strokeStyle = p.kind === 'bolt' ? '#d8d8d8' : '#e8d0a0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px - Math.cos(a) * 7, py - Math.sin(a) * 7); ctx.lineTo(px + Math.cos(a) * 7, py + Math.sin(a) * 7); ctx.stroke(); }
      } });
    }
    for (const f of g.s.fx) list.push({ y: f.y + 3, draw: () => {
      const px = f.x * TILE + TILE / 2, py = f.y * TILE + TILE / 2;
      if (f.kind === 'hit') { ctx.fillStyle = `rgba(255,${200 - f.t * 8},80,${1 - f.t / 20})`; ctx.beginPath(); ctx.arc(px, py - 12, 3 + f.t * 0.5, 0, Math.PI * 2); ctx.fill(); }
      else if (f.kind === 'dust') { ctx.fillStyle = `rgba(200,180,140,${0.6 - f.t / 40})`; ctx.beginPath(); ctx.arc(px, py - f.t, 4 + f.t * 0.6, 0, Math.PI * 2); ctx.fill(); }
      else if (f.kind === 'chop') { ctx.fillStyle = `rgba(230,200,140,${1 - f.t / 20})`; for (let k = 0; k < 3; k++) ctx.fillRect(px - 6 + k * 6 + f.t * (k - 1) * 0.5, py - 4 - f.t * 0.8, 3, 2); }
      else if (f.kind === 'smoke') { for (let k = 0; k < 4; k++) { const tt = (f.t + k * 30) % 120; ctx.fillStyle = `rgba(60,50,40,${0.5 * (1 - tt / 120)})`; ctx.beginPath(); ctx.arc(px + Math.sin((tt + k * 40) / 15) * 6, py - tt * 0.4, 6 + tt * 0.1, 0, Math.PI * 2); ctx.fill(); } }
    } });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();
    // fog of war
    if (this.fogEnabled) {
      if (g.fogChanged) this.rebuildFog();
      const F = 3;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogSoft, x0 * F, y0 * F, (x1 - x0 + 1) * F, (y1 - y0 + 1) * F, x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
    }
    // house ghost
    if (place.kind === 'house' && place.house && place.x >= 0) {
      const d = HOUSE_DEFS[place.house];
      ctx.globalAlpha = 0.65;
      this.drawHouseImage(place.house, place.x, place.y, this.S.houses[place.house].done);
      ctx.globalAlpha = 1;
      ctx.fillStyle = place.ok ? 'rgba(60,255,90,0.25)' : 'rgba(255,60,60,0.35)';
      ctx.fillRect(place.x * TILE, place.y * TILE, d.w * TILE, d.h * TILE);
      ctx.strokeStyle = place.ok ? '#40ff60' : '#ff4040'; ctx.lineWidth = 2; ctx.strokeRect(place.x * TILE + 1, place.y * TILE + 1, d.w * TILE - 2, d.h * TILE - 2);
      ctx.fillStyle = 'rgba(255,230,120,0.5)'; ctx.fillRect((place.x + d.entrance) * TILE, (place.y + d.h) * TILE, TILE, TILE);
    }
    if (place.kind === 'demolish' && place.x >= 0) { ctx.strokeStyle = '#ff4040'; ctx.lineWidth = 2; ctx.strokeRect(place.x * TILE + 2, place.y * TILE + 2, TILE - 4, TILE - 4); }
    if (this.dragRect) { const r = this.dragRect; ctx.strokeStyle = '#f0f0a0'; ctx.lineWidth = 1; ctx.strokeRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0)); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawTree(x: number, y: number, growth: number) {
    const ctx = this.ctx, trees = this.A.trees;
    const px = x * TILE, py = y * TILE;
    const sc = (0.55 + 0.45 * (growth / 255)) * 1.15;
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(px + TILE / 2 + 3, py + TILE - 5, 14 * sc, 6 * sc, 0, 0, Math.PI * 2); ctx.fill();
    if (!trees.length) { ctx.fillStyle = '#2f6a2a'; ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2 - 8 * sc, 16 * sc, 0, Math.PI * 2); ctx.fill(); return; }
    const v = Math.floor(hash(x, y, 7) * trees.length);
    const img = trees[v];
    const w = img.width / 2 * sc, h = img.height / 2 * sc;
    const flip = hash(x, y, 8) > 0.5;
    if (flip) { ctx.save(); ctx.translate(px + TILE, 0); ctx.scale(-1, 1); ctx.drawImage(img, (TILE - w) / 2, py + TILE - h - 2, w, h); ctx.restore(); }
    else ctx.drawImage(img, px + (TILE - w) / 2, py + TILE - h - 2, w, h);
  }

  /** Draw a house image (2x resolution) aligned to the bottom of the footprint. */
  drawHouseImage(type: HouseType, hx: number, hy: number, img: CanvasImageSource & { width: number; height: number }, clipFrac = 1) {
    const d = HOUSE_DEFS[type];
    const W = d.w * TILE, H = d.h * TILE;
    const dw = img.width / 2, dh = img.height / 2;
    const px = hx * TILE + (W - dw) / 2, py = hy * TILE + H - dh + 6;
    if (clipFrac >= 1) { this.ctx.drawImage(img, px, py, dw, dh); return; }
    const sh = img.height * clipFrac;
    this.ctx.drawImage(img, 0, img.height - sh, img.width, sh, px, py + dh - sh / 2, dw, sh / 2);
  }

  drawHouse(h: House) {
    const ctx = this.ctx, S = this.S, d = HOUSE_DEFS[h.type];
    const art = S.houses[h.type];
    const px = h.x * TILE, py = h.y * TILE, W = d.w * TILE, H = d.h * TILE;
    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(px + W / 2 + 4, py + H - 4, W * 0.55, H * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    if (h.state === 'destroyed') { this.drawHouseImage(h.type, h.x, h.y, art.ruin); return; }
    if (h.state === 'building') {
      const f = h.progress / d.buildTime;
      // foundation
      this.sctx; ctx.fillStyle = '#7a6748'; ctx.fillRect(px + 2, py + 4, W - 4, H - 6);
      ctx.strokeStyle = '#4a3a22'; ctx.lineWidth = 3; ctx.strokeRect(px + 4, py + 6, W - 8, H - 10);
      if (f < 0.15) {
        ctx.drawImage(S.wares.wood, px + W / 2 - 18, py + H / 2 - 8, 16, 16); ctx.drawImage(S.wares.stone, px + W / 2 + 2, py + H / 2 - 8, 16, 16);
      } else {
        const reveal = Math.min(1, (f - 0.15) / 0.8);
        this.drawHouseImage(h.type, h.x, h.y, art.done, reveal);
        // scaffolding
        const dh = art.done.height / 2; const top = py + H + 6 - dh * reveal;
        ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 2;
        for (let sx = px + 6; sx < px + W; sx += 18) { ctx.beginPath(); ctx.moveTo(sx, py + H); ctx.lineTo(sx, Math.min(py + H - 4, top - 6)); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(px + 2, top - 2); ctx.lineTo(px + W - 2, top - 2); ctx.stroke();
      }
      const bw = W - 8;
      ctx.fillStyle = '#000'; ctx.fillRect(px + 4, py + H - 6, bw, 4);
      ctx.fillStyle = '#e0c040'; ctx.fillRect(px + 4, py + H - 6, bw * f, 4);
      return;
    }
    this.drawHouseImage(h.type, h.x, h.y, art.done);
    const topY = py + H + 6 - art.done.height / 2;
    if (h.working && (d.recipes || d.special === 'mine')) {
      for (let k = 0; k < 3; k++) {
        const t = ((h.anim + k * 20) % 60) / 60;
        ctx.fillStyle = `rgba(120,120,120,${0.45 * (1 - t)})`;
        ctx.beginPath(); ctx.arc(px + W * 0.72 + Math.sin((h.anim + k * 20) / 9) * 3, topY + 6 - t * 22, 3 + t * 5, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (d.worker && h.workerId < 0 && (this.frame % 60) < 40) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(px + W / 2 - 8, topY - 6, 16, 16); ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', px + W / 2, topY + 6); }
    if (d.special === 'mine' && h.depleted) { ctx.fillStyle = '#ff5050'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('EMPTY', px + W / 2, topY + 4); }
    if (h.hp < d.hp && this.g.s.tick - h.lastAttackTick < 150) {
      const bw = W - 8;
      ctx.fillStyle = '#000'; ctx.fillRect(px + 4, topY - 2, bw, 4);
      ctx.fillStyle = '#e04040'; ctx.fillRect(px + 4, topY - 2, bw * h.hp / d.hp, 4);
    }
    if (h.type === 'storehouse' || h.type === 'barracks' || h.type === 'watchtower') ctx.drawImage(S.flag[h.owner], px + 3, topY + ((this.frame >> 4) & 1), 10, 14);
  }

  drawUnit(u: Unit, sel: Selection) {
    const ctx = this.ctx, S = this.S;
    const frames = S.units[`${u.type}-${u.owner}`];
    if (!frames) return;
    const d = dir4(u.dir);
    const hd = S.hd && frames[0][0].width >= 48;
    const active = u.moving || (u.task.kind === 'work' && u.task.phase === 2) || (u.task.kind === 'buildHouse' && u.task.phase === 1) || (u.task.kind === 'buildTile' && u.task.phase === 1);
    const f = hd ? (active ? [0, 2][Math.floor(u.frame / 5) % 2] : 1) : (active ? [0, 1, 0, 2][Math.floor(u.frame / 4) % 4] : 0);
    const sw = hd ? frames[0][0].width / 2 * 1.15 : 24 * UNIT_SCALE, sh = hd ? frames[0][0].height / 2 * 1.15 : 32 * UNIT_SCALE;
    const px = u.x * TILE + TILE / 2 - sw / 2, py = u.y * TILE + TILE - sh + 2;
    ctx.imageSmoothingEnabled = hd;
    if (u.task.kind === 'die') {
      ctx.globalAlpha = Math.max(0, u.task.timer / 40);
      ctx.save(); ctx.translate(px + sw / 2, py + sh - 2); ctx.rotate(Math.PI / 2); ctx.drawImage(frames[0][0], -sw / 2, -sh, sw, sh); ctx.restore();
      ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true; return;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(px + sw / 2, py + sh - 1, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
    if (hd && u.task.kind === 'soldier') { ctx.strokeStyle = PLAYER_COLORS[u.owner]; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(px + sw / 2, py + sh - 1, 10, 4.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    if (u.hitFlash > 0 && (u.hitFlash & 1)) ctx.globalAlpha = 0.5;
    ctx.drawImage(frames[d][f], px, py, sw, sh);
    ctx.globalAlpha = 1;
    if (u.carry) ctx.drawImage(S.wares[u.carry], px + (d === 1 ? -4 : d === 3 ? sw - 12 : sw - 14), py + (hd ? 14 : 10), 18, 18);
    if (u.condition < 0.3 && u.owner === this.g.s.player && (this.frame % 40) < 25) ctx.drawImage(S.wares.bread, px + sw / 2 - 8, py - 14, 16, 16);
    if (u.hp < u.maxHp && (u.task.kind === 'soldier' || sel.units.includes(u))) {
      ctx.fillStyle = '#000'; ctx.fillRect(px + 3, py - 4, sw - 6, 3);
      ctx.fillStyle = u.hp / u.maxHp > 0.5 ? '#40d040' : u.hp / u.maxHp > 0.25 ? '#e0c040' : '#e04040'; ctx.fillRect(px + 3, py - 4, (sw - 6) * u.hp / u.maxHp, 3);
    }
    if (u.groupId >= 0) { const grp = this.g.group(u.groupId); if (grp && grp.units[0] === u.id) ctx.drawImage(S.flag[u.owner], px + sw - 2, py - 8, 10, 14); }
  }

  drawMinimap(mc: HTMLCanvasElement, mctx: CanvasRenderingContext2D) {
    const g = this.g, m = g.map;
    const sx = mc.width / m.w, sy = mc.height / m.h;
    const img = mctx.createImageData(m.w, m.h);
    const dat = img.data;
    for (let i = 0; i < m.w * m.h; i++) {
      const t = m.terrain[i], o = m.obj[i];
      let r = 90, gg = 150, b = 60;
      if (t === Terrain.Water) { r = 40; gg = 100; b = 180; } else if (t === Terrain.Mountain) { r = 130; gg = 130; b = 125; } else if (t === Terrain.Sand) { r = 210; gg = 200; b = 140; } else if (t === Terrain.Dirt) { r = 140; gg = 120; b = 80; }
      if (o === Obj.Tree) { r = 40; gg = 100; b = 40; } else if (o === Obj.Road) { r = 170; gg = 150; b = 100; } else if (o === Obj.Field || o === Obj.WineField) { r = 150; gg = 130; b = 60; }
      else if (o === Obj.Coal) { r = 30; gg = 30; b = 30; } else if (o === Obj.Iron) { r = 170; gg = 100; b = 60; } else if (o === Obj.Gold) { r = 230; gg = 190; b = 50; }
      const h = m.house[i];
      if (h >= 0) { const hh = g.house(h); if (hh && hh.state !== 'destroyed') { const c = PLAYER_COLORS[hh.owner]; r = parseInt(c.slice(1, 3), 16); gg = parseInt(c.slice(3, 5), 16); b = parseInt(c.slice(5, 7), 16); } }
      if (this.fogEnabled && !m.fog[i]) { r = 8; gg = 10; b = 14; }
      dat[i * 4] = r; dat[i * 4 + 1] = gg; dat[i * 4 + 2] = b; dat[i * 4 + 3] = 255;
    }
    const tmp = document.createElement('canvas'); tmp.width = m.w; tmp.height = m.h; tmp.getContext('2d')!.putImageData(img, 0, 0);
    mctx.imageSmoothingEnabled = false;
    mctx.clearRect(0, 0, mc.width, mc.height);
    mctx.drawImage(tmp, 0, 0, mc.width, mc.height);
    for (const u of g.s.units) { if (u.dead || u.inHouse >= 0 || !this.explored(Math.round(u.x), Math.round(u.y))) continue; mctx.fillStyle = u.task.kind === 'soldier' ? PLAYER_COLORS[u.owner] : '#ffffff'; mctx.fillRect(Math.floor(u.x * sx), Math.floor(u.y * sy), Math.max(1, sx), Math.max(1, sy)); }
    for (const msg of g.s.messages.slice(-5)) if (msg.kind === 'alert' && msg.x !== undefined && g.s.tick - msg.tick < 300 && (this.frame % 30) < 15) { mctx.strokeStyle = '#ff4040'; mctx.lineWidth = 2; mctx.strokeRect(msg.x! * sx - 4, msg.y! * sy - 4, 8, 8); }
    const vw = this.canvas.width / this.zoom / TILE, vh = this.canvas.height / this.zoom / TILE;
    mctx.strokeStyle = '#ffffff'; mctx.lineWidth = 1;
    mctx.strokeRect(this.cam.x / TILE * sx, this.cam.y / TILE * sy, vw * sx, vh * sy);
  }
}

export function unitName(u: Unit) { return UNIT_DEFS[u.type].name; }
