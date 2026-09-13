// ---- Enemy AI: scripted attack waves, defenders, attackers ----
import type { Game } from './sim';
import { HOUSE_DEFS } from './defs';
import { groupCentroid, orderAttackHouse, orderAttackUnit, orderMove, spawnSoldierGroup, isEnemy } from './combat';
import type { Group, House, Unit } from './state';

export function updateAI(g: Game) {
  const s = g.s;
  // enemies never starve: keeps pre-built towns static
  if (s.tick % 10 === 0) for (const u of s.units) if (u.owner !== s.player) u.condition = 1;

  // attack waves
  while (s.wavesDone < s.waves.length && s.waves[s.wavesDone].atTick <= s.tick) {
    const w = s.waves[s.wavesDone++];
    const grp = spawnSoldierGroup(g, w.owner, w.units, w.at);
    grp.aiRole = 'attack';
    const target = nearestPlayerHouse(g, w.at.x, w.at.y);
    if (target) orderAttackHouse(g, grp, target);
    g.msg(w.text ?? 'Enemy troops have been sighted!', 'alert', w.at.x, w.at.y);
    g.sound('alarm');
  }

  if (s.tick % 40 !== 0) return;
  for (const grp of s.groups) {
    if (grp.owner === s.player) continue;
    const alive = grp.units.map(id => g.unit(id)).filter((u): u is Unit => !!u && !u.dead);
    if (!alive.length) continue;
    const c = groupCentroid(g, grp);
    if (grp.aiRole === 'attack') {
      if (grp.order === 'idle' || (grp.order === 'attack' && grp.targetUnit < 0 && grp.targetHouse < 0)) {
        const u = nearestPlayerUnit(g, c.x, c.y, 14);
        if (u) { orderAttackUnit(g, grp, u); continue; }
        const h = nearestPlayerHouse(g, c.x, c.y);
        if (h) { orderAttackHouse(g, grp, h); continue; }
        const anyU = nearestPlayerUnit(g, c.x, c.y, 999);
        if (anyU) orderAttackUnit(g, grp, anyU);
      }
    } else {
      // defenders: react to player units near the post, then return
      if (!grp.post) grp.post = { x: Math.round(c.x), y: Math.round(c.y) };
      if (grp.order === 'idle') {
        const u = nearestPlayerUnit(g, grp.post.x, grp.post.y, 11);
        if (u) orderAttackUnit(g, grp, u);
        else if (Math.hypot(c.x - grp.post.x, c.y - grp.post.y) > 2.5) orderMove(g, grp, grp.post.x, grp.post.y);
      } else if (grp.order === 'attack') {
        const t = grp.targetUnit >= 0 ? g.unit(grp.targetUnit) : null;
        if (t && Math.hypot(t.x - grp.post.x, t.y - grp.post.y) > 22) orderMove(g, grp, grp.post.x, grp.post.y);
      }
    }
  }
}

function nearestPlayerHouse(g: Game, x: number, y: number): House | null {
  let best: House | null = null, bd = 1e9;
  for (const h of g.s.houses) {
    if (h.owner !== g.s.player || h.state === 'destroyed') continue;
    const def = HOUSE_DEFS[h.type];
    let d = Math.hypot(h.x + def.w / 2 - x, h.y + def.h / 2 - y);
    if (h.type === 'watchtower') d -= 4; // towers are annoying, take them out first
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}
function nearestPlayerUnit(g: Game, x: number, y: number, r: number): Unit | null {
  let best: Unit | null = null, bd = r;
  for (const u of g.s.units) {
    if (u.dead || u.inHouse >= 0 || !isEnemy(2, u.owner) || u.owner !== g.s.player) continue;
    const d = Math.hypot(u.x - x, u.y - y) - (u.task.kind === 'soldier' ? 2 : 0);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}
export function _g(_: Group) { }
