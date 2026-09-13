// ---- Soldiers, groups, projectiles, watchtowers ----
import { UNIT_DEFS, HOUSE_DEFS } from './defs';
import type { Game } from './sim';
import type { Unit, Group, House, Projectile } from './state';
import { idx, inBounds } from './map';
import type { Point } from './map';

export const isEnemy = (a: number, b: number) => a !== b && (a === 1 || b === 1);
const RANGED = new Set(['bowman', 'crossbowman']);
const ANTI_CAV = new Set(['lanceCarrier', 'pikeman']);

export function createGroup(g: Game, owner: number, unitIds: number[]): Group {
  const grp: Group = { id: g.nextId(), owner, units: [...unitIds], columns: 3, order: 'idle', dest: null, targetUnit: -1, targetHouse: -1 };
  g.s.groups.push(grp); g.groupById.set(grp.id, grp);
  for (const id of unitIds) { const u = g.unit(id); if (u) { if (u.groupId >= 0 && u.groupId !== grp.id) removeUnitFromGroup(g, u); u.groupId = grp.id; } }
  return grp;
}

export function removeUnitFromGroup(g: Game, u: Unit) {
  const grp = g.group(u.groupId);
  u.groupId = -1;
  if (!grp) return;
  grp.units = grp.units.filter(id => id !== u.id);
  if (!grp.units.length) { g.s.groups = g.s.groups.filter(x => x !== grp); g.groupById.delete(grp.id); }
}

export function groupCentroid(g: Game, grp: Group): Point {
  let x = 0, y = 0, n = 0;
  for (const id of grp.units) { const u = g.unit(id); if (u && !u.dead) { x += u.x; y += u.y; n++; } }
  return n ? { x: x / n, y: y / n } : (grp.dest ?? { x: 0, y: 0 });
}

function facingOf(g: Game, grp: Group, dest: Point): Point {
  const c = groupCentroid(g, grp);
  const dx = dest.x - c.x, dy = dest.y - c.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return (grp as any).facing ?? { x: 0, y: 1 };
  return Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
}

export function orderMove(g: Game, grp: Group, x: number, y: number) {
  const f = facingOf(g, grp, { x, y });
  (grp as any).facing = f;
  grp.dest = { x, y }; grp.order = 'move'; grp.targetUnit = -1; grp.targetHouse = -1;
  for (const id of grp.units) { const u = g.unit(id); if (u) { u.targetUnit = -1; u.targetHouse = -1; u.dest = null; u.path = []; } }
}
export function orderAttackUnit(g: Game, grp: Group, target: Unit) {
  grp.order = 'attack'; grp.targetUnit = target.id; grp.targetHouse = -1;
  for (const id of grp.units) { const u = g.unit(id); if (u) { u.targetUnit = target.id; u.targetHouse = -1; } }
}
export function orderAttackHouse(g: Game, grp: Group, h: House) {
  grp.order = 'attack'; grp.targetHouse = h.id; grp.targetUnit = -1;
  for (const id of grp.units) { const u = g.unit(id); if (u) { u.targetHouse = h.id; u.targetUnit = -1; } }
}
export function orderAttackMove(g: Game, grp: Group, x: number, y: number) {
  orderMove(g, grp, x, y);
  grp.order = 'attackMove';
}
export function orderHalt(g: Game, grp: Group) {
  const c = groupCentroid(g, grp);
  grp.dest = { x: Math.round(c.x), y: Math.round(c.y) };
  (grp as any).facing = (grp as any).facing ?? { x: 0, y: 1 };
  grp.order = 'idle'; grp.targetUnit = -1; grp.targetHouse = -1;
  for (const id of grp.units) { const u = g.unit(id); if (u) { u.targetUnit = -1; u.targetHouse = -1; u.dest = null; u.path = []; } }
}
export function splitGroup(g: Game, grp: Group): Group | null {
  if (grp.units.length < 2) return null;
  const half = grp.units.splice(Math.ceil(grp.units.length / 2));
  const n = createGroup(g, grp.owner, half);
  n.columns = grp.columns; n.dest = grp.dest ? { x: grp.dest.x + grp.columns + 1, y: grp.dest.y } : null; n.order = grp.dest ? 'move' : 'idle';
  (n as any).facing = (grp as any).facing;
  return n;
}
export function linkGroups(g: Game, a: Group, b: Group) {
  if (a === b || a.owner !== b.owner) return;
  for (const id of b.units) { const u = g.unit(id); if (u) u.groupId = a.id; a.units.push(id); }
  b.units = [];
  g.s.groups = g.s.groups.filter(x => x !== b); g.groupById.delete(b.id);
  if (a.dest) { a.order = 'move'; }
}

export function formationSlot(g: Game, grp: Group, u: Unit): Point | null {
  if (!grp.dest) return null;
  const i = grp.units.indexOf(u.id);
  if (i < 0) return null;
  const cols = Math.max(1, Math.min(grp.columns, grp.units.length));
  const col = i % cols, row = Math.floor(i / cols);
  const f: Point = (grp as any).facing ?? { x: 0, y: 1 };
  const r: Point = { x: -f.y, y: f.x };
  const off = col - Math.floor((cols - 1) / 2);
  let x = Math.round(grp.dest.x + r.x * off - f.x * row), y = Math.round(grp.dest.y + r.y * off - f.y * row);
  if (g.walkable(x, y)) return { x, y };
  // nearest walkable tile
  for (let rad = 1; rad <= 4; rad++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
    if (g.walkable(x + dx, y + dy)) return { x: x + dx, y: y + dy };
  }
  return null;
}

function nearestEnemyUnit(g: Game, u: Unit, radius: number): Unit | null {
  let best: Unit | null = null, bd = radius;
  for (const v of g.s.units) {
    if (v.dead || v.inHouse >= 0 || !isEnemy(u.owner, v.owner)) continue;
    const d = Math.hypot(v.x - u.x, v.y - u.y);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}
function nearestEnemyHouse(g: Game, u: Unit, radius: number): House | null {
  let best: House | null = null, bd = radius;
  for (const h of g.s.houses) {
    if (h.state === 'destroyed' || !isEnemy(u.owner, h.owner)) continue;
    const def = HOUSE_DEFS[h.type];
    const d = Math.hypot(h.x + def.w / 2 - u.x, h.y + def.h / 2 - u.y);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}

function houseDist(h: House, u: Unit): number {
  const def = HOUSE_DEFS[h.type];
  const cx = Math.max(h.x, Math.min(h.x + def.w - 1, u.x)), cy = Math.max(h.y, Math.min(h.y + def.h - 1, u.y));
  return Math.hypot(cx - u.x, cy - u.y);
}

function houseApproachTile(g: Game, h: House, u: Unit): Point | null {
  const def = HOUSE_DEFS[h.type];
  let best: Point | null = null, bd = 1e9;
  for (let y = h.y - 1; y <= h.y + def.h; y++) for (let x = h.x - 1; x <= h.x + def.w; x++) {
    const inside = x >= h.x && x < h.x + def.w && y >= h.y && y < h.y + def.h;
    if (inside || !g.walkable(x, y)) continue;
    const d = Math.hypot(x - u.x, y - u.y) + Math.random() * 0.3;
    if (d < bd) { bd = d; best = { x, y }; }
  }
  return best;
}

function damageOf(att: Unit, def: Unit): number {
  const a = UNIT_DEFS[att.type], d = UNIT_DEFS[def.type];
  let dmg = (a.attack ?? 1);
  if (RANGED.has(att.type)) dmg = Math.max(1, dmg - 1); // melee swing with a bow
  if (ANTI_CAV.has(att.type) && d.mounted) dmg *= 2;
  if (a.mounted && RANGED.has(def.type)) dmg = Math.round(dmg * 1.5);
  return Math.max(1, dmg - (d.defense ?? 0));
}

function hitUnit(g: Game, target: Unit, dmg: number, attacker: Unit | null) {
  target.hp -= dmg; target.hitFlash = 6;
  g.s.fx.push({ x: target.x, y: target.y - 0.3, kind: 'hit', t: 0 });
  if (attacker && target.task.kind === 'soldier' && target.targetUnit < 0 && target.targetHouse < 0) target.targetUnit = attacker.id;
  if (target.owner === g.s.player && (g.s.tick - (g as any).lastAttackMsg > 300 || (g as any).lastAttackMsg === undefined)) {
    (g as any).lastAttackMsg = g.s.tick; g.msg('We are under attack!', 'alert', target.x, target.y); g.sound('alarm');
  }
  if (target.hp <= 0) { g.killUnit(target); g.sound('death'); }
}

function hitHouse(g: Game, h: House, dmg: number) {
  h.hp -= dmg; h.lastAttackTick = g.s.tick;
  g.s.fx.push({ x: h.x + Math.random() * HOUSE_DEFS[h.type].w, y: h.y + Math.random() * HOUSE_DEFS[h.type].h, kind: 'hit', t: 0 });
  if (h.owner === g.s.player && (g.s.tick - (g as any).lastAttackMsg > 300 || (g as any).lastAttackMsg === undefined)) {
    (g as any).lastAttackMsg = g.s.tick; g.msg(`${HOUSE_DEFS[h.type].name} is under attack!`, 'alert', h.x, h.y); g.sound('alarm');
  }
  if (h.hp <= 0) g.destroyHouse(h, true);
}

function shoot(g: Game, u: Unit, tx: number, ty: number, targetUnit: number, targetHouse: number, dmg: number, kind: Projectile['kind']) {
  const d = Math.hypot(tx - u.x, ty - u.y);
  g.s.projectiles.push({ sx: u.x, sy: u.y, tx, ty, t: 0, dur: Math.max(4, Math.round(d / 0.45)), kind, targetUnit, targetHouse, dmg, owner: u.owner });
  g.sound(kind === 'stone' ? 'stone' : 'arrow');
}

function engageUnit(g: Game, u: Unit, t: Unit, mayMove: boolean) {
  const def = UNIT_DEFS[u.type];
  const range = def.range ?? 1;
  const d = Math.hypot(t.x - u.x, t.y - u.y);
  const inRange = range > 1 ? d <= range + 0.2 : d <= 1.5;
  if (inRange) {
    u.dest = null; u.path = [];
    u.dir = dirOf(t.x - u.x, t.y - u.y);
    if (u.attackCd <= 0) {
      u.attackCd = def.attackRate ?? 10;
      if (range > 1) shoot(g, u, t.x, t.y, t.id, -1, damageOf(u, t), u.type === 'crossbowman' ? 'bolt' : 'arrow');
      else { hitUnit(g, t, damageOf(u, t), u); g.sound('hit'); }
      u.frame++;
    }
    return;
  }
  if (!mayMove) { if (range > 1 && d > range + 0.2) { /* wait */ } return; }
  if (!u.dest || (g.s.tick + u.id) % 6 === 0) g.setDest(u, Math.round(t.x), Math.round(t.y), false);
}

function engageHouse(g: Game, u: Unit, h: House) {
  const def = UNIT_DEFS[u.type];
  const range = def.range ?? 1;
  const d = houseDist(h, u);
  const inRange = range > 1 ? d <= range + 0.2 : d <= 1.5;
  if (inRange) {
    u.dest = null; u.path = [];
    const hd = HOUSE_DEFS[h.type];
    u.dir = dirOf(h.x + hd.w / 2 - u.x, h.y + hd.h / 2 - u.y);
    if (u.attackCd <= 0) {
      u.attackCd = def.attackRate ?? 10;
      const dmg = Math.max(1, (def.attack ?? 1));
      if (range > 1) shoot(g, u, h.x + hd.w / 2, h.y + hd.h / 2, -1, h.id, Math.max(1, dmg - 1), u.type === 'crossbowman' ? 'bolt' : 'arrow');
      else { hitHouse(g, h, dmg); g.sound('hit'); }
      u.frame++;
    }
    return;
  }
  if (!u.dest || (g.s.tick + u.id) % 20 === 0) { const p = houseApproachTile(g, h, u); if (p) g.setDest(u, p.x, p.y, false); }
}

export function dirOf(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx);
  return ((Math.round((a - Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8;
}

function updateSoldier(g: Game, u: Unit) {
  const grp = u.groupId >= 0 ? g.group(u.groupId) : null;
  if (u.targetUnit >= 0) { const t = g.unit(u.targetUnit); if (!t || t.dead || t.inHouse >= 0) u.targetUnit = -1; }
  if (u.targetHouse >= 0) { const h = g.house(u.targetHouse); if (!h || h.state === 'destroyed') u.targetHouse = -1; }
  const order = grp?.order ?? 'idle';
  const def = UNIT_DEFS[u.type];
  const ranged = RANGED.has(u.type);

  if (grp && order === 'move') {
    const slot = formationSlot(g, grp, u);
    if (slot) { const r = g.goTo(u, slot.x, slot.y, false); if (r === 'blocked') { u.dest = null; } }
    // still defend ourselves when hit while marching: only ranged shoot back without stopping
    if (u.targetUnit >= 0 && ranged) { const t = g.unit(u.targetUnit)!; engageUnit(g, u, t, false); }
    return;
  }
  if (grp && order === 'attack') {
    if (grp.targetUnit >= 0) { const t = g.unit(grp.targetUnit); if (t && !t.dead && t.inHouse < 0) u.targetUnit = t.id; else { grp.targetUnit = -1; } }
    if (grp.targetHouse >= 0) { const h = g.house(grp.targetHouse); if (h && h.state !== 'destroyed') { if (u.targetUnit < 0) u.targetHouse = h.id; } else grp.targetHouse = -1; }
    if (grp.targetUnit < 0 && grp.targetHouse < 0) { grp.order = 'idle'; const c = groupCentroid(g, grp); grp.dest = { x: Math.round(c.x), y: Math.round(c.y) }; }
  }
  // acquire targets
  if (u.targetUnit < 0 && u.targetHouse < 0 && (g.s.tick + u.id) % 5 === 0) {
    const aggressive = order === 'attackMove' || grp?.aiRole === 'attack';
    const e = nearestEnemyUnit(g, u, def.sight + (aggressive ? 3 : 0));
    if (e) u.targetUnit = e.id;
    else if (aggressive) { const h = nearestEnemyHouse(g, u, def.sight + 6); if (h) u.targetHouse = h.id; }
  }
  if (u.targetUnit >= 0) {
    const t = g.unit(u.targetUnit)!;
    const mayMove = !ranged || order === 'attack' || order === 'attackMove' || grp?.aiRole === 'attack' || Math.hypot(t.x - u.x, t.y - u.y) <= 2;
    // idle melee units only chase within a leash of their post
    if (!ranged && order === 'idle' && grp?.dest && Math.hypot(grp.dest.x - u.x, grp.dest.y - u.y) > 14 && Math.hypot(t.x - u.x, t.y - u.y) > 2) { u.targetUnit = -1; }
    else { engageUnit(g, u, t, mayMove); return; }
  }
  if (u.targetHouse >= 0) { engageHouse(g, u, g.house(u.targetHouse)!); return; }
  // nothing to fight: return to formation
  if (grp && grp.dest) {
    const slot = formationSlot(g, grp, u);
    if (slot && (Math.round(u.x) !== slot.x || Math.round(u.y) !== slot.y)) { const r = g.goTo(u, slot.x, slot.y, false); if (r === 'blocked') u.dest = null; }
    else if (order === 'attackMove' && slot) { /* arrived */ }
  }
}

function updateTower(g: Game, h: House) {
  if (h.workerId < 0) return;
  const w = g.unit(h.workerId); if (!w || w.dead || w.inHouse !== h.id) return;
  if ((g.s.tick + h.id) % 30 !== 0) return;
  if (g.stockGet(h.stock, 'stone') <= 0) return;
  let best: Unit | null = null, bd = 6.5;
  for (const v of g.s.units) {
    if (v.dead || v.inHouse >= 0 || !isEnemy(h.owner, v.owner)) continue;
    const d = Math.hypot(v.x - h.x, v.y - h.y);
    if (d < bd) { bd = d; best = v; }
  }
  if (!best) return;
  g.stockAdd(h.stock, 'stone', -1);
  const d = Math.hypot(best.x - h.x, best.y - h.y);
  g.s.projectiles.push({ sx: h.x, sy: h.y - 0.6, tx: best.x, ty: best.y, t: 0, dur: Math.max(5, Math.round(d / 0.35)), kind: 'stone', targetUnit: best.id, targetHouse: -1, dmg: 6, owner: h.owner });
  g.sound('stone');
}

export function updateCombat(g: Game) {
  const s = g.s;
  for (const u of s.units) if (!u.dead && u.task.kind === 'soldier' && u.inHouse < 0) updateSoldier(g, u);
  for (const h of s.houses) if (h.state === 'done' && h.type === 'watchtower') updateTower(g, h);
  // check group order completion
  if (s.tick % 10 === 0) {
    for (const grp of s.groups) {
      if (grp.order !== 'move' && grp.order !== 'attackMove') continue;
      let all = true;
      for (const id of grp.units) { const u = g.unit(id); if (!u || u.dead) continue; if (u.dest || u.moving) { all = false; break; } }
      if (all) { if (grp.order === 'move') grp.order = 'idle'; else if (grp.order === 'attackMove') { grp.order = 'idle'; } }
    }
    s.groups = s.groups.filter(grp => grp.units.some(id => { const u = g.unit(id); return u && !u.dead; }) || (g.groupById.delete(grp.id), false));
  }
  // projectiles
  for (let i = s.projectiles.length - 1; i >= 0; i--) {
    const p = s.projectiles[i];
    p.t++;
    if (p.t < p.dur) continue;
    s.projectiles.splice(i, 1);
    if (p.targetHouse >= 0) { const h = g.house(p.targetHouse); if (h && h.state !== 'destroyed') hitHouse(g, h, p.dmg); continue; }
    const t = g.unit(p.targetUnit);
    if (t && !t.dead && t.inHouse < 0 && Math.hypot(t.x - p.tx, t.y - p.ty) <= 0.9) hitUnit(g, t, p.dmg, null);
    else { // missed: maybe hit whoever stands there
      for (const v of s.units) { if (v.dead || v.inHouse >= 0 || !isEnemy(p.owner, v.owner)) continue; if (Math.hypot(v.x - p.tx, v.y - p.ty) <= 0.5) { hitUnit(g, v, Math.max(1, p.dmg - 1), null); break; } }
    }
  }
}

export function unitsInRect(g: Game, owner: number, x0: number, y0: number, x1: number, y1: number): Unit[] {
  return g.s.units.filter(u => !u.dead && u.owner === owner && u.inHouse < 0 && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1);
}

export function spawnSoldierGroup(g: Game, owner: number, types: { type: import('./defs').UnitType; count: number }[], at: Point): Group {
  const ids: number[] = [];
  const total = types.reduce((a, b) => a + b.count, 0);
  const cols = Math.max(2, Math.ceil(Math.sqrt(total)));
  let k = 0;
  for (const t of types) for (let i = 0; i < t.count; i++) {
    const px = at.x + (k % cols) - Math.floor(cols / 2), py = at.y + Math.floor(k / cols);
    let sx = px, sy = py;
    if (!g.walkable(sx, sy)) {
      outer: for (let r = 1; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (g.walkable(px + dx, py + dy)) { sx = px + dx; sy = py + dy; break outer; }
    }
    const u = g.addUnit(t.type, owner, sx, sy);
    ids.push(u.id); k++;
  }
  const grp = createGroup(g, owner, ids);
  grp.columns = cols;
  grp.dest = { x: at.x, y: at.y };
  (grp as any).facing = { x: 0, y: 1 };
  return grp;
}

export function _unused(_: typeof idx, __: typeof inBounds) { }
