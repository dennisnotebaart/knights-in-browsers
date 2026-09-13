// ---- Serialisable game state ----
import type { HouseType, UnitType, Ware } from './defs';
import type { MapData, Point } from './map';

export type Stock = Partial<Record<Ware, number>>;

export interface House {
  id: number;
  type: HouseType;
  x: number; y: number;
  owner: number;
  state: 'building' | 'done' | 'destroyed';
  progress: number;                 // build progress in labourer ticks
  delivered: { wood: number; stone: number };
  hp: number;
  workerId: number;                 // -1 when nobody works here
  builderId: number;                // labourer assigned (-1)
  stock: Stock;                     // inputs (and everything, for the storehouse)
  out: Stock;                       // finished outputs waiting for pickup
  reserved: Stock;                  // wares reserved for a serf who is coming to fetch them
  incoming: Stock;                  // wares a serf is bringing
  workTimer: number;
  working: boolean;
  recipeIdx: number;
  enabled: Partial<Record<Ware, boolean>>; // per-output toggles for multi-recipe houses
  queue: UnitType[];                // school training queue
  trainTimer: number;
  blocked: Partial<Record<Ware, boolean>>; // storehouse: don't accept
  recruits: number[];               // barracks: recruit unit ids inside
  depleted?: boolean;               // mines
  anim: number;
  lastAttackTick: number;
}

export type Task =
  | { kind: 'idle'; wait: number }
  | { kind: 'deliver'; from: number; to: number; toUnit: number; ware: Ware; phase: number; tile: number }
  | { kind: 'buildHouse'; house: number; phase: number }
  | { kind: 'buildTile'; tile: number; phase: number; timer: number }
  | { kind: 'goWork'; house: number }
  | { kind: 'work'; house: number; phase: number; timer: number; tx: number; ty: number; sub: number }
  | { kind: 'eat'; house: number; phase: number; timer: number }
  | { kind: 'goBarracks'; house: number }
  | { kind: 'die'; timer: number }
  | { kind: 'soldier' };

export interface Unit {
  id: number;
  type: UnitType;
  owner: number;
  x: number; y: number;             // tile coordinates; integer when standing
  path: Point[];
  dest: { x: number; y: number; road: boolean } | null;
  pathFails: number;
  hp: number;
  maxHp: number;
  condition: number;                // 1 = full, 0 = starving
  task: Task;
  inHouse: number;                  // house id or -1
  carry: Ware | null;
  dir: number;                      // 0..7, 0 = down
  frame: number;
  moving: boolean;
  groupId: number;
  attackCd: number;
  home: number;                     // work house id or -1
  targetUnit: number;
  targetHouse: number;
  dead: boolean;
  hitFlash: number;
  guardPos: Point | null;
}

export interface Group {
  id: number;
  owner: number;
  units: number[];
  columns: number;
  order: 'idle' | 'move' | 'attack' | 'attackMove';
  dest: Point | null;
  targetUnit: number;
  targetHouse: number;
  aiRole?: 'defend' | 'attack';
  post?: Point;
}

export interface Projectile {
  sx: number; sy: number; tx: number; ty: number; t: number; dur: number;
  kind: 'arrow' | 'bolt' | 'stone';
  targetUnit: number; targetHouse: number; dmg: number; owner: number; bonusVsMounted?: boolean;
}

export interface Fx { x: number; y: number; kind: 'hit' | 'dust' | 'smoke' | 'chop' | 'flag'; t: number; }

export interface Message { tick: number; text: string; x?: number; y?: number; kind: 'info' | 'warn' | 'alert' | 'good'; }

export interface Objective {
  type: 'houses' | 'wares' | 'soldiers' | 'destroyOwner' | 'survive' | 'trained' | 'citizens';
  house?: HouseType; ware?: Ware; unit?: UnitType; owner?: number;
  count?: number; ticks?: number;
  text: string;
}

export interface AttackWave { atTick: number; owner: number; units: { type: UnitType; count: number }[]; at: Point; text?: string; }

export interface GameState {
  tick: number;
  map: MapData;
  houses: House[];
  units: Unit[];
  groups: Group[];
  projectiles: Projectile[];
  fx: Fx[];
  messages: Message[];
  nextId: number;
  player: number;
  stats: { produced: Stock; trained: Partial<Record<UnitType, number>>; killed: number; lost: number; };
  tileIncoming: Record<number, number>;
  outcome: 'playing' | 'won' | 'lost';
  outcomeTick: number;
  missionId: string;
  objectives: Objective[];
  waves: AttackWave[];
  wavesDone: number;
  aiTimers: Record<number, number>;
  pairCooldown: Record<string, number>;
  playerHasPlacedHouse: boolean;
  hints: string[];
  freePlay?: boolean;   // mission already won, player chose to keep playing
}

export const emptyStock = (): Stock => ({});
