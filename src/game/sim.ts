// ---- Core simulation: houses, units, deliveries, economy ----
import {
  HOUSE_DEFS, UNIT_DEFS, MAX_STOCK, HUNGER_PER_TICK, SCHOOL_TRAIN_TIME, TREE_GROW_TICKS, FIELD_GROW_TICKS,
  FOOD, FOOD_VALUE, SOLDIER_TYPES, WARES, WARE_NAME,
} from './defs';
import type { HouseType, UnitType, Ware } from './defs';
import { Obj, Terrain, findPath, idx, inBounds, isBuildable, walkableGround } from './map';
import type { MapData, Point } from './map';
import type { GameState, House, Unit, Group, Task, Message, Stock } from './state';
import { updateCombat, createGroup, removeUnitFromGroup } from './combat';
import { updateAI } from './ai';

export const HOUSE_WORK_RADIUS = 8;

export class Game {
  s: GameState;
  map: MapData;
  doorTiles = new Set<number>();
  houseById = new Map<number, House>();
  unitById = new Map<number, Unit>();
  groupById = new Map<number, Group>();
  dirtyTiles: number[] = [];       // renderer redraws these terrain tiles
  onMessage?: (m: Message) => void;
  onSound?: (name: string) => void;

  constructor(state: GameState) {
    this.s = state;
    this.map = state.map;
    this.rebuildIndexes();
  }

  rebuildIndexes() {
    this.houseById.clear(); this.unitById.clear(); this.groupById.clear(); this.doorTiles.clear();
    for (const h of this.s.houses) { this.houseById.set(h.id, h); if (h.state !== 'destroyed') this.doorTiles.add(this.doorIndex(h)); }
    for (const u of this.s.units) this.unitById.set(u.id, u);
    for (const g of this.s.groups) this.groupById.set(g.id, g);
  }

  // ---------- helpers ----------
  get tick() { return this.s.tick; }
  nextId() { return this.s.nextId++; }
  house(id: number) { return this.houseById.get(id); }
  unit(id: number) { return this.unitById.get(id); }
  group(id: number) { return this.groupById.get(id); }

  doorPos(h: House): Point { return { x: h.x + HOUSE_DEFS[h.type].entrance, y: h.y + HOUSE_DEFS[h.type].h - 1 }; }
  doorIndex(h: House) { const d = this.doorPos(h); return idx(this.map, d.x, d.y); }
  frontPos(h: House): Point { const d = this.doorPos(h); return { x: d.x, y: d.y + 1 }; }

  msg(text: string, kind: Message['kind'] = 'info', x?: number, y?: number) {
    const m: Message = { tick: this.s.tick, text, kind, x, y };
    this.s.messages.push(m);
    if (this.s.messages.length > 60) this.s.messages.shift();
    this.onMessage?.(m);
  }
  sound(name: string) { this.onSound?.(name); }

  walkable = (x: number, y: number): boolean => {
    if (!walkableGround(this.map, x, y)) return false;
    const i = idx(this.map, x, y);
    return this.map.house[i] < 0 || this.doorTiles.has(i);
  };
  roadWalkable = (x: number, y: number): boolean => {
    if (!inBounds(this.map, x, y)) return false;
    const i = idx(this.map, x, y);
    if (this.doorTiles.has(i)) return true;
    const t = this.map.terrain[i];
    if (t === Terrain.Water || t === Terrain.Mountain) return false;
    const o = this.map.obj[i];
    return (o === Obj.Road || o === Obj.RoadPlan) && this.map.house[i] < 0;
  };

  markDirty(x: number, y: number) { this.dirtyTiles.push(idx(this.map, x, y)); }

  stockGet(s: Stock, w: Ware) { return s[w] ?? 0; }
  stockAdd(s: Stock, w: Ware, n: number) { s[w] = (s[w] ?? 0) + n; if (s[w]! <= 0) delete s[w]; }

  // ---------- entity creation ----------
  addUnit(type: UnitType, owner: number, x: number, y: number): Unit {
    const def = UNIT_DEFS[type];
    const u: Unit = {
      id: this.nextId(), type, owner, x, y, path: [], dest: null, pathFails: 0,
      hp: def.hp, maxHp: def.hp, condition: 1, task: { kind: 'idle', wait: 0 }, inHouse: -1, carry: null,
      dir: 0, frame: 0, moving: false, groupId: -1, attackCd: 0, home: -1, targetUnit: -1, targetHouse: -1,
      dead: false, hitFlash: 0, guardPos: null,
    };
    if (SOLDIER_TYPES.includes(type)) u.task = { kind: 'soldier' };
    this.s.units.push(u);
    this.unitById.set(u.id, u);
    return u;
  }

  addHouse(type: HouseType, owner: number, x: number, y: number, done = false): House {
    const def = HOUSE_DEFS[type];
    const h: House = {
      id: this.nextId(), type, x, y, owner, state: done ? 'done' : 'building', progress: done ? def.buildTime : 0,
      delivered: { wood: done ? def.cost.wood : 0, stone: done ? def.cost.stone : 0 }, hp: done ? def.hp : 1,
      workerId: -1, builderId: -1, stock: {}, out: {}, reserved: {}, incoming: {}, workTimer: 0, working: false,
      recipeIdx: 0, enabled: {}, queue: [], trainTimer: 0, blocked: {}, recruits: [], anim: 0, lastAttackTick: -999,
    };
    for (const w of def.outputs) h.enabled[w] = true;
    this.s.houses.push(h);
    this.houseById.set(h.id, h);
    for (let yy = 0; yy < def.h; yy++) for (let xx = 0; xx < def.w; xx++) {
      const i = idx(this.map, x + xx, y + yy);
      this.map.house[i] = h.id; this.map.obj[i] = Obj.None; this.map.data[i] = 0;
      this.markDirty(x + xx, y + yy);
    }
    this.doorTiles.add(this.doorIndex(h));
    // the tile in front of the door becomes a road automatically
    const f = this.frontPos(h);
    if (isBuildable(this.map, f.x, f.y) || this.map.obj[idx(this.map, f.x, f.y)] === Obj.RoadPlan) {
      this.map.obj[idx(this.map, f.x, f.y)] = Obj.Road; this.map.data[idx(this.map, f.x, f.y)] = 0; this.markDirty(f.x, f.y);
    }
    this.claimTerritory(h);
    return h;
  }

  claimTerritory(h: House) {
    const def = HOUSE_DEFS[h.type];
    const r = def.special === 'store' || def.special === 'barracks' ? 12 : 8;
    const cx = h.x + def.w / 2, cy = h.y + def.h / 2;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (!inBounds(this.map, x, y)) continue;
      if (Math.hypot(x - cx, y - cy) > r) continue;
      const i = idx(this.map, x, y);
      if (this.map.owner[i] === 0) this.map.owner[i] = h.owner;
    }
  }

  /** Validate a house placement. Returns null if ok, or a reason string. */
  canPlaceHouse(type: HouseType, x: number, y: number, owner: number): string | null {
    const def = HOUSE_DEFS[type];
    for (let yy = 0; yy < def.h; yy++) for (let xx = 0; xx < def.w; xx++) {
      if (!isBuildable(this.map, x + xx, y + yy)) return 'Ground is not free';
      const o = this.map.owner[idx(this.map, x + xx, y + yy)];
      if (o !== 0 && o !== owner) return 'Enemy territory';
    }
    const f = this.frontPos(this.doorHouseLike(type, x, y));
    if (!inBounds(this.map, f.x, f.y)) return 'No room for the entrance';
    const fi = idx(this.map, f.x, f.y);
    const fo = this.map.obj[fi];
    const ft = this.map.terrain[fi];
    if (ft === Terrain.Water || ft === Terrain.Mountain || this.map.house[fi] >= 0) return 'Entrance is blocked';
    if (fo !== Obj.None && fo !== Obj.Road && fo !== Obj.RoadPlan && fo !== Obj.Stump && fo !== Obj.Bush) return 'Entrance is blocked';
    if (def.special === 'mine') {
      const want = def.mineWare === 'coal' ? Obj.Coal : def.mineWare === 'ironOre' ? Obj.Iron : Obj.Gold;
      if (!this.findOreTile(x, y, def.w, def.h, want, true)) return `Must be placed next to a ${WARE_NAME[def.mineWare!].toLowerCase()} deposit`;
    }
    return null;
  }
  private doorHouseLike(type: HouseType, x: number, y: number): House { return { type, x, y } as House; }

  findOreTile(hx: number, hy: number, w: number, h: number, want: Obj, any: boolean): Point | null {
    let best: Point | null = null, bd = 1e9;
    for (let y = hy - 2; y < hy + h + 2; y++) for (let x = hx - 2; x < hx + w + 2; x++) {
      if (!inBounds(this.map, x, y)) continue;
      const i = idx(this.map, x, y);
      if (this.map.obj[i] === want && (any || this.map.data[i] > 0)) {
        const d = Math.abs(x - hx - w / 2) + Math.abs(y - hy - h / 2);
        if (d < bd) { bd = d; best = { x, y }; }
      }
    }
    return best;
  }

  placeHouse(type: HouseType, x: number, y: number, owner: number): House | null {
    if (this.canPlaceHouse(type, x, y, owner)) return null;
    const h = this.addHouse(type, owner, x, y, false);
    if (owner === this.s.player) {
      this.s.playerHasPlacedHouse = true;
      this.sound('place');
      const def = HOUSE_DEFS[type];
      if (def.special === 'quarry' && !this.nearestMountainSpot(h)) this.msg('Warning: no mountain within reach of this quarry.', 'warn', x, y);
      if (def.special === 'woodcutters' && !this.findTree(h, true)) this.msg("Warning: no trees within reach of this woodcutter's hut.", 'warn', x, y);
    }
    return h;
  }

  /** Player removes a house (or a construction site). */
  demolishHouse(h: House) {
    if (h.state === 'destroyed') return;
    this.destroyHouse(h, false);
  }

  destroyHouse(h: House, byEnemy: boolean) {
    if (h.state === 'destroyed') return;
    const def = HOUSE_DEFS[h.type];
    h.state = 'destroyed'; h.hp = 0;
    this.doorTiles.delete(this.doorIndex(h));
    for (let yy = 0; yy < def.h; yy++) for (let xx = 0; xx < def.w; xx++) {
      const i = idx(this.map, h.x + xx, h.y + yy);
      if (this.map.house[i] === h.id) { this.map.house[i] = -1; this.map.obj[i] = Obj.None; this.map.data[i] = 0; this.markDirty(h.x + xx, h.y + yy); }
    }
    // units inside die (or are thrown out if it was the player's own demolition)
    for (const u of this.s.units) {
      if (u.dead) continue;
      if (u.inHouse === h.id) {
        if (byEnemy) this.killUnit(u); else { u.inHouse = -1; const d = this.doorPos(h); u.x = d.x; u.y = d.y; u.task = { kind: 'idle', wait: 0 }; u.home = -1; u.path = []; u.dest = null; }
      } else if (u.home === h.id) { u.home = -1; if (u.task.kind === 'goWork' || u.task.kind === 'work') u.task = { kind: 'idle', wait: 0 }; }
      const t = u.task;
      if ((t.kind === 'deliver' && (t.from === h.id || t.to === h.id)) || (t.kind === 'buildHouse' && t.house === h.id) || (t.kind === 'eat' && t.house === h.id) || (t.kind === 'goBarracks' && t.house === h.id)) {
        this.cancelTask(u);
      }
    }
    h.recruits = []; h.workerId = -1; h.builderId = -1;
    this.s.fx.push({ x: h.x + def.w / 2, y: h.y + def.h / 2, kind: 'smoke', t: 0 });
    if (h.owner === this.s.player) { this.msg(`${def.name} ${byEnemy ? 'has been destroyed!' : 'demolished.'}`, byEnemy ? 'alert' : 'info', h.x, h.y); if (byEnemy) this.sound('destroy'); }
    for (const g of this.s.groups) if (g.targetHouse === h.id) { g.targetHouse = -1; if (g.order === 'attack') g.order = 'idle'; }
  }

  cancelTask(u: Unit) {
    const t = u.task;
    if (t.kind === 'deliver') {
      const from = this.house(t.from);
      if (t.phase < 2 && from && from.state !== 'destroyed') this.stockAdd(from.reserved, t.ware, -1);
      if (t.toUnit >= 0) { /* nothing reserved */ }
      else if (t.tile >= 0) { delete this.s.tileIncoming[t.tile]; }
      else { const to = this.house(t.to); if (to && to.state !== 'destroyed') this.stockAdd(to.incoming, t.ware, -1); }
      if (u.carry) { // bring it home
        const store = this.nearestStore(u.owner, u.x, u.y);
        if (store && t.to !== store.id) { u.task = { kind: 'deliver', from: -1, to: store.id, toUnit: -1, ware: u.carry, phase: 2, tile: -1 }; this.stockAdd(store.incoming, u.carry, 1); u.dest = null; u.path = []; return; }
        u.carry = null;
      }
    }
    if (t.kind === 'buildHouse') { const h = this.house(t.house); if (h && h.builderId === u.id) h.builderId = -1; }
    if (t.kind === 'buildTile') { /* tile remains a plan */ }
    u.task = { kind: 'idle', wait: 5 };
    u.dest = null; u.path = [];
  }

  killUnit(u: Unit) {
    if (u.dead) return;
    u.dead = true;
    this.cancelTask(u);
    if (u.inHouse >= 0) { const h = this.house(u.inHouse); if (h) { if (h.workerId === u.id) { h.workerId = -1; h.working = false; } h.recruits = h.recruits.filter(id => id !== u.id); } }
    if (u.home >= 0) { const h = this.house(u.home); if (h && h.workerId === u.id) { h.workerId = -1; h.working = false; } }
    if (u.groupId >= 0) removeUnitFromGroup(this, u);
    u.task = { kind: 'die', timer: 40 };
    if (u.owner === this.s.player) this.s.stats.lost++; else this.s.stats.killed++;
  }

  /** After leaving a house, walk onto the road in front of it. */
  stepOut(u: Unit, h: House) {
    const f = this.frontPos(h);
    if (this.walkable(f.x, f.y)) this.setDest(u, f.x, f.y, false);
  }

  nearestStore(owner: number, x: number, y: number): House | null {
    let best: House | null = null, bd = 1e9;
    for (const h of this.s.houses) {
      if (h.owner !== owner || h.state !== 'done' || h.type !== 'storehouse') continue;
      const d = Math.abs(h.x - x) + Math.abs(h.y - y);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  // ---------- roads & fields ----------
  placePlan(kind: 'road' | 'field' | 'wine', x: number, y: number, owner: number): boolean {
    if (!isBuildable(this.map, x, y)) return false;
    const i = idx(this.map, x, y);
    if (this.map.owner[i] !== 0 && this.map.owner[i] !== owner) return false;
    if (kind !== 'road' && this.map.terrain[i] !== Terrain.Grass && this.map.terrain[i] !== Terrain.Dirt) return false;
    this.map.obj[i] = kind === 'road' ? Obj.RoadPlan : kind === 'field' ? Obj.FieldPlan : Obj.WinePlan;
    this.map.data[i] = 0;
    this.markDirty(x, y);
    return true;
  }
  removePlan(x: number, y: number) {
    const i = idx(this.map, x, y);
    const o = this.map.obj[i];
    if (o === Obj.RoadPlan || o === Obj.FieldPlan || o === Obj.WinePlan) {
      this.map.obj[i] = Obj.None; this.map.data[i] = 0; delete this.s.tileIncoming[i]; this.markDirty(x, y);
      for (const u of this.s.units) if (!u.dead && ((u.task.kind === 'buildTile' && u.task.tile === i) || (u.task.kind === 'deliver' && u.task.tile === i))) this.cancelTask(u);
    } else if (o === Obj.Road || o === Obj.Field || o === Obj.WineField) {
      this.map.obj[i] = Obj.None; this.map.data[i] = 0; this.markDirty(x, y);
    }
  }

  // ---------- main tick ----------
  update() {
    const s = this.s;
    s.tick++;
    if (s.tick % 5 === 0) this.matchDeliveries();
    if (s.tick % 7 === 0) this.assignLabourers();
    if (s.tick % 9 === 0) this.assignWorkers();
    if (s.tick % 50 === 0) this.growth();
    for (const h of s.houses) if (h.state !== 'destroyed') this.updateHouse(h);
    for (const u of s.units) if (!u.dead || u.task.kind === 'die') this.updateUnit(u);
    updateCombat(this);
    updateAI(this);
    // fx
    for (let i = s.fx.length - 1; i >= 0; i--) { const f = s.fx[i]; f.t++; if (f.t > (f.kind === 'smoke' ? 120 : 20)) s.fx.splice(i, 1); }
    // cleanup dead
    if (s.tick % 40 === 0) {
      const before = s.units.length;
      s.units = s.units.filter(u => !(u.dead && u.task.kind !== 'die'));
      if (s.units.length !== before) { this.unitById.clear(); for (const u of s.units) this.unitById.set(u.id, u); }
      for (const k of Object.keys(s.pairCooldown)) if (s.pairCooldown[k] < s.tick) delete s.pairCooldown[k];
    }
    if (s.tick % 20 === 0 && s.outcome === 'playing') this.checkObjectives();
    if (s.tick % 200 === 100) this.advisor();
  }

  /** Periodic warnings that the original game's advisor would give. */
  advisor() {
    const s = this.s, p = s.player;
    const store = s.houses.find(h => h.owner === p && h.state === 'done' && h.type === 'storehouse');
    if (store) {
      const sd = this.doorPos(store);
      for (const h of s.houses) {
        if (h.owner !== p || h.state !== 'building' || (h as any).warnedRoad) continue;
        if (h.delivered.wood + h.delivered.stone > 0) continue;
        const d = this.doorPos(h);
        const path = findPath(this.map, sd.x, sd.y, d.x, d.y, this.roadWalkable, 4000, this.walkable);
        if (!path) { (h as any).warnedRoad = true; this.msg(`${HOUSE_DEFS[h.type].name} is not connected to the storehouse by road.`, 'warn', h.x, h.y); }
      }
    }
    for (const h of s.houses) {
      if (h.owner !== p || h.state !== 'done') continue;
      if (h.type === 'school' && h.queue.length && this.stockGet(h.stock, 'gold') === 0 && !h.working && (s.tick - ((h as any).warnedGold ?? -9999)) > 3000) {
        const anyGold = s.houses.some(x => x.owner === p && x.state === 'done' && this.stockGet(x.stock, 'gold') + this.stockGet(x.out, 'gold') > 0 && x !== h);
        if (!anyGold) { (h as any).warnedGold = s.tick; this.msg('The school has no gold to train citizens. Mine gold ore and smelt it.', 'warn', h.x, h.y); }
      }
    }
    const hungry = s.units.filter(u => !u.dead && u.owner === p && u.task.kind !== 'soldier' && u.condition < 0.3);
    if (hungry.length >= 3 && (s.tick - ((s as any).warnedHunger ?? -9999)) > 3000) {
      const inn = s.houses.find(h => h.owner === p && h.state === 'done' && h.type === 'inn');
      const food = inn && FOOD.some(f => this.stockGet(inn.stock, f) > 0);
      if (!inn) { (s as any).warnedHunger = s.tick; this.msg('Your people are hungry and there is no inn!', 'alert'); }
      else if (!food) { (s as any).warnedHunger = s.tick; this.msg('Your people are hungry and the inn has no food!', 'alert', inn.x, inn.y); }
    }
  }

  // ---------- growth of trees / fields ----------
  growth() {
    const m = this.map;
    const stepTree = Math.max(1, Math.round(255 / (TREE_GROW_TICKS / 50)));
    const stepField = Math.max(1, Math.round(5 / (FIELD_GROW_TICKS / 50)));
    for (let i = 0; i < m.obj.length; i++) {
      const o = m.obj[i];
      if (o === Obj.Sapling) { const d = m.data[i] + stepTree; if (d >= 255) { m.obj[i] = Obj.Tree; m.data[i] = 255; } else m.data[i] = d; this.dirtyTiles.push(i); }
      else if (o === Obj.Stump) { const d = m.data[i] + 1; if (d > 30) { m.obj[i] = Obj.None; m.data[i] = 0; } else m.data[i] = d; this.dirtyTiles.push(i); }
      else if (o === Obj.Field) { const d = m.data[i]; if (d >= 1 && d < 6) { m.data[i] = Math.min(6, d + (Math.random() < 0.5 ? stepField : 0)); this.dirtyTiles.push(i); } }
      else if (o === Obj.WineField) { const d = m.data[i]; if (d >= 1 && d < 6) { m.data[i] = Math.min(6, d + (Math.random() < 0.4 ? stepField : 0)); this.dirtyTiles.push(i); } }
    }
  }

  // ---------- houses ----------
  updateHouse(h: House) {
    const def = HOUSE_DEFS[h.type];
    h.anim++;
    if (h.state === 'building') {
      // hp grows with progress
      h.hp = Math.max(1, Math.floor(def.hp * h.progress / def.buildTime));
      return;
    }
    if (!h.workerId && h.workerId !== 0) h.workerId = -1;
    switch (def.special) {
      case 'school': this.updateSchool(h); break;
      case 'tower': break; // handled in combat
      case 'store': case 'inn': case 'barracks': break;
      case 'quarry': case 'woodcutters': case 'farm': case 'vineyard': break; // worker-driven
      case 'mine': this.updateMine(h); break;
      default: this.updateProduction(h);
    }
  }

  workerInside(h: House): Unit | null {
    if (h.workerId < 0) return null;
    const u = this.unit(h.workerId);
    if (!u || u.dead || u.inHouse !== h.id) return null;
    return u;
  }

  updateProduction(h: House) {
    const def = HOUSE_DEFS[h.type];
    const worker = this.workerInside(h);
    if (!worker) { h.working = false; return; }
    if (h.working) {
      if (--h.workTimer <= 0) {
        h.working = false;
        const r = def.recipes![h.recipeIdx];
        for (const w of Object.keys(r.outputs) as Ware[]) { this.stockAdd(h.out, w, r.outputs[w]!); this.stockAdd(this.s.stats.produced, w, r.outputs[w]!) ; }
        if (h.owner !== this.s.player) { /* enemy production stays local */ }
        else this.stockAdd(this.s.stats.produced, 'trunk', 0);
      }
      return;
    }
    if (worker.condition < 0.25) return; // too hungry to work – unit logic sends them to eat
    const recipes = def.recipes ?? [];
    // rotate through enabled recipes so multi-output houses alternate
    for (let k = 0; k < recipes.length; k++) {
      const ri = (h.recipeIdx + 1 + k) % recipes.length;
      const r = recipes[ri];
      const outWares = Object.keys(r.outputs) as Ware[];
      if (!outWares.every(w => h.enabled[w] !== false)) continue;
      if (!outWares.every(w => this.stockGet(h.out, w) + (r.outputs[w] ?? 0) <= MAX_STOCK + 1)) continue;
      const inWares = Object.keys(r.inputs) as Ware[];
      if (!inWares.every(w => this.stockGet(h.stock, w) >= r.inputs[w]!)) continue;
      for (const w of inWares) this.stockAdd(h.stock, w, -r.inputs[w]!);
      h.recipeIdx = ri; h.working = true; h.workTimer = r.time;
      return;
    }
  }

  updateMine(h: House) {
    const def = HOUSE_DEFS[h.type];
    const worker = this.workerInside(h);
    if (!worker) { h.working = false; return; }
    const ware = def.mineWare!;
    if (h.working) {
      if (--h.workTimer <= 0) { h.working = false; this.stockAdd(h.out, ware, 1); this.stockAdd(this.s.stats.produced, ware, 1); }
      return;
    }
    if (worker.condition < 0.25) return;
    if (this.stockGet(h.out, ware) >= MAX_STOCK) return;
    const want = ware === 'coal' ? Obj.Coal : ware === 'ironOre' ? Obj.Iron : Obj.Gold;
    const t = this.findOreTile(h.x, h.y, def.w, def.h, want, false);
    if (!t) { if (!h.depleted) { h.depleted = true; if (h.owner === this.s.player) this.msg(`${def.name} is exhausted.`, 'warn', h.x, h.y); } return; }
    const i = idx(this.map, t.x, t.y);
    this.map.data[i]--;
    if (this.map.data[i] === 0) { this.markDirty(t.x, t.y); }
    h.working = true; h.workTimer = 110;
  }

  updateSchool(h: House) {
    if (h.queue.length === 0) { h.working = false; return; }
    if (!h.working) {
      if (this.stockGet(h.stock, 'gold') < 1) return;
      this.stockAdd(h.stock, 'gold', -1);
      h.working = true; h.trainTimer = SCHOOL_TRAIN_TIME;
      return;
    }
    if (--h.trainTimer <= 0) {
      h.working = false;
      const type = h.queue.shift()!;
      const d = this.doorPos(h);
      const u = this.addUnit(type, h.owner, d.x, d.y);
      u.task = { kind: 'idle', wait: 0 };
      this.s.stats.trained[type] = (this.s.stats.trained[type] ?? 0) + 1;
      if (h.owner === this.s.player) this.sound('trained');
      // step out onto the road
      const f = this.frontPos(h);
      if (this.walkable(f.x, f.y)) this.setDest(u, f.x, f.y, false);
    }
  }

  schoolTrain(h: House, type: UnitType) { if (h.queue.length < 6) h.queue.push(type); }
  schoolCancel(h: House, i: number) { h.queue.splice(i, 1); }

  /** Barracks: equip one recruit as the given soldier type. */
  equipSoldier(h: House, type: UnitType): boolean {
    const def = UNIT_DEFS[type];
    if (!def.equipment) return false;
    const recruitId = h.recruits.find(id => { const u = this.unit(id); return u && !u.dead; });
    if (recruitId === undefined) return false;
    for (const w of Object.keys(def.equipment) as Ware[]) if (this.stockGet(h.stock, w) < def.equipment[w]!) return false;
    for (const w of Object.keys(def.equipment) as Ware[]) this.stockAdd(h.stock, w, -def.equipment[w]!);
    const u = this.unit(recruitId)!;
    h.recruits = h.recruits.filter(id => id !== recruitId);
    u.type = type; u.hp = def.hp; u.maxHp = def.hp; u.inHouse = -1; u.home = -1;
    const d = this.doorPos(h); u.x = d.x; u.y = d.y;
    u.task = { kind: 'soldier' };
    this.s.stats.trained[type] = (this.s.stats.trained[type] ?? 0) + 1;
    // join a group waiting in front of the barracks, otherwise make a new one
    const f = this.frontPos(h);
    let g: Group | null = null;
    for (const gg of this.s.groups) if (gg.owner === h.owner && gg.order === 'idle' && gg.dest && Math.abs(gg.dest.x - f.x) <= 3 && Math.abs(gg.dest.y - f.y - 2) <= 3 && gg.units.length < 12) { const first = this.unit(gg.units[0]); if (first && first.type === type) { g = gg; break; } }
    if (!g) { g = createGroup(this, h.owner, [u.id]); g.dest = { x: f.x, y: f.y + 2 }; }
    else { g.units.push(u.id); u.groupId = g.id; }
    g.order = 'move';
    this.sound('equip');
    return true;
  }

  // ---------- worker assignment ----------
  assignWorkers() {
    for (const h of this.s.houses) {
      if (h.state !== 'done') continue;
      const def = HOUSE_DEFS[h.type];
      if (!def.worker) continue;
      if (h.workerId >= 0) { const w = this.unit(h.workerId); if (w && !w.dead) continue; h.workerId = -1; }
      // find an idle unit of the right type
      let best: Unit | null = null, bd = 1e9;
      for (const u of this.s.units) {
        if (u.dead || u.owner !== h.owner || u.type !== def.worker || u.task.kind !== 'idle' || u.inHouse >= 0 || u.home >= 0) continue;
        const d = Math.abs(u.x - h.x) + Math.abs(u.y - h.y);
        if (d < bd) { bd = d; best = u; }
      }
      if (best) { best.home = h.id; h.workerId = best.id; best.task = { kind: 'goWork', house: h.id }; best.dest = null; best.path = []; }
    }
    // recruits go to a barracks
    for (const u of this.s.units) {
      if (u.dead || u.type !== 'recruit' || u.task.kind !== 'idle' || u.inHouse >= 0 || u.home >= 0) continue;
      let best: House | null = null, bd = 1e9;
      for (const h of this.s.houses) {
        if (h.owner !== u.owner || h.state !== 'done' || h.type !== 'barracks') continue;
        const d = Math.abs(u.x - h.x) + Math.abs(u.y - h.y);
        if (d < bd) { bd = d; best = h; }
      }
      if (best) { u.task = { kind: 'goBarracks', house: best.id }; u.dest = null; u.path = []; }
    }
  }

  // ---------- labourers ----------
  assignLabourers() {
    const idle: Unit[] = [];
    for (const u of this.s.units) if (!u.dead && u.type === 'laborer' && u.task.kind === 'idle' && u.inHouse < 0 && u.condition > 0.3) idle.push(u);
    if (!idle.length) return;
    // houses first
    for (const h of this.s.houses) {
      if (!idle.length) return;
      if (h.state !== 'building') continue;
      if (h.builderId >= 0) { const b = this.unit(h.builderId); if (b && !b.dead && b.task.kind === 'buildHouse' && b.task.house === h.id) continue; h.builderId = -1; }
      const f = this.frontPos(h);
      let bi = -1, bd = 1e9;
      for (let i = 0; i < idle.length; i++) { const u = idle[i]; if (u.owner !== h.owner) continue; const d = Math.abs(u.x - f.x) + Math.abs(u.y - f.y); if (d < bd) { bd = d; bi = i; } }
      if (bi >= 0) { const u = idle.splice(bi, 1)[0]; h.builderId = u.id; u.task = { kind: 'buildHouse', house: h.id, phase: 0 }; u.dest = null; u.path = []; }
    }
    // then plan tiles
    const taken = new Set<number>();
    for (const u of this.s.units) if (!u.dead && u.task.kind === 'buildTile') taken.add(u.task.tile);
    const m = this.map;
    for (const u of idle) {
      let best = -1, bd = 1e9;
      const ux = Math.round(u.x), uy = Math.round(u.y);
      const r = 24;
      for (let y = Math.max(0, uy - r); y < Math.min(m.h, uy + r); y++) for (let x = Math.max(0, ux - r); x < Math.min(m.w, ux + r); x++) {
        const i = idx(m, x, y);
        const o = m.obj[i];
        if (o !== Obj.RoadPlan && o !== Obj.FieldPlan && o !== Obj.WinePlan) continue;
        if (taken.has(i)) continue;
        if (m.owner[i] !== u.owner && m.owner[i] !== 0) continue;
        const d = m.data[i];
        if (o !== Obj.FieldPlan && d === 20) continue; // waiting for material
        if (m.owner[i] === 0 && u.owner !== this.s.player) continue;
        const dist = Math.abs(x - ux) + Math.abs(y - uy);
        if (dist < bd) { bd = dist; best = i; }
      }
      if (best >= 0) { taken.add(best); u.task = { kind: 'buildTile', tile: best, phase: 0, timer: 0 }; u.dest = null; u.path = []; }
    }
  }

  // ---------- deliveries ----------
  matchDeliveries() {
    const s = this.s;
    interface Demand { house: House | null; unit: Unit | null; tile: number; ware: Ware; prio: number; x: number; y: number; owner: number; }
    const demands: Demand[] = [];
    for (const h of s.houses) {
      if (h.state === 'destroyed') continue;
      const def = HOUSE_DEFS[h.type];
      const f = this.frontPos(h);
      if (h.state === 'building') {
        for (const w of ['wood', 'stone'] as Ware[]) {
          const need = def.cost[w as 'wood' | 'stone'] - h.delivered[w as 'wood' | 'stone'] - this.stockGet(h.incoming, w);
          if (need > 0) demands.push({ house: h, unit: null, tile: -1, ware: w, prio: 1, x: f.x, y: f.y, owner: h.owner });
        }
        continue;
      }
      if (def.special === 'store') continue;
      const cap = def.special === 'barracks' ? 40 : def.special === 'inn' ? 8 : def.special === 'school' ? 4 : MAX_STOCK;
      for (const w of def.inputs) {
        const have = this.stockGet(h.stock, w) + this.stockGet(h.incoming, w);
        if (have < cap) {
          // only ask for inputs that some enabled recipe uses
          if (def.recipes && !def.recipes.some(r => r.inputs[w] && Object.keys(r.outputs).every(o => h.enabled[o as Ware] !== false))) continue;
          if (def.special === 'tower' && h.workerId < 0) continue;
          const foodChain = def.special === 'inn' || def.special === 'school' || h.type === 'mill' || h.type === 'bakery' || h.type === 'butchers' || h.type === 'swineFarm' || def.special === 'tower';
          demands.push({ house: h, unit: null, tile: -1, ware: w, prio: def.special === 'barracks' ? 4 : foodChain ? 2 : 3, x: f.x, y: f.y, owner: h.owner });
        }
      }
    }
    // plan tiles waiting for material
    const m = this.map;
    for (let i = 0; i < m.obj.length; i++) {
      if (m.data[i] !== 20) continue;
      const o = m.obj[i];
      if (o !== Obj.RoadPlan && o !== Obj.WinePlan) continue;
      if (s.tileIncoming[i]) continue;
      const owner = m.owner[i] || s.player;
      demands.push({ house: null, unit: null, tile: i, ware: o === Obj.RoadPlan ? 'stone' : 'wood', prio: 1, x: i % m.w, y: (i / m.w) | 0, owner });
    }
    // hungry soldiers
    for (const u of s.units) {
      if (u.dead || u.task.kind !== 'soldier' || u.condition > 0.45) continue;
      let already = false;
      for (const v of s.units) if (!v.dead && v.task.kind === 'deliver' && v.task.toUnit === u.id) { already = true; break; }
      if (already) continue;
      demands.push({ house: null, unit: u, tile: -1, ware: 'bread', prio: 2, x: Math.round(u.x), y: Math.round(u.y), owner: u.owner });
    }
    // storehouse takes surplus (low priority)
    const stores = s.houses.filter(h => h.state === 'done' && h.type === 'storehouse');
    if (!demands.length && !stores.length) return;
    demands.sort((a, b) => a.prio - b.prio);

    interface Offer { house: House; ware: Ware; x: number; y: number; isStore: boolean; }
    const offers: Offer[] = [];
    for (const h of s.houses) {
      if (h.state !== 'done') continue;
      const isStore = h.type === 'storehouse';
      const src = isStore ? h.stock : h.out;
      const f = this.frontPos(h);
      for (const w of Object.keys(src) as Ware[]) {
        if (this.stockGet(src, w) - this.stockGet(h.reserved, w) > 0) offers.push({ house: h, ware: w, x: f.x, y: f.y, isStore });
      }
    }
    // surplus to store: every non-store offer becomes a store demand if nobody else wants it
    for (const o of offers) {
      if (o.isStore) continue;
      const wanted = demands.some(d => d.owner === o.house.owner && d.ware === o.ware && d.house !== o.house);
      if (wanted) continue;
      let best: House | null = null, bd = 1e9;
      for (const st of stores) { if (st.owner !== o.house.owner || st.blocked[o.ware]) continue; const d = Math.abs(st.x - o.x) + Math.abs(st.y - o.y); if (d < bd) { bd = d; best = st; } }
      if (best) { const f = this.frontPos(best); demands.push({ house: best, unit: null, tile: -1, ware: o.ware, prio: 5, x: f.x, y: f.y, owner: best.owner }); }
    }

    const idleSerfs: Unit[] = [];
    for (const u of s.units) if (!u.dead && u.type === 'serf' && u.task.kind === 'idle' && u.inHouse < 0 && u.condition > 0.2) idleSerfs.push(u);
    if (!idleSerfs.length) return;

    let assigned = 0;
    for (const d of demands) {
      if (!idleSerfs.length || assigned >= 6) break;
      // best offer
      let bo: Offer | null = null, bd = 1e9;
      for (const o of offers) {
        if (o.ware !== d.ware || o.house.owner !== d.owner) continue;
        if (d.house && o.house === d.house) continue;
        if (d.prio === 5 && o.isStore) continue; // store to store: no
        if (d.unit && !FOOD.includes(o.ware)) continue;
        if (this.stockGet(o.isStore ? o.house.stock : o.house.out, o.ware) - this.stockGet(o.house.reserved, o.ware) <= 0) continue;
        const key = `${o.house.id}-${d.house ? d.house.id : d.tile >= 0 ? 't' + d.tile : 'u' + d.unit!.id}`;
        if (s.pairCooldown[key]) continue;
        let dist = Math.abs(o.x - d.x) + Math.abs(o.y - d.y);
        if (o.isStore) dist += 6; // prefer direct producer->consumer
        if (dist < bd) { bd = dist; bo = o; }
      }
      if (d.unit && !bo) { // any food will do
        for (const w of FOOD) {
          for (const o of offers) {
            if (o.ware !== w || o.house.owner !== d.owner) continue;
            if (this.stockGet(o.isStore ? o.house.stock : o.house.out, o.ware) - this.stockGet(o.house.reserved, o.ware) <= 0) continue;
            const dist = Math.abs(o.x - d.x) + Math.abs(o.y - d.y);
            if (dist < bd) { bd = dist; bo = o; }
          }
          if (bo) break;
        }
      }
      if (!bo) continue;
      // nearest idle serf to the offer
      let si = -1, sd = 1e9;
      for (let i = 0; i < idleSerfs.length; i++) { const u = idleSerfs[i]; if (u.owner !== d.owner) continue; const dist = Math.abs(u.x - bo.x) + Math.abs(u.y - bo.y); if (dist < sd) { sd = dist; si = i; } }
      if (si < 0) continue;
      const serf = idleSerfs.splice(si, 1)[0];
      this.stockAdd(bo.house.reserved, bo.ware, 1);
      if (d.house) this.stockAdd(d.house.incoming, bo.ware, 1);
      else if (d.tile >= 0) s.tileIncoming[d.tile] = 1;
      serf.task = { kind: 'deliver', from: bo.house.id, to: d.house ? d.house.id : -1, toUnit: d.unit ? d.unit.id : -1, ware: bo.ware, phase: 0, tile: d.tile };
      serf.dest = null; serf.path = [];
      assigned++;
    }
  }

  // ---------- units ----------
  setDest(u: Unit, x: number, y: number, road: boolean) {
    if (u.dest && u.dest.x === x && u.dest.y === y && u.dest.road === road) return;
    u.dest = { x, y, road }; u.path = []; u.pathFails = 0;
  }

  /** Returns 'arrived' | 'walking' | 'blocked'. */
  goTo(u: Unit, x: number, y: number, road: boolean): 'arrived' | 'walking' | 'blocked' {
    const ux = Math.round(u.x), uy = Math.round(u.y);
    if (ux === x && uy === y && !u.moving) { u.dest = null; u.path = []; return 'arrived'; }
    this.setDest(u, x, y, road);
    if (u.pathFails >= 3) return 'blocked';
    return 'walking';
  }

  stepMovement(u: Unit) {
    const def = UNIT_DEFS[u.type];
    u.moving = false;
    if (!u.dest) return;
    if (!u.path.length) {
      const ux = Math.round(u.x), uy = Math.round(u.y);
      if (ux === u.dest.x && uy === u.dest.y) { u.x = ux; u.y = uy; u.dest = null; return; }
      // stagger path searches when blocked
      if (u.pathFails > 0 && (this.s.tick + u.id) % 25 !== 0) return;
      // a serf standing off the road network (after feeding soldiers, a demolished house...) walks freely
      const road = u.dest.road && this.roadWalkable(ux, uy);
      const p = findPath(this.map, ux, uy, u.dest.x, u.dest.y, road ? this.roadWalkable : this.walkable, road ? 3000 : 5000, this.walkable);
      if (!p) { u.pathFails++; return; }
      u.path = p; u.pathFails = 0;
    }
    const next = u.path[0];
    // re-plan if the next tile got blocked (house placed)
    if (!this.walkable(next.x, next.y) && !(next.x === u.dest.x && next.y === u.dest.y)) { u.path = []; return; }
    const dx = next.x - u.x, dy = next.y - u.y;
    const dist = Math.hypot(dx, dy);
    let speed = def.speed;
    if (u.condition <= 0) speed *= 0.6;
    if (u.carry) speed *= 0.9;
    if (dist <= speed) { u.x = next.x; u.y = next.y; u.path.shift(); }
    else { u.x += dx / dist * speed; u.y += dy / dist * speed; }
    u.moving = true;
    u.dir = dirFrom(dx, dy);
    u.frame++;
  }

  updateUnit(u: Unit) {
    const t = u.task;
    if (t.kind === 'die') { t.timer--; return; }
    if (u.hitFlash > 0) u.hitFlash--;
    if (u.attackCd > 0) u.attackCd--;
    // hunger
    u.condition = Math.max(0, u.condition - HUNGER_PER_TICK);
    if (u.condition <= 0 && this.s.tick % 60 === 0) {
      u.hp--;
      if (u.hp <= 0) { if (u.owner === this.s.player) this.msg(`A ${UNIT_DEFS[u.type].name.toLowerCase()} has starved to death.`, 'alert', u.x, u.y); this.killUnit(u); return; }
    }
    // fed, resting soldiers slowly recover
    if (t.kind === 'soldier' && u.hp < u.maxHp && u.condition > 0.5 && u.targetUnit < 0 && u.targetHouse < 0 && (this.s.tick + u.id) % 150 === 0) u.hp++;
    if (u.inHouse < 0) this.stepMovement(u);
    switch (t.kind) {
      case 'idle': this.taskIdle(u, t); break;
      case 'deliver': this.taskDeliver(u, t); break;
      case 'buildHouse': this.taskBuildHouse(u, t); break;
      case 'buildTile': this.taskBuildTile(u, t); break;
      case 'goWork': this.taskGoWork(u, t); break;
      case 'work': this.taskWork(u, t); break;
      case 'eat': this.taskEat(u, t); break;
      case 'goBarracks': this.taskGoBarracks(u, t); break;
      case 'soldier': break; // combat module
    }
  }

  isHungry(u: Unit) { return u.condition < 0.4; }

  findInn(u: Unit): House | null {
    let best: House | null = null, bd = 1e9;
    for (const h of this.s.houses) {
      if (h.owner !== u.owner || h.state !== 'done' || h.type !== 'inn') continue;
      if (!FOOD.some(f => this.stockGet(h.stock, f) > 0)) continue;
      const d = Math.abs(h.x - u.x) + Math.abs(h.y - u.y);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  /** Try to send a hungry unit to eat. Returns true if it started walking to an inn. */
  tryEat(u: Unit): boolean {
    if (!this.isHungry(u)) return false;
    const inn = this.findInn(u);
    if (!inn) return false;
    if (u.inHouse >= 0) { const h = this.house(u.inHouse); if (h) { if (h.workerId === u.id) h.working = false; const d = this.doorPos(h); u.x = d.x; u.y = d.y; } u.inHouse = -1; }
    u.task = { kind: 'eat', house: inn.id, phase: 0, timer: 0 }; u.dest = null; u.path = [];
    return true;
  }

  taskIdle(u: Unit, t: Extract<Task, { kind: 'idle' }>) {
    if (t.wait > 0) { t.wait--; return; }
    if (this.tryEat(u)) return;
    if (u.home >= 0) { const h = this.house(u.home); if (h && h.state === 'done' && h.workerId === u.id) { u.task = { kind: 'goWork', house: h.id }; return; } u.home = -1; }
    // idle citizens wander a little near where they are, serfs return to the store when far away
    if (u.inHouse < 0 && !u.dest && this.doorTiles.has(idx(this.map, Math.round(u.x), Math.round(u.y)))) {
      const hid = this.map.house[idx(this.map, Math.round(u.x), Math.round(u.y))]; const h = this.house(hid); if (h) this.stepOut(u, h);
    }
    if (u.type === 'serf' && (this.s.tick + u.id) % 200 === 0 && !u.dest) {
      const st = this.nearestStore(u.owner, u.x, u.y);
      if (st) { const f = this.frontPos(st); if (Math.abs(f.x - u.x) + Math.abs(f.y - u.y) > 14) this.setDest(u, f.x, f.y, true); }
    } else if ((this.s.tick + u.id) % 150 === 0 && !u.dest && u.inHouse < 0) {
      const nx = Math.round(u.x) + rnd(-1, 1), ny = Math.round(u.y) + rnd(-1, 1);
      if (this.walkable(nx, ny) && this.map.obj[idx(this.map, nx, ny)] !== Obj.Road) this.setDest(u, nx, ny, false);
    }
  }

  taskDeliver(u: Unit, t: Extract<Task, { kind: 'deliver' }>) {
    const from = this.house(t.from);
    if (t.phase === 0) {
      if (!from || from.state !== 'done') { this.cancelTask(u); return; }
      const d = this.doorPos(from);
      const r = this.goTo(u, d.x, d.y, true);
      if (r === 'blocked') { this.s.pairCooldown[`${t.from}-${t.to >= 0 ? t.to : t.tile >= 0 ? 't' + t.tile : 'u' + t.toUnit}`] = this.s.tick + 300; this.cancelTask(u); return; }
      if (r === 'arrived') {
        const src = from.type === 'storehouse' ? from.stock : from.out;
        if (this.stockGet(src, t.ware) <= 0) { this.cancelTask(u); return; }
        this.stockAdd(src, t.ware, -1); this.stockAdd(from.reserved, t.ware, -1);
        u.carry = t.ware; t.phase = 2;
      }
      return;
    }
    if (t.phase === 2) {
      let tx: number, ty: number, road = true;
      if (t.toUnit >= 0) {
        const tu = this.unit(t.toUnit);
        if (!tu || tu.dead || tu.inHouse >= 0) { this.cancelTask(u); return; }
        tx = Math.round(tu.x); ty = Math.round(tu.y); road = false;
        const r = this.goTo(u, tx, ty, false);
        if (r === 'blocked') { this.cancelTask(u); return; }
        if (r === 'arrived' || (Math.abs(u.x - tu.x) <= 1.2 && Math.abs(u.y - tu.y) <= 1.2)) {
          tu.condition = Math.min(1, tu.condition + (FOOD_VALUE[t.ware] ?? 0.4) + 0.2);
          u.carry = null; u.task = { kind: 'idle', wait: 2 }; u.dest = null; u.path = [];
        }
        return;
      }
      if (t.tile >= 0) {
        tx = t.tile % this.map.w; ty = (t.tile / this.map.w) | 0;
        const o = this.map.obj[t.tile];
        if ((o !== Obj.RoadPlan && o !== Obj.WinePlan) || this.map.data[t.tile] !== 20) { this.cancelTask(u); return; }
        const r = this.goTo(u, tx, ty, true);
        if (r === 'blocked') { this.s.pairCooldown[`${t.from}-t${t.tile}`] = this.s.tick + 300; this.cancelTask(u); return; }
        if (r === 'arrived') { this.map.data[t.tile] = 21; delete this.s.tileIncoming[t.tile]; u.carry = null; u.task = { kind: 'idle', wait: 2 }; u.dest = null; u.path = []; this.markDirty(tx, ty); }
        return;
      }
      const to = this.house(t.to);
      if (!to || to.state === 'destroyed') { this.cancelTask(u); return; }
      const d = this.doorPos(to);
      const r = this.goTo(u, d.x, d.y, road);
      if (r === 'blocked') { this.s.pairCooldown[`${t.from}-${t.to}`] = this.s.tick + 300; this.cancelTask(u); return; }
      if (r === 'arrived') {
        this.stockAdd(to.incoming, t.ware, -1);
        if (to.state === 'building') { if (t.ware === 'wood' || t.ware === 'stone') to.delivered[t.ware]++; }
        else this.stockAdd(to.stock, t.ware, 1);
        u.carry = null; u.task = { kind: 'idle', wait: 1 }; u.dest = null; u.path = [];
        this.stepOut(u, to);
      }
    }
  }

  taskBuildHouse(u: Unit, t: Extract<Task, { kind: 'buildHouse' }>) {
    const h = this.house(t.house);
    if (!h || h.state !== 'building') { u.task = { kind: 'idle', wait: 2 }; return; }
    const def = HOUSE_DEFS[h.type];
    if (t.phase === 0) {
      const f = this.frontPos(h);
      const target = this.walkable(f.x, f.y) ? f : this.doorPos(h);
      const r = this.goTo(u, target.x, target.y, false);
      if (r === 'blocked') { h.builderId = -1; u.task = { kind: 'idle', wait: 30 }; return; }
      if (r === 'arrived') t.phase = 1;
      return;
    }
    if (this.isHungry(u) && this.findInn(u)) { h.builderId = -1; this.tryEat(u); return; }
    // build as far as delivered materials allow
    const total = def.cost.wood + def.cost.stone;
    const have = h.delivered.wood + h.delivered.stone;
    const allowed = Math.floor(def.buildTime * have / total);
    if (h.progress < allowed) {
      h.progress++;
      u.frame++;
      if (h.progress % 10 === 0) this.s.fx.push({ x: h.x + Math.random() * def.w, y: h.y + Math.random() * def.h, kind: 'dust', t: 0 });
      if (h.progress >= def.buildTime) {
        h.state = 'done'; h.hp = def.hp; h.builderId = -1;
        u.task = { kind: 'idle', wait: 2 };
        if (h.owner === this.s.player) { this.msg(`${def.name} completed.`, 'good', h.x, h.y); this.sound('complete'); }
        this.claimTerritory(h);
      }
    }
  }

  taskBuildTile(u: Unit, t: Extract<Task, { kind: 'buildTile' }>) {
    const m = this.map;
    const o = m.obj[t.tile];
    const x = t.tile % m.w, y = (t.tile / m.w) | 0;
    if (o !== Obj.RoadPlan && o !== Obj.FieldPlan && o !== Obj.WinePlan) { u.task = { kind: 'idle', wait: 1 }; return; }
    if (t.phase === 0) {
      const r = this.goTo(u, x, y, false);
      if (r === 'blocked') { u.task = { kind: 'idle', wait: 40 }; return; }
      if (r === 'arrived') t.phase = 1;
      return;
    }
    const d = m.data[t.tile];
    u.frame++;
    if (o === Obj.FieldPlan) {
      if (d < 40) { m.data[t.tile] = d + 1; if (d % 10 === 0) this.markDirty(x, y); return; }
      m.obj[t.tile] = Obj.Field; m.data[t.tile] = 0; this.markDirty(x, y);
      u.task = { kind: 'idle', wait: 1 }; return;
    }
    if (d < 20) { m.data[t.tile] = d + 1; if (d % 5 === 0) this.markDirty(x, y); if (d + 1 === 20) { u.task = { kind: 'idle', wait: 1 }; } return; } // dug, wait for material
    if (d === 20) { u.task = { kind: 'idle', wait: 10 }; return; }
    if (d < 40) { m.data[t.tile] = d + 1; if (d % 5 === 0) this.markDirty(x, y); return; }
    m.obj[t.tile] = o === Obj.RoadPlan ? Obj.Road : Obj.WineField; m.data[t.tile] = 0; this.markDirty(x, y);
    u.task = { kind: 'idle', wait: 1 };
  }

  taskGoWork(u: Unit, t: Extract<Task, { kind: 'goWork' }>) {
    const h = this.house(t.house);
    if (!h || h.state !== 'done' || h.workerId !== u.id) { u.home = -1; u.task = { kind: 'idle', wait: 2 }; return; }
    const d = this.doorPos(h);
    const r = this.goTo(u, d.x, d.y, false);
    if (r === 'blocked') { u.task = { kind: 'idle', wait: 40 }; return; }
    if (r === 'arrived') { u.inHouse = h.id; u.task = { kind: 'work', house: h.id, phase: 0, timer: 0, tx: 0, ty: 0, sub: 0 }; }
  }

  taskGoBarracks(u: Unit, t: Extract<Task, { kind: 'goBarracks' }>) {
    const h = this.house(t.house);
    if (!h || h.state !== 'done') { u.task = { kind: 'idle', wait: 20 }; return; }
    const d = this.doorPos(h);
    const r = this.goTo(u, d.x, d.y, false);
    if (r === 'blocked') { u.task = { kind: 'idle', wait: 40 }; return; }
    if (r === 'arrived') { u.inHouse = h.id; h.recruits.push(u.id); u.task = { kind: 'idle', wait: 0 }; u.home = h.id; }
  }

  taskEat(u: Unit, t: Extract<Task, { kind: 'eat' }>) {
    const h = this.house(t.house);
    if (!h || h.state !== 'done') { u.task = { kind: 'idle', wait: 2 }; return; }
    if (t.phase === 0) {
      const d = this.doorPos(h);
      const r = this.goTo(u, d.x, d.y, false);
      if (r === 'blocked') { u.task = { kind: 'idle', wait: 60 }; return; }
      if (r === 'arrived') {
        u.inHouse = h.id; t.phase = 1; t.timer = 40;
        // eat until full or food runs out
        let guard = 0;
        while (u.condition < 0.95 && guard++ < 4) {
          let ate = false;
          for (const f of FOOD) if (this.stockGet(h.stock, f) > 0) { this.stockAdd(h.stock, f, -1); u.condition = Math.min(1, u.condition + FOOD_VALUE[f]!); ate = true; break; }
          if (!ate) break;
        }
      }
      return;
    }
    if (--t.timer <= 0) { u.inHouse = -1; const d = this.doorPos(h); u.x = d.x; u.y = d.y; u.task = { kind: 'idle', wait: 0 }; this.stepOut(u, h); }
  }

  // ---------- workers of gathering houses ----------
  taskWork(u: Unit, t: Extract<Task, { kind: 'work' }>) {
    const h = this.house(t.house);
    if (!h || h.state !== 'done' || h.workerId !== u.id) { u.inHouse = -1; u.home = -1; u.task = { kind: 'idle', wait: 2 }; return; }
    const def = HOUSE_DEFS[h.type];
    const sp = def.special;
    if (u.inHouse === h.id && this.isHungry(u) && !h.working && this.findInn(u)) { this.tryEat(u); return; }
    if (sp !== 'quarry' && sp !== 'woodcutters' && sp !== 'farm' && sp !== 'vineyard') return; // production handled by the house
    const out = def.outputs[0];
    switch (t.phase) {
      case 0: { // inside, look for work
        if (u.inHouse !== h.id) { u.inHouse = h.id; }
        if (this.stockGet(h.out, out) >= MAX_STOCK) return;
        if ((this.s.tick + u.id) % 20 !== 0) return;
        if (u.condition < 0.15) return;
        let spot: { x: number; y: number; tx: number; ty: number; sub: number } | null = null;
        if (sp === 'quarry') { const s = this.nearestMountainSpot(h); if (s) spot = { ...s, sub: 0 }; }
        else if (sp === 'woodcutters') {
          const s = this.findTree(h, false);
          if (s) spot = { ...s, sub: 0 };
          else { const p = this.findPlantSpot(h); if (p) spot = { x: p.x, y: p.y, tx: p.x, ty: p.y, sub: 1 }; }
        } else if (sp === 'farm') {
          const ripe = this.findFieldTile(h, Obj.Field, 6);
          if (ripe) spot = { x: ripe.x, y: ripe.y, tx: ripe.x, ty: ripe.y, sub: 0 };
          else { const empty = this.findFieldTile(h, Obj.Field, 0); if (empty) spot = { x: empty.x, y: empty.y, tx: empty.x, ty: empty.y, sub: 1 }; }
        } else if (sp === 'vineyard') {
          const ripe = this.findFieldTile(h, Obj.WineField, 6);
          if (ripe) spot = { x: ripe.x, y: ripe.y, tx: ripe.x, ty: ripe.y, sub: 0 };
          else { const empty = this.findFieldTile(h, Obj.WineField, 0); if (empty) spot = { x: empty.x, y: empty.y, tx: empty.x, ty: empty.y, sub: 1 }; }
        }
        if (!spot) return;
        u.inHouse = -1; const d = this.doorPos(h); u.x = d.x; u.y = d.y;
        t.tx = spot.tx; t.ty = spot.ty; t.sub = spot.sub; t.phase = 1;
        this.setDest(u, spot.x, spot.y, false);
        (t as any).sx = spot.x; (t as any).sy = spot.y;
        return;
      }
      case 1: { // walking to the work spot
        const sx = (t as any).sx ?? t.tx, sy = (t as any).sy ?? t.ty;
        const r = this.goTo(u, sx, sy, false);
        if (r === 'blocked') { t.phase = 3; return; }
        if (r === 'arrived') {
          // validate target still valid
          const i = idx(this.map, t.tx, t.ty);
          const o = this.map.obj[i];
          let ok = true;
          if (sp === 'quarry') ok = this.map.terrain[i] === Terrain.Mountain;
          else if (sp === 'woodcutters') ok = t.sub === 1 ? o === Obj.None : (o === Obj.Tree && this.map.data[i] === 255);
          else if (sp === 'farm') ok = o === Obj.Field && (t.sub === 1 ? this.map.data[i] === 0 : this.map.data[i] === 6);
          else if (sp === 'vineyard') ok = o === Obj.WineField && (t.sub === 1 ? this.map.data[i] === 0 : this.map.data[i] === 6);
          if (!ok) { t.phase = 3; return; }
          t.phase = 2; t.timer = sp === 'quarry' ? 50 : sp === 'woodcutters' ? (t.sub === 1 ? 25 : 55) : (t.sub === 1 ? 35 : 45);
          u.dir = dirFrom(t.tx - u.x, t.ty - u.y);
        }
        return;
      }
      case 2: { // working at the spot
        u.frame++;
        if (--t.timer > 0) { if (t.timer % 12 === 0 && (sp === 'woodcutters' || sp === 'quarry') && t.sub === 0) { this.s.fx.push({ x: t.tx, y: t.ty, kind: 'chop', t: 0 }); if (h.owner === this.s.player) this.sound(sp === 'quarry' ? 'pick' : 'chop'); } return; }
        const i = idx(this.map, t.tx, t.ty);
        if (sp === 'quarry') { u.carry = 'stone'; }
        else if (sp === 'woodcutters') {
          if (t.sub === 1) { if (this.map.obj[i] === Obj.None) { this.map.obj[i] = Obj.Sapling; this.map.data[i] = 1; this.markDirty(t.tx, t.ty); } }
          else { this.map.obj[i] = Obj.Stump; this.map.data[i] = 0; this.markDirty(t.tx, t.ty); u.carry = 'trunk'; }
        } else if (sp === 'farm') {
          if (t.sub === 1) { this.map.data[i] = 1; } else { this.map.data[i] = 0; u.carry = 'corn'; }
          this.markDirty(t.tx, t.ty);
        } else if (sp === 'vineyard') {
          if (t.sub === 1) { this.map.data[i] = 1; } else { this.map.data[i] = 1; u.carry = 'wine'; }
          this.markDirty(t.tx, t.ty);
        }
        t.phase = 3;
        return;
      }
      case 3: { // walking home
        const d = this.doorPos(h);
        const r = this.goTo(u, d.x, d.y, false);
        if (r === 'blocked') { u.task = { kind: 'idle', wait: 40 }; u.home = -1; h.workerId = -1; return; }
        if (r === 'arrived') {
          if (u.carry) { this.stockAdd(h.out, u.carry, 1); this.stockAdd(this.s.stats.produced, u.carry, 1); u.carry = null; }
          u.inHouse = h.id; t.phase = 0;
        }
        return;
      }
    }
  }

  nearestMountainSpot(h: House): { x: number; y: number; tx: number; ty: number } | null {
    const def = HOUSE_DEFS[h.type];
    const cx = h.x + def.w / 2, cy = h.y + def.h / 2;
    let best: { x: number; y: number; tx: number; ty: number } | null = null, bd = 1e9;
    const R = HOUSE_WORK_RADIUS;
    for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      if (!inBounds(this.map, x, y)) continue;
      const i = idx(this.map, x, y);
      if (this.map.terrain[i] !== Terrain.Mountain || this.map.obj[i] !== Obj.None) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > R || d >= bd) continue;
      // a walkable neighbour to stand on
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
        if (this.walkable(x + dx, y + dy)) { bd = d; best = { x: x + dx, y: y + dy, tx: x, ty: y }; break; }
      }
    }
    return best;
  }

  findTree(h: House, any: boolean): { x: number; y: number; tx: number; ty: number } | null {
    const def = HOUSE_DEFS[h.type];
    const cx = h.x + def.w / 2, cy = h.y + def.h / 2;
    let best: { x: number; y: number; tx: number; ty: number } | null = null, bd = 1e9;
    const R = HOUSE_WORK_RADIUS + 2;
    for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      if (!inBounds(this.map, x, y)) continue;
      const i = idx(this.map, x, y);
      if (this.map.obj[i] !== Obj.Tree || (!any && this.map.data[i] < 255)) continue;
      if (this.map.owner[i] !== 0 && this.map.owner[i] !== h.owner) continue;
      const d = Math.hypot(x - cx, y - cy) + Math.random() * 0.5;
      if (d > R || d >= bd) continue;
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
        if (this.walkable(x + dx, y + dy)) { bd = d; best = { x: x + dx, y: y + dy, tx: x, ty: y }; break; }
      }
    }
    return best;
  }

  findPlantSpot(h: House): Point | null {
    const def = HOUSE_DEFS[h.type];
    const cx = h.x + def.w / 2, cy = h.y + def.h / 2;
    const cands: Point[] = [];
    const R = HOUSE_WORK_RADIUS;
    for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      if (!inBounds(this.map, x, y)) continue;
      const i = idx(this.map, x, y);
      if (this.map.obj[i] !== Obj.None || this.map.terrain[i] !== Terrain.Grass || this.map.house[i] >= 0) continue;
      if (this.map.owner[i] !== 0 && this.map.owner[i] !== h.owner) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > R || d < 2.5) continue;
      // don't plant on roads' neighbours too aggressively: skip tiles next to roads/fields
      let nearRoad = false;
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) { if (!inBounds(this.map, x + dx, y + dy)) continue; const o = this.map.obj[idx(this.map, x + dx, y + dy)]; if (o === Obj.Road || o === Obj.RoadPlan || o === Obj.Field || o === Obj.FieldPlan || o === Obj.WineField || o === Obj.WinePlan || this.map.house[idx(this.map, x + dx, y + dy)] >= 0) nearRoad = true; }
      if (nearRoad) continue;
      cands.push({ x, y });
    }
    if (!cands.length) return null;
    return cands[Math.floor(Math.random() * cands.length)];
  }

  findFieldTile(h: House, obj: Obj, stage: number): Point | null {
    const def = HOUSE_DEFS[h.type];
    const cx = h.x + def.w / 2, cy = h.y + def.h / 2;
    let best: Point | null = null, bd = 1e9;
    const R = HOUSE_WORK_RADIUS + 2;
    for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      if (!inBounds(this.map, x, y)) continue;
      const i = idx(this.map, x, y);
      if (this.map.obj[i] !== obj || this.map.data[i] !== stage) continue;
      if (this.map.owner[i] !== 0 && this.map.owner[i] !== h.owner) continue;
      // another farmer already heading there?
      const d = Math.hypot(x - cx, y - cy);
      if (d > R || d >= bd) continue;
      bd = d; best = { x, y };
    }
    return best;
  }

  // ---------- objectives ----------
  checkObjectives() {
    const s = this.s;
    const p = s.player;
    // defeat: no storehouse and no school
    const alive = (type: HouseType) => s.houses.some(h => h.owner === p && h.state !== 'destroyed' && h.type === type);
    const soldiers = s.units.filter(u => !u.dead && u.owner === p && u.task.kind === 'soldier').length;
    if (s.playerHasPlacedHouse || s.tick > 100) {
      if (!alive('storehouse') && !alive('school') && soldiers === 0) { s.outcome = 'lost'; s.outcomeTick = s.tick; this.msg('Your settlement has fallen.', 'alert'); return; }
    }
    if (!s.objectives.length) return;
    const done = s.objectives.every(o => this.objectiveDone(o));
    if (done) { s.outcome = 'won'; s.outcomeTick = s.tick; this.msg('Victory! All objectives complete.', 'good'); this.sound('victory'); }
  }

  objectiveDone(o: import('./state').Objective): boolean {
    const s = this.s, p = s.player;
    switch (o.type) {
      case 'houses': return s.houses.filter(h => h.owner === p && h.state === 'done' && h.type === o.house).length >= (o.count ?? 1);
      case 'wares': return this.stockGet(s.stats.produced, o.ware!) >= (o.count ?? 1);
      case 'soldiers': return s.units.filter(u => !u.dead && u.owner === p && u.task.kind === 'soldier').length >= (o.count ?? 1);
      case 'citizens': return s.units.filter(u => !u.dead && u.owner === p && u.task.kind !== 'soldier').length >= (o.count ?? 1);
      case 'trained': return (s.stats.trained[o.unit!] ?? 0) >= (o.count ?? 1);
      case 'destroyOwner': return !s.houses.some(h => h.owner === o.owner && h.state !== 'destroyed' && (h.type === 'storehouse' || h.type === 'barracks' || h.type === 'school' || h.type === 'watchtower')) && !s.units.some(u => !u.dead && u.owner === o.owner && u.task.kind === 'soldier');
      case 'survive': return s.tick >= (o.ticks ?? 0);
    }
    return false;
  }

  objectiveProgress(o: import('./state').Objective): string {
    const s = this.s, p = s.player;
    switch (o.type) {
      case 'houses': return `${s.houses.filter(h => h.owner === p && h.state === 'done' && h.type === o.house).length}/${o.count ?? 1}`;
      case 'wares': return `${this.stockGet(s.stats.produced, o.ware!)}/${o.count ?? 1}`;
      case 'soldiers': return `${s.units.filter(u => !u.dead && u.owner === p && u.task.kind === 'soldier').length}/${o.count ?? 1}`;
      case 'citizens': return `${s.units.filter(u => !u.dead && u.owner === p && u.task.kind !== 'soldier').length}/${o.count ?? 1}`;
      case 'trained': return `${s.stats.trained[o.unit!] ?? 0}/${o.count ?? 1}`;
      case 'destroyOwner': { const hs = s.houses.filter(h => h.owner === o.owner && h.state !== 'destroyed' && (h.type === 'storehouse' || h.type === 'barracks' || h.type === 'school' || h.type === 'watchtower')).length; const us = s.units.filter(u => !u.dead && u.owner === o.owner && u.task.kind === 'soldier').length; return `${hs} key buildings, ${us} soldiers left`; }
      case 'survive': { const left = Math.max(0, (o.ticks ?? 0) - s.tick); return `${Math.floor(left / 600)}:${String(Math.floor((left % 600) / 10)).padStart(2, '0')} left`; }
    }
    return '';
  }

  // ---------- statistics ----------
  countWares(owner: number): Stock {
    const total: Stock = {};
    for (const h of this.s.houses) {
      if (h.owner !== owner || h.state !== 'done') continue;
      for (const w of WARES) { const n = this.stockGet(h.stock, w) + this.stockGet(h.out, w); if (n) this.stockAdd(total, w, n); }
    }
    return total;
  }
}

export function dirFrom(dx: number, dy: number): number {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return 0;
  const a = Math.atan2(dy, dx); // 0 = right
  // map to 8 directions: 0 down,1 down-left,2 left,3 up-left,4 up,5 up-right,6 right,7 down-right
  const seg = ((Math.round((a - Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8; // 0 = down
  return seg;
}

export function rnd(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }
