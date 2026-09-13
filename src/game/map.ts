// ---- Terrain, map objects and pathfinding ----

export const enum Terrain { Grass = 0, Water = 1, Sand = 2, Mountain = 3, Dirt = 4, Snow = 5 }
export const enum Obj {
  None = 0, Tree = 1, Sapling = 2, Stump = 3, Road = 4, Field = 5, WineField = 6,
  Coal = 7, Iron = 8, Gold = 9, RoadPlan = 10, FieldPlan = 11, WinePlan = 12, Rock = 13, Bush = 14,
}

export interface Point { x: number; y: number; }

export interface MapData {
  w: number; h: number;
  terrain: Uint8Array;
  obj: Uint8Array;
  data: Uint8Array;      // growth stage (trees / fields), ore amount (deposits), build progress (plans)
  house: Int16Array;     // house id occupying the tile or -1
  owner: Uint8Array;     // territory owner for tiles near houses (0 none)
}

export function createMap(w: number, h: number): MapData {
  return {
    w, h,
    terrain: new Uint8Array(w * h),
    obj: new Uint8Array(w * h),
    data: new Uint8Array(w * h),
    house: new Int16Array(w * h).fill(-1),
    owner: new Uint8Array(w * h),
  };
}

export const inBounds = (m: MapData, x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h;
export const idx = (m: MapData, x: number, y: number) => y * m.w + x;

/** Ground a unit can walk on (ignoring houses). */
export function walkableGround(m: MapData, x: number, y: number): boolean {
  if (!inBounds(m, x, y)) return false;
  const t = m.terrain[idx(m, x, y)];
  if (t === Terrain.Water || t === Terrain.Mountain) return false;
  const o = m.obj[idx(m, x, y)];
  return o !== Obj.Tree && o !== Obj.Rock && o !== Obj.Coal && o !== Obj.Iron && o !== Obj.Gold;
}

/** Can a unit stand here right now (houses block except their door tile, which is stored as walkable by the game). */
export function isWalkable(m: MapData, x: number, y: number, doorTiles: Set<number>): boolean {
  if (!walkableGround(m, x, y)) return false;
  const i = idx(m, x, y);
  if (m.house[i] >= 0 && !doorTiles.has(i)) return false;
  return true;
}

/** Tile is free ground for building roads/fields/houses. */
export function isBuildable(m: MapData, x: number, y: number): boolean {
  if (!inBounds(m, x, y)) return false;
  const i = idx(m, x, y);
  const t = m.terrain[i];
  if (t === Terrain.Water || t === Terrain.Mountain) return false;
  if (m.house[i] >= 0) return false;
  const o = m.obj[i];
  return o === Obj.None || o === Obj.Stump || o === Obj.Bush;
}

export function isRoad(m: MapData, x: number, y: number, doorTiles: Set<number>): boolean {
  if (!inBounds(m, x, y)) return false;
  const i = idx(m, x, y);
  return m.obj[i] === Obj.Road || doorTiles.has(i);
}

// ---------- A* pathfinding ----------

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

class MinHeap {
  keys: number[] = []; vals: number[] = [];
  push(k: number, v: number) {
    this.keys.push(k); this.vals.push(v);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      [this.keys[p], this.keys[i]] = [this.keys[i], this.keys[p]];
      [this.vals[p], this.vals[i]] = [this.vals[i], this.vals[p]];
      i = p;
    }
  }
  pop(): number {
    const top = this.vals[0];
    const lk = this.keys.pop()!, lv = this.vals.pop()!;
    if (this.keys.length) {
      this.keys[0] = lk; this.vals[0] = lv;
      let i = 0; const n = this.keys.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let s = i;
        if (l < n && this.keys[l] < this.keys[s]) s = l;
        if (r < n && this.keys[r] < this.keys[s]) s = r;
        if (s === i) break;
        [this.keys[s], this.keys[i]] = [this.keys[i], this.keys[s]];
        [this.vals[s], this.vals[i]] = [this.vals[i], this.vals[s]];
        i = s;
      }
    }
    return top;
  }
  get size() { return this.keys.length; }
}

let gScore = new Float32Array(0), cameFrom = new Int32Array(0), closed = new Uint8Array(0), gen = new Uint32Array(0);
let curGen = 1;

/**
 * Generic A*. `passable(x,y)` decides which tiles may be entered; the goal tile is always allowed.
 * Returns the list of points from the tile after start up to and including the goal, or null.
 */
export function findPath(
  m: MapData, sx: number, sy: number, gx: number, gy: number,
  passable: (x: number, y: number) => boolean, maxNodes = 6000,
  cornerPassable: (x: number, y: number) => boolean = passable,
): Point[] | null {
  const n = m.w * m.h;
  if (gScore.length !== n) { gScore = new Float32Array(n); cameFrom = new Int32Array(n); closed = new Uint8Array(n); gen = new Uint32Array(n); }
  curGen++;
  if (curGen > 4e9) { gen.fill(0); curGen = 1; }
  if (!inBounds(m, gx, gy) || !inBounds(m, sx, sy)) return null;
  if (sx === gx && sy === gy) return [];
  const start = idx(m, sx, sy), goal = idx(m, gx, gy);
  const heap = new MinHeap();
  const h = (x: number, y: number) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.41 * Math.min(dx, dy); };
  gen[start] = curGen; gScore[start] = 0; cameFrom[start] = -1; closed[start] = 0;
  heap.push(h(sx, sy), start);
  let expanded = 0;
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) {
      const path: Point[] = [];
      let c = cur;
      while (c !== start) { path.push({ x: c % m.w, y: (c / m.w) | 0 }); c = cameFrom[c]; }
      path.reverse();
      return path;
    }
    if (closed[cur] && gen[cur] === curGen) continue;
    closed[cur] = 1;
    if (++expanded > maxNodes) return null;
    const cx = cur % m.w, cy = (cur / m.w) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
      if (!inBounds(m, nx, ny)) continue;
      const ni = idx(m, nx, ny);
      if (ni !== goal && !passable(nx, ny)) continue;
      if (d >= 4) { // no corner cutting through blocked tiles
        if (!cornerPassable(cx + DIRS[d][0], cy) || !cornerPassable(cx, cy + DIRS[d][1])) continue;
      }
      const cost = gScore[cur] + (d >= 4 ? 1.41 : 1);
      if (gen[ni] === curGen && (closed[ni] || cost >= gScore[ni])) continue;
      gen[ni] = curGen; closed[ni] = 0; gScore[ni] = cost; cameFrom[ni] = cur;
      heap.push(cost + h(nx, ny), ni);
    }
  }
  return null;
}

// ---------- Map generation ----------

export class Rng {
  s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  next(): number { // mulberry32
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number) { return Math.floor(this.next() * n); }
  range(a: number, b: number) { return a + this.next() * (b - a); }
}

function valueNoise(rng: Rng, w: number, h: number, cell: number): Float32Array {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  const out = new Float32Array(w * h);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = x / cell, fy = y / cell;
    const x0 = fx | 0, y0 = fy | 0;
    const tx = sm(fx - x0), ty = sm(fy - y0);
    const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
    out[y * w + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }
  return out;
}

export type PaintOp =
  | { op: 'circle'; x: number; y: number; r: number; terrain?: Terrain; obj?: Obj; data?: number; density?: number }
  | { op: 'rect'; x: number; y: number; w: number; h: number; terrain?: Terrain; obj?: Obj; data?: number; density?: number }
  | { op: 'river'; from: Point; to: Point; width: number }
  | { op: 'clear'; x: number; y: number; r: number };

export interface MapSpec { w: number; h: number; seed: number; forest?: number; hills?: number; paint?: PaintOp[]; }

export function generateMap(spec: MapSpec): MapData {
  const { w, h } = spec;
  const m = createMap(w, h);
  const rng = new Rng(spec.seed);
  const n1 = valueNoise(rng, w, h, 9), n2 = valueNoise(rng, w, h, 4), n3 = valueNoise(rng, w, h, 14);
  const forest = spec.forest ?? 0.5, hills = spec.hills ?? 0.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const e = n1[i] * 0.65 + n2[i] * 0.35; // elevation
    m.terrain[i] = Terrain.Grass;
    if (e > 0.78 - hills * 0.12) m.terrain[i] = Terrain.Mountain;
    else if (e < 0.2) m.terrain[i] = Terrain.Water;
    else if (e < 0.26) m.terrain[i] = Terrain.Sand;
    else if (n3[i] > 0.66) m.terrain[i] = Terrain.Dirt;
    if (m.terrain[i] === Terrain.Grass) {
      const f = n3[i] * 0.5 + n2[i] * 0.5;
      if (f > 0.68 - forest * 0.18 && rng.next() < 0.75) { m.obj[i] = Obj.Tree; m.data[i] = 255; }
      else if (rng.next() < 0.015) m.obj[i] = Obj.Bush;
      else if (rng.next() < 0.006) m.obj[i] = Obj.Rock;
    }
  }
  // clearing ops first so deposits and forests painted afterwards survive
  const ops = [...(spec.paint ?? [])].sort((a, b) => (a.op === 'clear' ? 0 : 1) - (b.op === 'clear' ? 0 : 1));
  for (const op of ops) applyPaint(m, op, rng);
  // map border: mountains at the edge to keep things tidy
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { m.terrain[y * w + x] = Terrain.Mountain; m.obj[y * w + x] = Obj.None; }
  }
  return m;
}

export function applyPaint(m: MapData, op: PaintOp, rng: Rng) {
  const set = (x: number, y: number, terrain?: Terrain, obj?: Obj, data?: number, density = 1) => {
    if (!inBounds(m, x, y)) return;
    const i = idx(m, x, y);
    if (rng.next() > density) return;
    if (terrain !== undefined) { m.terrain[i] = terrain; if (terrain === Terrain.Water || terrain === Terrain.Mountain) { m.obj[i] = Obj.None; m.data[i] = 0; } }
    if (obj !== undefined) {
      if (obj === Obj.Tree && m.terrain[i] !== Terrain.Grass && m.terrain[i] !== Terrain.Dirt) return;
      if ((obj === Obj.Coal || obj === Obj.Iron || obj === Obj.Gold) && m.terrain[i] === Terrain.Water) return;
      if ((obj === Obj.Coal || obj === Obj.Iron || obj === Obj.Gold)) m.terrain[i] = Terrain.Mountain;
      m.obj[i] = obj; m.data[i] = data ?? (obj === Obj.Tree ? 255 : 0);
    }
  };
  switch (op.op) {
    case 'circle':
      for (let y = op.y - op.r; y <= op.y + op.r; y++) for (let x = op.x - op.r; x <= op.x + op.r; x++) {
        const d = Math.hypot(x - op.x, y - op.y);
        if (d <= op.r + (rng.next() - 0.5) * 1.2) set(x, y, op.terrain, op.obj, op.data, op.density);
      }
      break;
    case 'rect':
      for (let y = op.y; y < op.y + op.h; y++) for (let x = op.x; x < op.x + op.w; x++) set(x, y, op.terrain, op.obj, op.data, op.density);
      break;
    case 'clear':
      for (let y = op.y - op.r; y <= op.y + op.r; y++) for (let x = op.x - op.r; x <= op.x + op.r; x++) {
        if (!inBounds(m, x, y) || Math.hypot(x - op.x, y - op.y) > op.r) continue;
        const i = idx(m, x, y);
        m.terrain[i] = Terrain.Grass; m.obj[i] = Obj.None; m.data[i] = 0;
      }
      break;
    case 'river': {
      const steps = Math.ceil(Math.hypot(op.to.x - op.from.x, op.to.y - op.from.y) * 2);
      let wob = 0;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        wob += (rng.next() - 0.5) * 0.6; wob *= 0.9;
        const cx = op.from.x + (op.to.x - op.from.x) * t + wob * 2, cy = op.from.y + (op.to.y - op.from.y) * t + wob * 2;
        for (let y = Math.floor(cy - op.width); y <= cy + op.width; y++) for (let x = Math.floor(cx - op.width); x <= cx + op.width; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d <= op.width / 2) set(x, y, Terrain.Water);
          else if (d <= op.width / 2 + 1 && inBounds(m, x, y) && m.terrain[idx(m, x, y)] !== Terrain.Water) set(x, y, Terrain.Sand, Obj.None);
        }
      }
      break;
    }
  }
}
