// ---- In-game UI: panel, input, selection, placement ----
import { HOUSE_DEFS, HOUSE_TYPES, UNIT_DEFS, CITIZEN_TYPES, SOLDIER_TYPES, WARES, WARE_NAME, FOOD, MAX_STOCK } from './defs';
import type { HouseType, UnitType, Ware } from './defs';
import { Obj, idx, inBounds } from './map';
import type { Game } from './sim';
import type { House, Unit, Group } from './state';
import { Renderer } from './renderer';
import type { Placement, Selection } from './renderer';
import { TILE } from './sprites';
import type { Sprites } from './sprites';
import { orderMove, orderAttackUnit, orderAttackHouse, orderHalt, splitGroup, linkGroups, unitsInRect, isEnemy, createGroup } from './combat';

const $ = (id: string) => document.getElementById(id)!;

export class UI {
  sel: Selection = { house: null, units: [], groups: [] };
  place: Placement = { kind: null, x: -1, y: -1, ok: false };
  tab: 'build' | 'stats' | 'menu' = 'build';
  linkMode = false;
  showTerritory = false;
  speed = 1;
  paused = false;
  keys = new Set<string>();
  mouse = { x: 0, y: 0, down: false, button: -1, sx: 0, sy: 0, dragging: false, panning: false, inView: false };
  lastPanel = 0;
  lastPanelKey = '';
  onSave?: () => void; onLoad?: () => void; onQuit?: () => void;
  minimapCtx: CanvasRenderingContext2D;

  constructor(public g: Game, public r: Renderer, public S: Sprites) {
    this.minimapCtx = ($('minimap') as HTMLCanvasElement).getContext('2d')!;
    this.bind();
    this.renderTab();
  }

  setGame(g: Game) { this.g = g; this.sel = { house: null, units: [], groups: [] }; this.place = { kind: null, x: -1, y: -1, ok: false }; this.renderTab(); this.renderInfo(true); }

  // ---------- input ----------
  bind() {
    const c = this.r.canvas;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('mousedown', e => this.onMouseDown(e));
    window.addEventListener('mouseup', e => this.onMouseUp(e));
    c.addEventListener('mousemove', e => this.onMouseMove(e));
    c.addEventListener('mouseleave', () => { this.mouse.inView = false; this.place.x = -1; });
    c.addEventListener('mouseenter', () => { this.mouse.inView = true; });
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(e.deltaY < 0 ? 1 : -1, e.offsetX, e.offsetY); }, { passive: false });
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    const mm = $('minimap') as HTMLCanvasElement;
    const mmGo = (e: MouseEvent) => { const rect = mm.getBoundingClientRect(); const tx = (e.clientX - rect.left) / rect.width * this.g.map.w, ty = (e.clientY - rect.top) / rect.height * this.g.map.h; this.r.centerOn(tx, ty); };
    mm.addEventListener('mousedown', e => { mmGo(e); const mv = (ev: MouseEvent) => mmGo(ev); const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }; window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); });
    $('tabs').addEventListener('click', e => { const b = (e.target as HTMLElement).closest('button'); if (!b) return; this.setTab(b.dataset.tab as any); });
    $('tab-content').addEventListener('click', e => this.onPanelClick(e, 'tab'));
    $('info').addEventListener('click', e => this.onPanelClick(e, 'info'));
    $('speed-btns').addEventListener('click', e => { const b = (e.target as HTMLElement).closest('button'); if (!b) return; this.setSpeed(Number(b.dataset.speed)); });
    $('messages').addEventListener('click', e => { const d = (e.target as HTMLElement).closest('div'); if (!d) return; const x = d.dataset.x, y = d.dataset.y; if (x !== undefined) this.r.centerOn(Number(x), Number(y)); });
    // tooltips
    const tip = $('tooltip');
    document.addEventListener('mouseover', e => { const el = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null; if (!el) { tip.classList.add('hidden'); return; } tip.innerHTML = el.dataset.tip!; tip.classList.remove('hidden'); });
    document.addEventListener('mousemove', e => { if (tip.classList.contains('hidden')) return; let x = e.clientX + 16, y = e.clientY + 16; if (x + 250 > window.innerWidth) x = e.clientX - 250; if (y + tip.offsetHeight + 10 > window.innerHeight) y = e.clientY - tip.offsetHeight - 10; tip.style.left = x + 'px'; tip.style.top = y + 'px'; });
  }

  setSpeed(n: number) {
    if (n === 0) { this.paused = !this.paused; } else { this.speed = n; this.paused = false; }
    for (const b of $('speed-btns').querySelectorAll('button')) b.classList.toggle('active', this.paused ? b.dataset.speed === '0' : Number(b.dataset.speed) === this.speed);
  }

  setTab(t: 'build' | 'stats' | 'menu') { this.tab = t; for (const b of $('tabs').querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === t); this.renderTab(); }

  zoomAt(dir: number, sx: number, sy: number) {
    const levels = [0.5, 0.75, 1, 1.5, 2];
    const i = levels.indexOf(this.r.zoom);
    const nz = levels[Math.max(0, Math.min(levels.length - 1, i + dir))];
    if (nz === this.r.zoom) return;
    const before = this.r.screenToWorld(sx, sy);
    this.r.zoom = nz;
    const after = this.r.screenToWorld(sx, sy);
    this.r.cam.x += (before.x - after.x) * TILE; this.r.cam.y += (before.y - after.y) * TILE;
    this.r.clampCam();
  }

  onKey(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down) return;
    if (k === 'escape') { if (this.place.kind) this.cancelPlacement(); else this.clearSelection(); this.linkMode = false; }
    else if (k === ' ') { e.preventDefault(); this.setSpeed(0); }
    else if (k === '1') this.setSpeed(1); else if (k === '2') this.setSpeed(3); else if (k === '3') this.setSpeed(8);
    else if (k === 'b') this.setTab('build');
    else if (k === 'h' && this.sel.groups.length) { for (const gid of this.sel.groups) { const grp = this.g.group(gid); if (grp) orderHalt(this.g, grp); } }
    else if (k === 'delete' && this.sel.house && this.sel.house.owner === this.g.s.player) { this.g.demolishHouse(this.sel.house); this.clearSelection(); }
    else if (k === 'r') this.startPlacement('road'); else if (k === 'f') this.startPlacement('field');
  }

  onMouseDown(e: MouseEvent) {
    this.g.sound('click');
    this.mouse.down = true; this.mouse.button = e.button; this.mouse.sx = e.offsetX; this.mouse.sy = e.offsetY; this.mouse.dragging = false;
    if (e.button === 1 || (e.button === 0 && this.keys.has('shift') && !this.place.kind)) { this.mouse.panning = true; e.preventDefault(); return; }
    if (e.button === 2) {
      if (this.place.kind) { this.cancelPlacement(); return; }
      this.rightClick(e.offsetX, e.offsetY); return;
    }
    if (e.button === 0) {
      if (this.place.kind) { this.applyPlacement(e.offsetX, e.offsetY, true); return; }
      if (this.linkMode) { const t = this.r.screenToWorld(e.offsetX, e.offsetY); const u = this.unitAt(t.x, t.y, this.g.s.player, true); if (u && u.groupId >= 0) { const target = this.g.group(u.groupId)!; const first = this.g.group(this.sel.groups[0]); if (first && first !== target) { linkGroups(this.g, target, first); this.selectGroup(target); } } this.linkMode = false; this.renderInfo(true); return; }
    }
  }

  onMouseMove(e: MouseEvent) {
    const dx = e.offsetX - this.mouse.sx, dy = e.offsetY - this.mouse.sy;
    this.mouse.x = e.offsetX; this.mouse.y = e.offsetY; this.mouse.inView = true;
    if (this.mouse.panning && this.mouse.down) { this.r.cam.x -= e.movementX / this.r.zoom; this.r.cam.y -= e.movementY / this.r.zoom; this.r.clampCam(); return; }
    const t = this.r.screenToTile(e.offsetX, e.offsetY);
    this.r.hoverTile = t;
    if (this.place.kind) {
      this.updatePlacementPos(t.x, t.y);
      if (this.mouse.down && this.mouse.button === 0 && (this.place.kind === 'road' || this.place.kind === 'field' || this.place.kind === 'wine')) this.applyPlacement(e.offsetX, e.offsetY, false);
      return;
    }
    if (this.mouse.down && this.mouse.button === 0 && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      this.mouse.dragging = true;
      const a = this.r.screenToWorld(this.mouse.sx, this.mouse.sy), b = this.r.screenToWorld(e.offsetX, e.offsetY);
      this.r.dragRect = { x0: a.x * TILE, y0: a.y * TILE, x1: b.x * TILE, y1: b.y * TILE };
    }
  }

  onMouseUp(e: MouseEvent) {
    if (!this.mouse.down) return;
    this.mouse.down = false;
    if (this.mouse.panning) { this.mouse.panning = false; return; }
    if (e.button !== 0) return;
    if (this.place.kind) return;
    if (this.mouse.dragging && this.r.dragRect) {
      const r = this.r.dragRect; this.r.dragRect = null; this.mouse.dragging = false;
      const x0 = Math.min(r.x0, r.x1) / TILE - 0.5, x1 = Math.max(r.x0, r.x1) / TILE - 0.5, y0 = Math.min(r.y0, r.y1) / TILE - 0.5, y1 = Math.max(r.y0, r.y1) / TILE - 0.5;
      const units = unitsInRect(this.g, this.g.s.player, x0, y0, x1, y1).filter(u => u.task.kind === 'soldier');
      if (units.length) { this.sel = { house: null, units: [], groups: [] }; for (const u of units) if (u.groupId >= 0 && !this.sel.groups.includes(u.groupId)) this.sel.groups.push(u.groupId); this.refreshGroupUnits(); this.renderInfo(true); }
      return;
    }
    this.r.dragRect = null;
    // plain click: select
    const rect = this.r.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const w = this.r.screenToWorld(sx, sy);
    const u = this.unitAt(w.x, w.y, -1, false);
    if (u) { this.selectUnit(u); return; }
    const t = { x: Math.floor(w.x), y: Math.floor(w.y) };
    const h = this.houseAt(t.x, t.y);
    if (h) { this.sel = { house: h, units: [], groups: [] }; this.renderInfo(true); return; }
    this.clearSelection();
  }

  rightClick(sx: number, sy: number) {
    if (!this.sel.groups.length) return;
    const w = this.r.screenToWorld(sx, sy);
    const t = { x: Math.floor(w.x), y: Math.floor(w.y) };
    const enemyU = this.unitAt(w.x, w.y, -1, false, true);
    const h = this.houseAt(t.x, t.y);
    let k = 0;
    for (const gid of this.sel.groups) {
      const grp = this.g.group(gid); if (!grp) continue;
      if (enemyU && isEnemy(this.g.s.player, enemyU.owner)) orderAttackUnit(this.g, grp, enemyU);
      else if (h && isEnemy(this.g.s.player, h.owner) && h.state !== 'destroyed') orderAttackHouse(this.g, grp, h);
      else { orderMove(this.g, grp, t.x + (k % 2) * (grp.columns + 1), t.y + Math.floor(k / 2) * 4); k++; }
    }
    this.g.sound('click');
  }

  unitAt(wx: number, wy: number, owner: number, soldiersOnly: boolean, enemyOnly = false): Unit | null {
    let best: Unit | null = null, bd = 0.75;
    for (const u of this.g.s.units) {
      if (u.dead || u.inHouse >= 0) continue;
      if (owner >= 0 && u.owner !== owner) continue;
      if (enemyOnly && !isEnemy(this.g.s.player, u.owner)) continue;
      if (soldiersOnly && u.task.kind !== 'soldier') continue;
      const d = Math.hypot(u.x + 0.5 - wx, u.y + 0.5 - wy - 0.2);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }
  houseAt(x: number, y: number): House | null {
    if (!inBounds(this.g.map, x, y)) return null;
    const id = this.g.map.house[idx(this.g.map, x, y)];
    if (id < 0) return null;
    const h = this.g.house(id);
    return h && h.state !== 'destroyed' ? h : null;
  }

  selectUnit(u: Unit) {
    if (u.groupId >= 0) { const grp = this.g.group(u.groupId); if (grp) { this.selectGroup(grp); return; } }
    if (u.task.kind === 'soldier' && u.owner === this.g.s.player) { const grp = createGroup(this.g, u.owner, [u.id]); grp.dest = { x: Math.round(u.x), y: Math.round(u.y) }; this.selectGroup(grp); return; }
    this.sel = { house: null, units: [u], groups: [] }; this.renderInfo(true);
  }
  selectGroup(grp: Group) { this.sel = { house: null, units: [], groups: [grp.id] }; this.refreshGroupUnits(); this.renderInfo(true); }
  refreshGroupUnits() {
    this.sel.groups = this.sel.groups.filter(id => this.g.group(id));
    if (!this.sel.groups.length) { this.sel.units = this.sel.units.filter(u => !u.dead); return; } // single citizen stays selected
    this.sel.units = [];
    for (const gid of this.sel.groups) { const grp = this.g.group(gid)!; for (const id of grp.units) { const u = this.g.unit(id); if (u && !u.dead) this.sel.units.push(u); } }
  }
  clearSelection() { this.sel = { house: null, units: [], groups: [] }; this.linkMode = false; this.renderInfo(true); }

  // ---------- placement ----------
  startPlacement(kind: Placement['kind'], house?: HouseType) {
    this.place = { kind, house, x: -1, y: -1, ok: false };
    this.sel = { house: null, units: [], groups: [] };
    this.renderTab(); this.renderInfo(true);
  }
  cancelPlacement() { this.place = { kind: null, x: -1, y: -1, ok: false }; this.renderTab(); this.renderInfo(true); }
  updatePlacementPos(tx: number, ty: number) {
    const p = this.place;
    if (p.kind === 'house' && p.house) {
      const d = HOUSE_DEFS[p.house];
      p.x = tx - Math.floor(d.w / 2); p.y = ty - Math.floor(d.h / 2);
      p.ok = this.g.canPlaceHouse(p.house, p.x, p.y, this.g.s.player) === null;
    } else {
      p.x = tx; p.y = ty;
      if (p.kind === 'demolish') p.ok = true;
      else if (inBounds(this.g.map, tx, ty)) { const i = idx(this.g.map, tx, ty); const o = this.g.map.obj[i]; const owner = this.g.map.owner[i]; p.ok = (owner === 0 || owner === this.g.s.player) && (o === Obj.None || o === Obj.Stump || o === Obj.Bush) && this.g.map.house[i] < 0 && this.g.map.terrain[i] !== 1 && this.g.map.terrain[i] !== 3; if (p.kind !== 'road' && p.ok) p.ok = this.g.map.terrain[i] === 0 || this.g.map.terrain[i] === 4; }
      else p.ok = false;
    }
  }
  applyPlacement(sx: number, sy: number, click: boolean) {
    const t = this.r.screenToTile(sx, sy);
    this.updatePlacementPos(t.x, t.y);
    const p = this.place, g = this.g;
    if (p.kind === 'house' && p.house) {
      const reason = g.canPlaceHouse(p.house, p.x, p.y, g.s.player);
      if (reason) { if (click) g.msg(`Cannot build here: ${reason}.`, 'warn'); return; }
      g.placeHouse(p.house, p.x, p.y, g.s.player);
      if (!this.keys.has('shift')) this.cancelPlacement();
    } else if (p.kind === 'road' || p.kind === 'field' || p.kind === 'wine') {
      if (p.ok) { g.placePlan(p.kind, p.x, p.y, g.s.player); if (click) g.sound('place'); }
      else if (click && inBounds(g.map, p.x, p.y)) { const o = g.map.obj[idx(g.map, p.x, p.y)]; if (o === Obj.RoadPlan || o === Obj.FieldPlan || o === Obj.WinePlan) g.removePlan(p.x, p.y); }
    } else if (p.kind === 'demolish') {
      const h = this.houseAt(p.x, p.y);
      if (h && h.owner === g.s.player) { g.demolishHouse(h); }
      else if (inBounds(g.map, p.x, p.y)) { const o = g.map.obj[idx(g.map, p.x, p.y)]; if (o === Obj.Road || o === Obj.Field || o === Obj.WineField || o === Obj.RoadPlan || o === Obj.FieldPlan || o === Obj.WinePlan) g.removePlan(p.x, p.y); }
    }
  }

  // ---------- per-frame ----------
  update(dt: number) {
    // keyboard / edge scrolling
    const sp = 600 * dt / this.r.zoom;
    let dx = 0, dy = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) dx -= sp; if (this.keys.has('arrowright') || this.keys.has('d')) dx += sp;
    if (this.keys.has('arrowup') || this.keys.has('w')) dy -= sp; if (this.keys.has('arrowdown') || this.keys.has('s')) dy += sp;
    if (this.mouse.inView && !this.mouse.down) {
      const m = 14, W = this.r.canvas.width, H = this.r.canvas.height;
      if (this.mouse.x < m) dx -= sp; if (this.mouse.x > W - m) dx += sp; if (this.mouse.y < m) dy -= sp; if (this.mouse.y > H - m) dy += sp;
    }
    if (dx || dy) { this.r.cam.x += dx; this.r.cam.y += dy; this.r.clampCam(); }
    // panel refresh
    const now = performance.now();
    if (now - this.lastPanel > 400) { this.lastPanel = now; this.refreshGroupUnits(); if (this.sel.house && this.sel.house.state === 'destroyed') this.sel.house = null; this.renderInfo(false); if (this.tab === 'stats' || this.tab === 'menu') this.renderTab(); this.renderMessages(); this.renderTop(); }
    if (this.r.frame % 15 === 0) this.r.drawMinimap($('minimap') as HTMLCanvasElement, this.minimapCtx);
  }

  renderTop() {
    const s = this.g.s;
    const sec = Math.floor(s.tick / 10);
    $('clock').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    const pending = s.objectives.filter(o => !this.g.objectiveDone(o));
    $('objective-short').textContent = pending.length ? `Next: ${pending[0].text} (${this.g.objectiveProgress(pending[0])})` : 'All objectives complete';
  }

  renderMessages() {
    const el = $('messages');
    const s = this.g.s;
    const list = s.messages.slice(-6).filter(m => s.tick - m.tick < 600);
    const key = list.map(m => m.tick + m.text).join('|');
    if ((el as any)._key === key) return;
    (el as any)._key = key;
    el.innerHTML = list.map(m => `<div class="${m.kind}" ${m.x !== undefined ? `data-x="${m.x}" data-y="${m.y}"` : ''} style="opacity:${Math.max(0.3, 1 - (s.tick - m.tick) / 600)}">${m.text}</div>`).join('');
  }

  // ---------- panel ----------
  icon(c: HTMLCanvasElement, w = c.width, h = c.height) { const x = document.createElement('canvas'); x.width = w; x.height = h; x.getContext('2d')!.drawImage(c, 0, 0, w, h); return x.outerHTML.replace('<canvas', `<canvas data-src="1"`); }
  wareHtml(w: Ware, n: number | string, cls = '', tip = '') { return `<span class="ware ${cls}" data-ware="${w}" data-tip="${tip || WARE_NAME[w]}"><canvas class="wi" data-w="${w}"></canvas>${n}</span>`; }
  unitIconHtml(t: UnitType, owner = 1) { return `<canvas class="ui" data-u="${t}" data-o="${owner}"></canvas>`; }
  houseIconHtml(t: HouseType) { return `<canvas class="hi" data-h="${t}"></canvas>`; }
  /** After setting innerHTML, paint all placeholder canvases. */
  paintIcons(root: HTMLElement) {
    for (const c of root.querySelectorAll('canvas.wi') as NodeListOf<HTMLCanvasElement>) { c.width = 16; c.height = 16; c.getContext('2d')!.drawImage(this.S.wares[c.dataset.w as Ware], 0, 0); }
    for (const c of root.querySelectorAll('canvas.ui') as NodeListOf<HTMLCanvasElement>) { c.width = 24; c.height = 32; const fr = this.S.units[`${c.dataset.u}-${c.dataset.o}`][0][1]; const x = c.getContext('2d')!; x.imageSmoothingEnabled = fr.width > 24; x.drawImage(fr, 0, 0, fr.width, fr.height, fr.width > 24 ? 1 : 0, 0, fr.width > 24 ? 22 : 24, 32); }
    for (const c of root.querySelectorAll('canvas.hi') as NodeListOf<HTMLCanvasElement>) { c.width = 48; c.height = 40; c.getContext('2d')!.drawImage(this.S.houses[c.dataset.h as HouseType].icon, 0, 0); }
  }

  renderTab() {
    const el = $('tab-content');
    const g = this.g;
    if (this.tab === 'build') {
      let html = `<div class="tool-row">
        <button data-tool="road" class="${this.place.kind === 'road' ? 'active' : ''}" data-tip="<b>Road</b> (R)<br>Costs 1 stone per tile. Serfs only carry wares along roads. Drag to draw.">Road</button>
        <button data-tool="field" class="${this.place.kind === 'field' ? 'active' : ''}" data-tip="<b>Corn field</b> (F)<br>Free. Farms sow and harvest corn here.">Field</button>
        <button data-tool="wine" class="${this.place.kind === 'wine' ? 'active' : ''}" data-tip="<b>Wine field</b><br>Costs 1 timber per tile. Vineyards harvest grapes here.">Wine</button>
        <button data-tool="demolish" class="${this.place.kind === 'demolish' ? 'active' : ''}" data-tip="<b>Demolish</b><br>Remove a house, road or field.">✕</button></div><div class="build-grid">`;
      for (const t of HOUSE_TYPES) {
        const d = HOUSE_DEFS[t];
        const tip = `<b>${d.name}</b><br>${d.desc}<br>Cost: ${d.cost.wood} timber, ${d.cost.stone} stone${d.worker ? `<br>Worker: ${UNIT_DEFS[d.worker].name}` : ''}`;
        html += `<button data-house="${t}" class="${this.place.kind === 'house' && this.place.house === t ? 'active' : ''}" data-tip="${tip.replace(/"/g, '&quot;')}">${this.houseIconHtml(t)}</button>`;
      }
      html += `</div><p class="small">Shift-click to place several. Right-click cancels.</p>`;
      el.innerHTML = html; this.paintIcons(el);
    } else if (this.tab === 'stats') {
      const p = g.s.player;
      const counts: Partial<Record<UnitType, number>> = {};
      for (const u of g.s.units) if (!u.dead && u.owner === p) counts[u.type] = (counts[u.type] ?? 0) + 1;
      let html = `<h4>Citizens</h4><div class="unit-grid">`;
      for (const t of CITIZEN_TYPES) html += `<button data-tip="<b>${UNIT_DEFS[t].name}</b><br>${UNIT_DEFS[t].desc}" style="flex-direction:column;height:46px;font-size:11px;color:#f0e0b0">${this.unitIconHtml(t)}${counts[t] ?? 0}</button>`;
      html += `</div><h4>Soldiers</h4><div class="unit-grid">`;
      for (const t of SOLDIER_TYPES) html += `<button data-tip="<b>${UNIT_DEFS[t].name}</b><br>${UNIT_DEFS[t].desc}" style="flex-direction:column;height:46px;font-size:11px;color:#f0e0b0">${this.unitIconHtml(t)}${counts[t] ?? 0}</button>`;
      const wares = g.countWares(p);
      html += `</div><h4>Wares in town</h4><div class="ware-grid">`;
      for (const w of WARES) html += this.wareHtml(w, wares[w] ?? 0);
      const houses = g.s.houses.filter(h => h.owner === p && h.state !== 'destroyed').length;
      html += `</div><p class="small">${houses} houses · killed ${g.s.stats.killed} · lost ${g.s.stats.lost}</p>`;
      el.innerHTML = html; this.paintIcons(el);
    } else {
      let html = `<h4>Objectives</h4><ul class="obj-list">`;
      for (const o of g.s.objectives) html += `<li class="${g.objectiveDone(o) ? 'done' : ''}">${o.text} <span class="small">${g.objectiveProgress(o)}</span></li>`;
      html += `</ul>`;
      if (g.s.hints.length) { html += `<h4>Advice</h4><ul class="obj-list small">`; for (const h of g.s.hints) html += `<li>${h}</li>`; html += `</ul>`; }
      html += `<h4>Game</h4><div class="menu-tab">
        <button data-act="save">Save game</button><button data-act="load">Load game</button>
        <button data-act="territory">${this.showTerritory ? 'Hide' : 'Show'} territory</button>
        <button data-act="sound">Sound: ${(window as any).__audioEnabled === false ? 'off' : 'on'}</button>
        <button data-act="music">Music: ${(window as any).__musicEnabled === false ? 'off' : 'on'}</button>
        <button data-act="quit">Quit to main menu</button></div>`;
      el.innerHTML = html;
    }
  }

  onPanelClick(e: MouseEvent, where: 'tab' | 'info') {
    const t = e.target as HTMLElement;
    const b = t.closest('button, .ware, .queue canvas') as HTMLElement | null;
    if (!b) return;
    const g = this.g;
    this.g.sound('click');
    if (b.dataset.house) { this.startPlacement('house', b.dataset.house as HouseType); return; }
    if (b.dataset.tool) { const k = b.dataset.tool as Placement['kind']; if (this.place.kind === k) this.cancelPlacement(); else this.startPlacement(k); return; }
    if (b.dataset.act) {
      const a = b.dataset.act;
      if (a === 'save') this.onSave?.(); else if (a === 'load') this.onLoad?.(); else if (a === 'quit') this.onQuit?.();
      else if (a === 'territory') { this.showTerritory = !this.showTerritory; this.renderTab(); }
      else if (a === 'sound') { (window as any).__toggleAudio?.(); this.renderTab(); }
      else if (a === 'music') { (window as any).__toggleMusic?.(); this.renderTab(); }
      else if (a === 'demolish' && this.sel.house) { g.demolishHouse(this.sel.house); this.clearSelection(); }
      else if (a === 'halt') { for (const gid of this.sel.groups) { const grp = g.group(gid); if (grp) orderHalt(g, grp); } }
      else if (a === 'split') { const grp = g.group(this.sel.groups[0]); if (grp) { const n = splitGroup(g, grp); if (n) this.selectGroup(n); } }
      else if (a === 'link') { this.linkMode = !this.linkMode; this.renderInfo(true); }
      else if (a === 'cols+') { for (const gid of this.sel.groups) { const grp = g.group(gid); if (grp) { grp.columns = Math.min(12, grp.columns + 1); if (grp.dest) orderMove(g, grp, grp.dest.x, grp.dest.y); } } this.renderInfo(true); }
      else if (a === 'cols-') { for (const gid of this.sel.groups) { const grp = g.group(gid); if (grp) { grp.columns = Math.max(1, grp.columns - 1); if (grp.dest) orderMove(g, grp, grp.dest.x, grp.dest.y); } } this.renderInfo(true); }
      else if (a === 'train' && this.sel.house) { g.schoolTrain(this.sel.house, b.dataset.unit as UnitType); this.renderInfo(true); }
      else if (a === 'cancel' && this.sel.house) { g.schoolCancel(this.sel.house, Number(b.dataset.i)); this.renderInfo(true); }
      else if (a === 'equip' && this.sel.house) { if (!g.equipSoldier(this.sel.house, b.dataset.unit as UnitType)) g.msg('Not enough recruits or equipment in the barracks.', 'warn'); this.renderInfo(true); }
      else if (a === 'goto' && this.sel.house) { const d = HOUSE_DEFS[this.sel.house.type]; this.r.centerOn(this.sel.house.x + d.w / 2, this.sel.house.y + d.h / 2); }
      else if (a === 'gotou' && this.sel.units.length) { this.r.centerOn(this.sel.units[0].x, this.sel.units[0].y); }
      return;
    }
    if (b.dataset.ware && this.sel.house && where === 'info') {
      const h = this.sel.house, w = b.dataset.ware as Ware;
      if (h.type === 'storehouse') { h.blocked[w] = !h.blocked[w]; this.renderInfo(true); }
      else if (HOUSE_DEFS[h.type].outputs.includes(w) && HOUSE_DEFS[h.type].recipes) { h.enabled[w] = h.enabled[w] === false; this.renderInfo(true); }
    }
  }

  renderInfo(force: boolean) {
    const el = $('info');
    const g = this.g;
    let html = '';
    let key = '';
    if (this.place.kind) {
      if (this.place.kind === 'house' && this.place.house) { const d = HOUSE_DEFS[this.place.house]; html = `<h4>${d.name}</h4><p>${d.desc}</p><p>Cost: ${this.wareHtml('wood', d.cost.wood)} ${this.wareHtml('stone', d.cost.stone)}</p>${d.worker ? `<p>Worker: ${this.unitIconHtml(d.worker)} ${UNIT_DEFS[d.worker].name}</p>` : ''}<p class="small">Click to place. The yellow tile is the entrance: connect it by road.</p>`; }
      else if (this.place.kind === 'road') html = `<h4>Road</h4><p class="small">Drag to draw. Each tile costs 1 stone, delivered by serfs. Click a plan to remove it.</p>`;
      else if (this.place.kind === 'field') html = `<h4>Corn field</h4><p class="small">Drag to lay out fields near a farm. Labourers plough them.</p>`;
      else if (this.place.kind === 'wine') html = `<h4>Wine field</h4><p class="small">Drag to lay out wine fields near a vineyard. Each costs 1 timber.</p>`;
      else html = `<h4>Demolish</h4><p class="small">Click a house, road or field to remove it.</p>`;
      key = 'place' + this.place.kind + this.place.house;
    } else if (this.sel.house) {
      const h = this.sel.house, d = HOUSE_DEFS[h.type];
      key = `h${h.id}`;
      html = `<h4>${d.name} ${h.owner !== g.s.player ? '<span class="small">(enemy)</span>' : ''}</h4>`;
      if (h.state === 'building') {
        html += `<p class="small">Under construction</p><div class="bar"><div style="width:${100 * h.progress / d.buildTime}%"></div></div>
          <p>${this.wareHtml('wood', `${h.delivered.wood}/${d.cost.wood}`)} ${this.wareHtml('stone', `${h.delivered.stone}/${d.cost.stone}`)}</p>
          <p class="small">${h.builderId >= 0 ? 'A labourer is working here.' : 'Waiting for a labourer.'}</p>`;
      } else {
        html += `<div class="bar hp"><div style="width:${100 * h.hp / d.hp}%"></div></div>`;
        if (d.worker) { const w = g.workerInside(h); html += `<p>${this.unitIconHtml(d.worker, h.owner)} ${w ? UNIT_DEFS[d.worker].name + (h.working ? ' is working' : w.task.kind === 'work' && w.task.phase !== 0 ? ' is outside working' : ' is waiting') : `<span style="color:#ffb060">No ${UNIT_DEFS[d.worker].name.toLowerCase()}!</span>`}</p>`; }
        if (h.working && (d.recipes || d.special === 'mine')) { const r = d.recipes ? d.recipes[h.recipeIdx].time : 110; html += `<div class="bar"><div style="width:${100 * (1 - h.workTimer / r)}%"></div></div>`; }
        if (h.owner === g.s.player) {
          if (h.type === 'storehouse') {
            html += `<p class="small">Click a ware to block deliveries of it.</p><div class="ware-grid">`;
            for (const w of WARES) html += this.wareHtml(w, h.stock[w] ?? 0, 'clickable' + (h.blocked[w] ? ' off' : ''));
            html += `</div>`;
          } else if (h.type === 'school') {
            html += `<p>${this.wareHtml('gold', h.stock.gold ?? 0)} <span class="small">1 gold per citizen</span></p>`;
            if (h.working) html += `<div class="bar"><div style="width:${100 * (1 - h.trainTimer / 60)}%"></div></div>`;
            html += `<div class="queue">${h.queue.map((t, i) => `<canvas class="ui" data-u="${t}" data-o="1" data-act="cancel" data-i="${i}" data-tip="Cancel ${UNIT_DEFS[t].name}"></canvas>`).join('')}</div><div class="unit-grid">`;
            for (const t of CITIZEN_TYPES) html += `<button data-act="train" data-unit="${t}" data-tip="<b>${UNIT_DEFS[t].name}</b><br>${UNIT_DEFS[t].desc}">${this.unitIconHtml(t)}</button>`;
            html += `</div>`;
          } else if (h.type === 'barracks') {
            const rec = h.recruits.filter(id => { const u = g.unit(id); return u && !u.dead; }).length;
            html += `<p>${this.unitIconHtml('recruit')} ${rec} recruits</p><div class="ware-grid">`;
            for (const w of d.inputs) html += this.wareHtml(w, h.stock[w] ?? 0);
            html += `</div><h4>Equip</h4><div class="unit-grid">`;
            for (const t of SOLDIER_TYPES) {
              const eq = UNIT_DEFS[t].equipment!;
              const can = rec > 0 && Object.keys(eq).every(w => (h.stock[w as Ware] ?? 0) >= eq[w as Ware]!);
              const tip = `<b>${UNIT_DEFS[t].name}</b><br>${UNIT_DEFS[t].desc}<br>Needs: ${Object.keys(eq).map(w => WARE_NAME[w as Ware]).join(', ')}`;
              html += `<button data-act="equip" data-unit="${t}" ${can ? '' : 'disabled'} data-tip="${tip}">${this.unitIconHtml(t)}</button>`;
            }
            html += `</div>`;
          } else if (h.type === 'inn') {
            html += `<div class="ware-grid">${FOOD.map(w => this.wareHtml(w, h.stock[w] ?? 0)).join('')}</div><p class="small">Hungry citizens come here to eat.</p>`;
          } else if (h.type === 'watchtower') {
            html += `<p>${this.wareHtml('stone', h.stock.stone ?? 0)} <span class="small">stones to throw</span></p>`;
          } else {
            if (d.inputs.length) { html += `<p class="small">Needs</p><div class="ware-grid">`; for (const w of d.inputs) html += this.wareHtml(w, `${h.stock[w] ?? 0}${h.incoming[w] ? '+' + h.incoming[w] : ''}`); html += `</div>`; }
            if (d.outputs.length) { html += `<p class="small">Produces ${d.recipes && d.recipes.length > 1 ? '(click to toggle)' : ''}</p><div class="ware-grid">`; for (const w of d.outputs) html += this.wareHtml(w, h.out[w] ?? 0, (d.recipes ? 'clickable' : '') + (h.enabled[w] === false ? ' off' : '')); html += `</div>`; }
            if (d.special === 'mine' && h.depleted) html += `<p style="color:#ff8060">The deposit is exhausted.</p>`;
          }
          html += `<div class="btn-row"><button data-act="goto">Centre view</button><button data-act="demolish" class="danger" data-tip="Demolish this house (Delete)">Demolish</button></div>`;
        }
      }
    } else if (this.sel.groups.length) {
      key = 'g' + this.sel.groups.join(',') + ':' + this.sel.units.length + (this.linkMode ? 'L' : '');
      const grp = g.group(this.sel.groups[0])!;
      const counts: Partial<Record<UnitType, number>> = {};
      let hp = 0, maxHp = 0, cond = 0;
      for (const u of this.sel.units) { counts[u.type] = (counts[u.type] ?? 0) + 1; hp += u.hp; maxHp += u.maxHp; cond += u.condition; }
      html = `<h4>${this.sel.groups.length > 1 ? this.sel.groups.length + ' groups' : 'Group'} · ${this.sel.units.length} soldiers</h4><div class="stat-row" style="flex-wrap:wrap">`;
      for (const t of Object.keys(counts) as UnitType[]) html += `<span data-tip="<b>${UNIT_DEFS[t].name}</b><br>${UNIT_DEFS[t].desc}">${this.unitIconHtml(t)}${counts[t]}</span>`;
      html += `</div><div class="small">Health</div><div class="bar hp"><div style="width:${100 * hp / Math.max(1, maxHp)}%"></div></div><div class="small">Condition</div><div class="bar cond"><div style="width:${100 * cond / Math.max(1, this.sel.units.length)}%"></div></div>`;
      html += `<p class="small">Order: ${grp.order}${cond / this.sel.units.length < 0.4 ? ' · <span style="color:#ffb060">hungry</span>' : ''}</p>`;
      html += `<div class="btn-row"><button data-act="halt" data-tip="Stop and hold position (H)">Halt</button><button data-act="split" data-tip="Split the group in two">Split</button><button data-act="link" class="${this.linkMode ? 'active' : ''}" data-tip="Link: click another group to merge into it">Link</button></div>
        <div class="btn-row"><button data-act="cols-">Columns −</button><span style="padding:4px">${grp.columns}</span><button data-act="cols+">Columns +</button><button data-act="gotou">Centre</button></div>`;
      if (this.linkMode) html += `<p class="small">Click a friendly group on the map to link.</p>`;
      html += `<p class="small">Right-click: move · right-click enemy: attack</p>`;
    } else if (this.sel.units.length) {
      const u = this.sel.units[0];
      if (u.dead) { this.sel.units = []; }
      else {
        key = `u${u.id}` + u.task.kind + (u.carry ?? '');
        const d = UNIT_DEFS[u.type];
        html = `<h4>${d.name}${u.owner !== g.s.player ? ' <span class="small">(enemy)</span>' : ''}</h4><div class="stat-row">${this.unitIconHtml(u.type, u.owner)} <span class="small">${d.desc}</span></div>
          <div class="small">Health ${u.hp}/${u.maxHp}</div><div class="bar hp"><div style="width:${100 * u.hp / u.maxHp}%"></div></div>
          <div class="small">Condition${u.condition < 0.4 ? ' · <span style="color:#ffb060">hungry</span>' : ''}</div><div class="bar cond"><div style="width:${100 * u.condition}%"></div></div>
          <p class="small">${this.taskText(u)}</p>${u.carry ? `<p>Carrying ${this.wareHtml(u.carry, '')}</p>` : ''}<div class="btn-row"><button data-act="gotou">Centre view</button></div>`;
      }
    } else {
      key = 'none';
      html = `<p class="small">Click a house or unit to see details. Drag a box around soldiers to select them.</p>`;
    }
    if (!force && key === this.lastPanelKey && (key.startsWith('none') || key.startsWith('place'))) return;
    this.lastPanelKey = key;
    el.innerHTML = html; this.paintIcons(el);
  }

  taskText(u: Unit): string {
    const t = u.task;
    const hn = (id: number) => { const h = this.g.house(id); return h ? HOUSE_DEFS[h.type].name.toLowerCase() : 'somewhere'; };
    switch (t.kind) {
      case 'idle': return u.inHouse >= 0 ? `Waiting inside the ${hn(u.inHouse)}.` : 'Idle.';
      case 'deliver': return t.phase < 2 ? `Fetching ${WARE_NAME[t.ware].toLowerCase()} from the ${hn(t.from)}.` : t.toUnit >= 0 ? 'Bringing food to a soldier.' : t.tile >= 0 ? `Bringing ${WARE_NAME[t.ware].toLowerCase()} to a building site.` : `Delivering ${WARE_NAME[t.ware].toLowerCase()} to the ${hn(t.to)}.`;
      case 'buildHouse': return `Building the ${hn(t.house)}.`;
      case 'buildTile': { const o = this.g.map.obj[t.tile]; return o === Obj.RoadPlan ? 'Building a road.' : o === Obj.FieldPlan ? 'Ploughing a field.' : 'Planting a wine field.'; }
      case 'goWork': return `Walking to the ${hn(t.house)}.`;
      case 'work': return t.phase === 0 ? `Working in the ${hn(t.house)}.` : t.phase === 1 ? 'Walking to work outside.' : t.phase === 2 ? 'Working outside.' : 'Returning home.';
      case 'eat': return 'Going to the inn to eat.';
      case 'goBarracks': return 'Walking to the barracks.';
      case 'soldier': return 'On duty.';
      case 'die': return 'Dead.';
    }
    return '';
  }
}

export function fmtStock(n: number) { return n >= MAX_STOCK ? `${n} (full)` : String(n); }
