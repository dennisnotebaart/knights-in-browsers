// ---- Canvas renderer ----
import { HOUSE_DEFS, UNIT_DEFS, PLAYER_COLORS } from './defs';
import type { HouseType } from './defs';
import { Obj, Terrain, idx } from './map';
import type { Game } from './sim';
import type { House, Unit } from './state';
import { TILE, dir4 } from './sprites';
import type { Sprites } from './sprites';

export interface Placement { kind: 'house' | 'road' | 'field' | 'wine' | 'demolish' | null; house?: HouseType; x: number; y: number; ok: boolean; }
export interface Selection { house: House | null; units: Unit[]; groups: number[]; }

export class Renderer {
  ctx: CanvasRenderingContext2D;
  cam = { x: 0, y: 0 };
  zoom = 1;
  staticLayer: HTMLCanvasElement;
  sctx: CanvasRenderingContext2D;
  frame = 0;
  dragRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  hoverTile = { x: -1, y: -1 };

  constructor(public canvas: HTMLCanvasElement, public g: Game, public S: Sprites) {
    this.ctx = canvas.getContext('2d')!;
    this.staticLayer = document.createElement('canvas');
    this.staticLayer.width = g.map.w * TILE; this.staticLayer.height = g.map.h * TILE;
    this.sctx = this.staticLayer.getContext('2d')!;
    this.buildStatic();
  }

  setGame(g: Game) { this.g = g; this.staticLayer.width = g.map.w * TILE; this.staticLayer.height = g.map.h * TILE; this.buildStatic(); }

  buildStatic() { for (let y = 0; y < this.g.map.h; y++) for (let x = 0; x < this.g.map.w; x++) this.drawTile(x, y); }

  drawTile(x: number, y: number) {
    const m = this.g.map, S = this.S, ctx = this.sctx;
    const i = idx(m, x, y);
    const t = m.terrain[i];
    const px = x * TILE, py = y * TILE;
    const v = ((x * 7 + y * 13) ^ (x * y)) & 3;
    if (t === Terrain.Water) ctx.drawImage(S.water[0], px, py);
    else ctx.drawImage(S.terrain[t][v], px, py);
    // soften terrain edges: blend towards neighbours of a different type (cheap: draw a darker edge)
    const o = m.obj[i];
    const d = m.data[i];
    switch (o) {
      case Obj.Road: ctx.drawImage(S.road, px, py); this.roadEdges(x, y); break;
      case Obj.RoadPlan: case Obj.WinePlan:
        if (d > 0 && d < 20) { ctx.globalAlpha = d / 20; ctx.drawImage(S.roadDig, px, py); ctx.globalAlpha = 1; }
        else if (d >= 20) { ctx.drawImage(S.roadDig, px, py); if (d > 21) { ctx.globalAlpha = (d - 21) / 19; ctx.drawImage(o === Obj.RoadPlan ? S.road : S.wine[0], px, py); ctx.globalAlpha = 1; } }
        ctx.drawImage(o === Obj.RoadPlan ? S.roadPlan : S.winePlan, px, py); break;
      case Obj.FieldPlan:
        if (d > 0) { ctx.globalAlpha = d / 40; ctx.drawImage(S.field[0], px, py); ctx.globalAlpha = 1; }
        ctx.drawImage(S.fieldPlan, px, py); break;
      case Obj.Field: ctx.drawImage(S.field[Math.min(6, d)], px, py); break;
      case Obj.WineField: ctx.drawImage(S.wine[Math.min(6, d)], px, py); break;
      case Obj.Coal: ctx.drawImage(d > 0 ? S.ore.coal : S.terrain[Terrain.Mountain][v], px, py); break;
      case Obj.Iron: ctx.drawImage(d > 0 ? S.ore.iron : S.terrain[Terrain.Mountain][v], px, py); break;
      case Obj.Gold: ctx.drawImage(d > 0 ? S.ore.gold : S.terrain[Terrain.Mountain][v], px, py); break;
      case Obj.Stump: ctx.drawImage(S.stump, px, py); break;
      case Obj.Bush: ctx.drawImage(S.bush, px, py); break;
      case Obj.Rock: ctx.drawImage(S.rock, px, py); break;
      case Obj.Sapling: ctx.drawImage(S.sapling, px, py); break;
    }
    if (t === Terrain.Mountain && o === Obj.None) { // ridge shading at grass border
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      if (y + 1 < m.h && m.terrain[idx(m, x, y + 1)] !== Terrain.Mountain) ctx.fillRect(px, py + TILE - 4, TILE, 4);
    }
    if (t === Terrain.Water) { ctx.fillStyle = 'rgba(255,255,255,0.10)'; if (y > 0 && m.terrain[idx(m, x, y - 1)] !== Terrain.Water) ctx.fillRect(px, py, TILE, 3); }
  }

  roadEdges(x: number, y: number) {
    const m = this.g.map, ctx = this.sctx;
    const isR = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < m.w && yy < m.h && (m.obj[idx(m, xx, yy)] === Obj.Road || m.house[idx(m, xx, yy)] >= 0);
    ctx.fillStyle = '#8a7a50';
    const px = x * TILE, py = y * TILE;
    if (!isR(x, y - 1)) ctx.fillRect(px, py, TILE, 2);
    if (!isR(x, y + 1)) ctx.fillRect(px, py + TILE - 2, TILE, 2);
    if (!isR(x - 1, y)) ctx.fillRect(px, py, 2, TILE);
    if (!isR(x + 1, y)) ctx.fillRect(px + TILE - 2, py, 2, TILE);
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
  centerOn(tx: number, ty: number) {
    this.cam.x = tx * TILE - this.canvas.width / this.zoom / 2; this.cam.y = ty * TILE - this.canvas.height / this.zoom / 2; this.clampCam();
  }
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
    const ctx = this.ctx, g = this.g, S = this.S, m = g.map;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#10161c'; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(this.zoom, 0, 0, this.zoom, 0, 0);
    ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y));
    const vw = W / this.zoom, vh = H / this.zoom;
    const x0 = Math.max(0, Math.floor(this.cam.x / TILE)), y0 = Math.max(0, Math.floor(this.cam.y / TILE));
    const x1 = Math.min(m.w - 1, Math.ceil((this.cam.x + vw) / TILE)), y1 = Math.min(m.h - 1, Math.ceil((this.cam.y + vh) / TILE));
    // static
    ctx.drawImage(this.staticLayer, x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE, x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
    // animated water
    const wf = Math.floor(this.frame / 20) % 3;
    if (wf !== 0) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (m.terrain[idx(m, x, y)] === Terrain.Water) ctx.drawImage(S.water[wf], x * TILE, y * TILE);
    // territory
    if (showTerritory) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const o = m.owner[idx(m, x, y)]; if (o) { ctx.fillStyle = PLAYER_COLORS[o]; ctx.globalAlpha = 0.12; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); } }
      ctx.globalAlpha = 1;
    }
    // placement ghost for tiles
    if (place.kind && place.kind !== 'house' && place.x >= 0) {
      ctx.globalAlpha = 0.6;
      const spr = place.kind === 'road' ? S.road : place.kind === 'field' ? S.field[3] : place.kind === 'wine' ? S.wine[5] : null;
      if (spr) ctx.drawImage(spr, place.x * TILE, place.y * TILE);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = place.ok ? '#40ff60' : '#ff4040'; ctx.lineWidth = 2; ctx.strokeRect(place.x * TILE + 1, place.y * TILE + 1, TILE - 2, TILE - 2);
    }
    // selection marks under units
    for (const u of sel.units) { if (u.dead || u.inHouse >= 0) continue; ctx.strokeStyle = '#f0f0a0'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(u.x * TILE + TILE / 2, u.y * TILE + TILE - 4, 10, 5, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (sel.house && sel.house.state !== 'destroyed') { const d = HOUSE_DEFS[sel.house.type]; ctx.strokeStyle = '#f0f0a0'; ctx.lineWidth = 2; ctx.strokeRect(sel.house.x * TILE + 1, sel.house.y * TILE + 1, d.w * TILE - 2, d.h * TILE - 2); }
    // dynamic drawables
    type D = { y: number; draw: () => void };
    const list: D[] = [];
    // trees
    for (let y = Math.max(0, y0 - 1); y <= Math.min(m.h - 1, y1 + 1); y++) for (let x = x0; x <= x1; x++) {
      const i = idx(m, x, y);
      if (m.obj[i] === Obj.Tree) { const v = (x * 3 + y * 5) % 3; const sc = 0.5 + 0.5 * (m.data[i] / 255); list.push({ y: y + 0.9, draw: () => { const spr = S.tree[v]; const h = spr.height * sc, w = spr.width * sc; ctx.drawImage(spr, x * TILE + (TILE - w) / 2, y * TILE + TILE - h + 2, w, h); } }); }
    }
    // houses
    for (const h of g.s.houses) {
      const d = HOUSE_DEFS[h.type];
      if (h.x + d.w < x0 || h.x > x1 + 1 || h.y + d.h < y0 - 1 || h.y > y1 + 1) continue;
      list.push({ y: h.y + d.h - 0.6, draw: () => this.drawHouse(h) });
    }
    // units
    for (const u of g.s.units) {
      if (u.inHouse >= 0) continue;
      if (u.x < x0 - 1 || u.x > x1 + 1 || u.y < y0 - 1 || u.y > y1 + 1) continue;
      list.push({ y: u.y + 0.5, draw: () => this.drawUnit(u, sel) });
    }
    // projectiles
    for (const p of g.s.projectiles) {
      const t = p.t / p.dur;
      const x = p.sx + (p.tx - p.sx) * t, y = p.sy + (p.ty - p.sy) * t - Math.sin(t * Math.PI) * (p.kind === 'stone' ? 2.2 : 1.2);
      list.push({ y: y + 2, draw: () => {
        const px = x * TILE + TILE / 2, py = y * TILE + TILE / 2;
        if (p.kind === 'stone') { ctx.fillStyle = '#9a9a96'; ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill(); }
        else { const a = Math.atan2(p.ty - p.sy, p.tx - p.sx); ctx.strokeStyle = p.kind === 'bolt' ? '#d8d8d8' : '#e8d0a0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px - Math.cos(a) * 6, py - Math.sin(a) * 6); ctx.lineTo(px + Math.cos(a) * 6, py + Math.sin(a) * 6); ctx.stroke(); }
      } });
    }
    // fx
    for (const f of g.s.fx) list.push({ y: f.y + 3, draw: () => {
      const px = f.x * TILE + TILE / 2, py = f.y * TILE + TILE / 2;
      if (f.kind === 'hit') { ctx.fillStyle = `rgba(255,${200 - f.t * 8},80,${1 - f.t / 20})`; ctx.beginPath(); ctx.arc(px, py - 10, 3 + f.t * 0.5, 0, Math.PI * 2); ctx.fill(); }
      else if (f.kind === 'dust') { ctx.fillStyle = `rgba(200,180,140,${0.6 - f.t / 40})`; ctx.beginPath(); ctx.arc(px, py - f.t, 4 + f.t * 0.6, 0, Math.PI * 2); ctx.fill(); }
      else if (f.kind === 'chop') { ctx.fillStyle = `rgba(230,200,140,${1 - f.t / 20})`; for (let k = 0; k < 3; k++) ctx.fillRect(px - 6 + k * 6 + f.t * (k - 1) * 0.5, py - 4 - f.t * 0.8, 3, 2); }
      else if (f.kind === 'smoke') { for (let k = 0; k < 4; k++) { const tt = (f.t + k * 30) % 120; ctx.fillStyle = `rgba(60,50,40,${0.5 * (1 - tt / 120)})`; ctx.beginPath(); ctx.arc(px + Math.sin((tt + k * 40) / 15) * 6, py - tt * 0.4, 6 + tt * 0.1, 0, Math.PI * 2); ctx.fill(); } }
    } });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();
    // house placement ghost
    if (place.kind === 'house' && place.house && place.x >= 0) {
      const d = HOUSE_DEFS[place.house];
      const spr = S.houses[place.house].done;
      ctx.globalAlpha = 0.65;
      ctx.drawImage(spr, place.x * TILE, place.y * TILE - 10);
      ctx.globalAlpha = 1;
      ctx.fillStyle = place.ok ? 'rgba(60,255,90,0.25)' : 'rgba(255,60,60,0.35)';
      ctx.fillRect(place.x * TILE, place.y * TILE, d.w * TILE, d.h * TILE);
      ctx.strokeStyle = place.ok ? '#40ff60' : '#ff4040'; ctx.lineWidth = 2; ctx.strokeRect(place.x * TILE + 1, place.y * TILE + 1, d.w * TILE - 2, d.h * TILE - 2);
      // entrance marker
      const ex = (place.x + d.entrance) * TILE, ey = (place.y + d.h) * TILE;
      ctx.fillStyle = 'rgba(255,230,120,0.5)'; ctx.fillRect(ex, ey, TILE, TILE);
    }
    if (place.kind === 'demolish' && place.x >= 0) { ctx.strokeStyle = '#ff4040'; ctx.lineWidth = 2; ctx.strokeRect(place.x * TILE + 2, place.y * TILE + 2, TILE - 4, TILE - 4); }
    // drag rectangle
    if (this.dragRect) { const r = this.dragRect; ctx.strokeStyle = '#f0f0a0'; ctx.lineWidth = 1; ctx.strokeRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0)); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawHouse(h: House) {
    const ctx = this.ctx, S = this.S, d = HOUSE_DEFS[h.type];
    const sp = S.houses[h.type];
    const px = h.x * TILE, py = h.y * TILE - 10;
    if (h.state === 'destroyed') { ctx.drawImage(sp.ruin, px, py); return; }
    if (h.state === 'building') {
      const f = h.progress / d.buildTime;
      const st = f < 0.25 ? 0 : f < 0.6 ? 1 : f < 0.85 ? 2 : 3;
      ctx.drawImage(sp.stages[st], px, py);
      // progress bar & delivered materials
      const bw = d.w * TILE - 8;
      ctx.fillStyle = '#000'; ctx.fillRect(px + 4, py + 10 + d.h * TILE - 6, bw, 4);
      ctx.fillStyle = '#e0c040'; ctx.fillRect(px + 4, py + 10 + d.h * TILE - 6, bw * f, 4);
      return;
    }
    ctx.drawImage(sp.done, px, py);
    // smoke while working
    if (h.working && (d.recipes || d.special === 'mine')) {
      const t = (h.anim % 60) / 60;
      ctx.fillStyle = `rgba(90,90,90,${0.5 * (1 - t)})`;
      ctx.beginPath(); ctx.arc(px + d.w * TILE - 11, py + 2 - t * 14, 3 + t * 4, 0, Math.PI * 2); ctx.fill();
    }
    // idle worker icon when nobody works here
    if (d.worker && h.workerId < 0 && (this.frame % 60) < 40) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(px + d.w * TILE / 2 - 8, py - 4, 16, 16); ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', px + d.w * TILE / 2, py + 8); }
    if (d.special === 'mine' && h.depleted) { ctx.fillStyle = '#ff5050'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('EMPTY', px + d.w * TILE / 2, py + 8); }
    // health bar when damaged recently
    if (h.hp < d.hp && this.g.s.tick - h.lastAttackTick < 150) {
      const bw = d.w * TILE - 8;
      ctx.fillStyle = '#000'; ctx.fillRect(px + 4, py - 2, bw, 4);
      ctx.fillStyle = '#e04040'; ctx.fillRect(px + 4, py - 2, bw * h.hp / d.hp, 4);
    }
    // owner flag
    if (h.type === 'storehouse' || h.type === 'barracks' || h.type === 'watchtower') ctx.drawImage(S.flag[h.owner], px + 2, py + 2 + ((this.frame >> 4) & 1));
  }

  drawUnit(u: Unit, sel: Selection) {
    const ctx = this.ctx, S = this.S;
    const key = `${u.type}-${u.owner}`;
    const frames = S.units[key];
    if (!frames) return;
    const d = dir4(u.dir);
    const f = u.moving || (u.task.kind === 'work' && u.task.phase === 2) || (u.task.kind === 'buildHouse' && u.task.phase === 1) || (u.task.kind === 'buildTile' && u.task.phase === 1) ? [0, 1, 0, 2][Math.floor(u.frame / 4) % 4] : 0;
    const px = u.x * TILE + TILE / 2 - 12, py = u.y * TILE + TILE - 30;
    if (u.task.kind === 'die') { ctx.globalAlpha = Math.max(0, u.task.timer / 40); ctx.translate(px + 12, py + 28); ctx.rotate(Math.PI / 2); ctx.drawImage(frames[0][0], -12, -28); ctx.setTransform(this.zoom, 0, 0, this.zoom, 0, 0); ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y)); ctx.globalAlpha = 1; return; }
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(px + 12, py + 29, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
    if (u.hitFlash > 0 && (u.hitFlash & 1)) ctx.globalAlpha = 0.5;
    ctx.drawImage(frames[d][f], px, py);
    ctx.globalAlpha = 1;
    // carried ware
    if (u.carry) ctx.drawImage(S.wares[u.carry], px + (d === 1 ? -2 : d === 3 ? 12 : 10), py + 8);
    // hunger icon
    if (u.condition < 0.3 && u.owner === this.g.s.player && (this.frame % 40) < 25) { ctx.drawImage(S.wares.bread, px + 4, py - 12); }
    // health bar for soldiers that are hurt
    if (u.hp < u.maxHp && (u.task.kind === 'soldier' || sel.units.includes(u))) {
      ctx.fillStyle = '#000'; ctx.fillRect(px + 2, py - 4, 20, 3);
      ctx.fillStyle = u.hp / u.maxHp > 0.5 ? '#40d040' : u.hp / u.maxHp > 0.25 ? '#e0c040' : '#e04040'; ctx.fillRect(px + 2, py - 4, 20 * u.hp / u.maxHp, 3);
    }
    // group flag on the first unit of a group
    if (u.groupId >= 0) { const grp = this.g.group(u.groupId); if (grp && grp.units[0] === u.id) ctx.drawImage(S.flag[u.owner], px + 22, py - 6); }
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
      dat[i * 4] = r; dat[i * 4 + 1] = gg; dat[i * 4 + 2] = b; dat[i * 4 + 3] = 255;
    }
    // draw scaled
    const tmp = document.createElement('canvas'); tmp.width = m.w; tmp.height = m.h; tmp.getContext('2d')!.putImageData(img, 0, 0);
    mctx.imageSmoothingEnabled = false;
    mctx.clearRect(0, 0, mc.width, mc.height);
    mctx.drawImage(tmp, 0, 0, mc.width, mc.height);
    for (const u of g.s.units) { if (u.dead || u.inHouse >= 0) continue; mctx.fillStyle = u.task.kind === 'soldier' ? PLAYER_COLORS[u.owner] : '#ffffff'; mctx.fillRect(Math.floor(u.x * sx), Math.floor(u.y * sy), Math.max(1, sx), Math.max(1, sy)); }
    // alerts
    for (const msg of g.s.messages.slice(-5)) if (msg.kind === 'alert' && msg.x !== undefined && g.s.tick - msg.tick < 300 && (this.frame % 30) < 15) { mctx.strokeStyle = '#ff4040'; mctx.lineWidth = 2; mctx.strokeRect(msg.x! * sx - 4, msg.y! * sy - 4, 8, 8); }
    // viewport
    const vw = this.canvas.width / this.zoom / TILE, vh = this.canvas.height / this.zoom / TILE;
    mctx.strokeStyle = '#ffffff'; mctx.lineWidth = 1;
    mctx.strokeRect(this.cam.x / TILE * sx, this.cam.y / TILE * sy, vw * sx, vh * sy);
  }
}

export function unitName(u: Unit) { return UNIT_DEFS[u.type].name; }
