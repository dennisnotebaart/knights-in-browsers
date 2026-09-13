// ---- Campaign & skirmish missions ----
import { HOUSE_DEFS } from './defs';
import type { HouseType, UnitType, Ware } from './defs';
import { Obj, Terrain, findPath, idx, inBounds, isBuildable } from './map';
import type { MapSpec, Point } from './map';
import type { Game } from './sim';
import type { AttackWave, Objective, House, Stock } from './state';
import { spawnSoldierGroup } from './combat';

export interface Mission {
  id: string;
  name: string;
  art: string;
  briefing: string[];
  map: MapSpec;
  objectives: Objective[];
  waves: AttackWave[];
  setup: (g: Game) => void;
  camera: Point;
  hints: string[];
  campaign: boolean;
}

const MIN = 600; // ticks per minute

// ---------- helpers ----------
function clearGround(g: Game, x: number, y: number, w: number, h: number) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    if (!inBounds(g.map, xx, yy)) continue;
    const i = idx(g.map, xx, yy);
    g.map.terrain[i] = Terrain.Grass; g.map.obj[i] = Obj.None; g.map.data[i] = 0;
  }
}

/** Place a finished house (clears the ground first) and staff it. */
export function house(g: Game, owner: number, type: HouseType, x: number, y: number, staffed = true): House {
  const def = HOUSE_DEFS[type];
  clearGround(g, x, y, def.w, def.h + 1);
  const h = g.addHouse(type, owner, x, y, true);
  if (staffed && def.worker) {
    const d = g.doorPos(h);
    const u = g.addUnit(def.worker, owner, d.x, d.y);
    u.home = h.id; h.workerId = u.id; u.inHouse = h.id;
    u.task = { kind: 'work', house: h.id, phase: 0, timer: 0, tx: 0, ty: 0, sub: 0 };
  }
  return h;
}

export function stock(h: House, s: Stock) { for (const w of Object.keys(s) as Ware[]) h.stock[w] = (h.stock[w] ?? 0) + s[w]!; }

export function units(g: Game, owner: number, type: UnitType, n: number, x: number, y: number) {
  for (let i = 0; i < n; i++) {
    let px = x + (i % 4), py = y + Math.floor(i / 4);
    if (!g.walkable(px, py)) { outer: for (let r = 1; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (g.walkable(x + dx, y + dy)) { px = x + dx; py = y + dy; break outer; } }
    g.addUnit(type, owner, px, py);
  }
}

export function guards(g: Game, owner: number, types: { type: UnitType; count: number }[], x: number, y: number, columns = 3) {
  const grp = spawnSoldierGroup(g, owner, types, { x, y });
  grp.columns = columns;
  grp.aiRole = 'defend'; grp.post = { x, y };
  return grp;
}

/** Build a road between two points across free ground. */
export function road(g: Game, from: Point, to: Point) {
  const pass = (x: number, y: number) => { if (!inBounds(g.map, x, y)) return false; const i = idx(g.map, x, y); const o = g.map.obj[i]; const t = g.map.terrain[i]; if (t === Terrain.Water || t === Terrain.Mountain) return false; if (g.map.house[i] >= 0) return g.doorTiles.has(i); return o === Obj.None || o === Obj.Road || o === Obj.Bush || o === Obj.Stump || o === Obj.Tree; };
  const p = findPath(g.map, from.x, from.y, to.x, to.y, pass, 20000);
  const pts = [from, ...(p ?? []), to];
  for (const pt of pts) {
    if (!inBounds(g.map, pt.x, pt.y)) continue;
    const i = idx(g.map, pt.x, pt.y);
    if (g.map.house[i] >= 0) continue;
    if (g.map.terrain[i] === Terrain.Water || g.map.terrain[i] === Terrain.Mountain) continue;
    g.map.obj[i] = Obj.Road; g.map.data[i] = 0; g.markDirty(pt.x, pt.y);
  }
}

/** Connect every house of an owner by road to the storehouse. */
export function connectRoads(g: Game, owner: number) {
  const st = g.s.houses.find(h => h.owner === owner && h.type === 'storehouse');
  if (!st) return;
  const sf = g.frontPos(st);
  for (const h of g.s.houses) { if (h.owner !== owner || h === st) continue; road(g, g.frontPos(h), sf); }
}

export function fields(g: Game, x: number, y: number, w: number, h: number, wine = false) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    if (!isBuildable(g.map, xx, yy)) continue;
    const i = idx(g.map, xx, yy);
    g.map.obj[i] = wine ? Obj.WineField : Obj.Field; g.map.data[i] = 1 + ((xx + yy) % 5);
  }
}

const wave = (min: number, owner: number, x: number, y: number, units: { type: UnitType; count: number }[], text?: string): AttackWave => ({ atTick: Math.round(min * MIN), owner, at: { x, y }, units, text });

const OBJ = {
  houses: (house: HouseType, count = 1): Objective => ({ type: 'houses', house, count, text: `Build ${count > 1 ? count + ' ' : /^[aeiou]/i.test(HOUSE_DEFS[house].name) ? 'an ' : 'a '}${HOUSE_DEFS[house].name}${count > 1 ? 's' : ''}` }),
  wares: (ware: Ware, count: number, name: string): Objective => ({ type: 'wares', ware, count, text: `Produce ${count} ${name}` }),
  soldiers: (count: number): Objective => ({ type: 'soldiers', count, text: `Have an army of ${count} soldiers` }),
  citizens: (count: number): Objective => ({ type: 'citizens', count, text: `Have ${count} citizens` }),
  destroy: (owner: number, name: string): Objective => ({ type: 'destroyOwner', owner, text: `Destroy the ${name} (storehouse, barracks, school, towers and army)` }),
  survive: (min: number): Objective => ({ type: 'survive', ticks: min * MIN, text: `Survive for ${min} minutes` }),
};

// ---------- a standard starting village ----------
function playerVillage(g: Game, x: number, y: number, level: 0 | 1 | 2 | 3) {
  const p = g.s.player;
  clearGround(g, x - 3, y - 3, 22, 18);
  const st = house(g, p, 'storehouse', x, y);
  stock(st, { wood: 24, stone: 24, gold: 12, bread: 20, sausage: 10, wine: 10 });
  house(g, p, 'school', x + 5, y + 1);
  units(g, p, 'serf', 5, x + 1, y + 4);
  units(g, p, 'laborer', 4, x + 6, y + 4);
  if (level >= 1) {
    house(g, p, 'inn', x + 9, y + 1);
    stock(g.s.houses[g.s.houses.length - 1], { bread: 4, sausage: 2 });
    house(g, p, 'woodcutters', x - 2, y + 6);
    house(g, p, 'sawmill', x + 1, y + 6);
    house(g, p, 'quarry', x + 12, y + 5);
    stock(st, { wood: 20, stone: 20, gold: 10, bread: 10 });
    units(g, p, 'serf', 3, x + 3, y + 4);
    units(g, p, 'laborer', 2, x + 8, y + 4);
  }
  if (level >= 2) {
    house(g, p, 'farm', x + 5, y + 9);
    fields(g, x + 5, y + 12, 6, 3);
    house(g, p, 'mill', x + 9, y + 9);
    house(g, p, 'bakery', x + 12, y + 9);
    house(g, p, 'swineFarm', x - 2, y + 10);
    house(g, p, 'butchers', x + 2, y + 10);
    stock(st, { corn: 10, flour: 4, bread: 10, sausage: 8, gold: 10, wood: 10, stone: 10 });
    units(g, p, 'serf', 3, x + 3, y + 4);
  }
  if (level >= 3) {
    house(g, p, 'barracks', x + 16, y);
    stock(g.s.houses[g.s.houses.length - 1], { axe: 6, shield: 6, leatherArmor: 6, bow: 4 });
    house(g, p, 'weaponsWorkshop', x + 16, y + 5);
    house(g, p, 'armorWorkshop', x + 16, y + 8);
    house(g, p, 'tannery', x + 20, y + 8);
    stock(st, { wood: 20, leather: 8, gold: 14, bread: 10, sausage: 10, wine: 6, stone: 12 });
    units(g, p, 'recruit', 6, x + 17, y + 4);
  }
  connectRoads(g, p);
}

function enemyTown(g: Game, owner: number, x: number, y: number, strength: 1 | 2 | 3, towers = 0) {
  clearGround(g, x - 3, y - 3, 22, 16);
  const st = house(g, owner, 'storehouse', x, y);
  stock(st, { bread: 20, sausage: 20, wine: 20, wood: 10, stone: 10 });
  house(g, owner, 'barracks', x + 5, y);
  house(g, owner, 'school', x + 10, y + 1);
  house(g, owner, 'inn', x, y + 5);
  house(g, owner, 'sawmill', x + 4, y + 5);
  house(g, owner, 'woodcutters', x + 8, y + 5);
  house(g, owner, 'farm', x + 11, y + 5);
  fields(g, x + 10, y + 8, 6, 2);
  units(g, owner, 'serf', 3, x + 2, y + 4);
  if (strength >= 2) { house(g, owner, 'quarry', x - 2, y + 9); house(g, owner, 'bakery', x + 2, y + 9); house(g, owner, 'weaponsWorkshop', x + 5, y + 9); }
  if (strength >= 3) { house(g, owner, 'weaponSmithy', x + 14, y); house(g, owner, 'armorSmithy', x + 14, y + 9); house(g, owner, 'stables', x + 9, y + 12); }
  for (let t = 0; t < towers; t++) house(g, owner, 'watchtower', x - 3 + t * 6, y - 3, true);
  for (let t = 0; t < towers; t++) { const h = g.s.houses[g.s.houses.length - 1 - t]; stock(h, { stone: 5 }); }
  connectRoads(g, owner);
  // territory so the player can't build on top of them
  for (const h of g.s.houses) if (h.owner === owner) g.claimTerritory(h);
}

// ---------- missions ----------
export const MISSIONS: Mission[] = [
  {
    id: 'm1', name: 'A New Home', art: 'art/m1.jpg', campaign: true,
    briefing: [
      'My lord, after a long march we have reached the valley the old maps promised. There is a river to the south, forest to the west and a rocky hill to the east: everything a settlement needs.',
      'The wagons carry enough timber, stone and food for a start, but the men will soon grow hungry. Build an Inn before the bread runs out, and set up a Quarry, a Woodcutter\'s hut and a Sawmill so the builders never wait for materials.',
      'Remember: serfs only carry wares along roads. Every house must be connected to the Storehouse by road, and the School turns gold into new citizens.',
    ],
    map: {
      w: 64, h: 64, seed: 11, forest: 0.45, hills: 0.35, paint: [
        { op: 'clear', x: 22, y: 20, r: 12 },
        { op: 'circle', x: 44, y: 14, r: 5, terrain: Terrain.Mountain },
        { op: 'circle', x: 46, y: 24, r: 4, terrain: Terrain.Mountain },
        { op: 'circle', x: 10, y: 26, r: 6, obj: Obj.Tree, density: 0.8 },
        { op: 'circle', x: 30, y: 8, r: 5, obj: Obj.Tree, density: 0.7 },
        { op: 'river', from: { x: 0, y: 44 }, to: { x: 63, y: 50 }, width: 3 },
        { op: 'circle', x: 50, y: 40, r: 3, obj: Obj.Coal, data: 30 },
        { op: 'circle', x: 56, y: 12, r: 3, obj: Obj.Gold, data: 20 },
      ],
    },
    objectives: [OBJ.houses('inn'), OBJ.houses('quarry'), OBJ.houses('woodcutters'), OBJ.houses('sawmill'), OBJ.houses('farm'), OBJ.wares('wood', 12, 'timber'), OBJ.citizens(15)],
    waves: [],
    setup: g => { playerVillage(g, 18, 16, 0); },
    camera: { x: 20, y: 18 },
    hints: [
      'Open the Build tab and place a house. Then draw roads from its door to the storehouse road.',
      'Labourers build roads and houses. Serfs deliver timber and stone to the site.',
      'Train more serfs and labourers at the School (1 gold each).',
      'Citizens get hungry: an Inn stocked with bread keeps them working.',
    ],
  },
  {
    id: 'm2', name: 'Bread and Salt', art: 'art/m2.jpg', campaign: true,
    briefing: [
      'The village stands, my lord, but our stores are thin and winter is coming. A town runs on its stomach: bread from the fields and sausages from the pig sties.',
      'Lay out corn fields around a Farm, grind the corn in a Mill and bake it in a Bakery. A Swine farm fattens pigs on corn for the Butcher. Wine from a Vineyard keeps spirits high.',
      'Scouts report bandits in the eastern hills. A handful of axe fighters guard the road, but do not send them wandering.',
    ],
    map: {
      w: 72, h: 64, seed: 23, forest: 0.5, hills: 0.4, paint: [
        { op: 'clear', x: 22, y: 24, r: 13 },
        { op: 'circle', x: 8, y: 12, r: 6, terrain: Terrain.Mountain },
        { op: 'circle', x: 14, y: 40, r: 5, obj: Obj.Tree, density: 0.8 },
        { op: 'circle', x: 36, y: 8, r: 6, obj: Obj.Tree, density: 0.7 },
        { op: 'river', from: { x: 0, y: 56 }, to: { x: 71, y: 60 }, width: 3 },
        { op: 'clear', x: 62, y: 20, r: 6 },
        { op: 'circle', x: 60, y: 46, r: 4, obj: Obj.Iron, data: 30 },
        { op: 'circle', x: 20, y: 6, r: 3, obj: Obj.Gold, data: 20 },
      ],
    },
    objectives: [OBJ.houses('farm', 2), OBJ.houses('mill'), OBJ.houses('bakery'), OBJ.houses('swineFarm'), OBJ.houses('butchers'), OBJ.houses('vineyard'), OBJ.wares('bread', 30, 'bread'), OBJ.wares('sausage', 12, 'sausages')],
    waves: [
      wave(9, 2, 66, 20, [{ type: 'militia', count: 3 }], 'Bandits are coming from the east!'),
      wave(17, 2, 66, 20, [{ type: 'militia', count: 4 }, { type: 'axeFighter', count: 1 }], 'Bandits are coming from the east!'),
      wave(26, 2, 66, 20, [{ type: 'axeFighter', count: 4 }, { type: 'bowman', count: 2 }], 'A larger band of raiders approaches!'),
    ],
    setup: g => {
      playerVillage(g, 16, 18, 1);
      guards(g, g.s.player, [{ type: 'axeFighter', count: 6 }], 36, 22, 3);
    },
    camera: { x: 20, y: 22 },
    hints: [
      'Fields are placed from the Build tab like roads. A farm needs 8-12 field tiles nearby.',
      'Vineyards need wine fields; each wine field costs one timber.',
      'Select your soldiers and right-click to move them. Right-click an enemy to attack.',
    ],
  },
  {
    id: 'm3', name: 'Iron in the Hills', art: 'art/m3.jpg', campaign: true,
    briefing: [
      'The bandits were only the beginning. Their master, a lord who calls himself the Usurper, has his eye on our valley. We need real soldiers, and soldiers need steel.',
      'The hills to the north hold coal, iron and gold. Dig mines next to the deposits, smelt iron ore with coal in an Iron smithy, and let the Weapon and Armour smithies turn steel into swords, pikes and armour.',
      'Gold from the Metallurgist keeps the School running. Build a Barracks: recruits trained at the School are equipped there.',
    ],
    map: {
      w: 80, h: 64, seed: 37, forest: 0.45, hills: 0.5, paint: [
        { op: 'clear', x: 24, y: 30, r: 14 },
        { op: 'circle', x: 20, y: 10, r: 7, terrain: Terrain.Mountain },
        { op: 'circle', x: 34, y: 8, r: 6, terrain: Terrain.Mountain },
        { op: 'circle', x: 14, y: 12, r: 3, obj: Obj.Coal, data: 40 },
        { op: 'circle', x: 26, y: 8, r: 3, obj: Obj.Iron, data: 40 },
        { op: 'circle', x: 38, y: 10, r: 2, obj: Obj.Gold, data: 30 },
        { op: 'circle', x: 8, y: 40, r: 6, obj: Obj.Tree, density: 0.8 },
        { op: 'circle', x: 44, y: 44, r: 6, obj: Obj.Tree, density: 0.7 },
        { op: 'river', from: { x: 0, y: 58 }, to: { x: 79, y: 54 }, width: 3 },
        { op: 'clear', x: 70, y: 22, r: 6 },
      ],
    },
    objectives: [OBJ.houses('coalMine'), OBJ.houses('ironMine'), OBJ.houses('goldMine'), OBJ.houses('ironSmithy'), OBJ.houses('metallurgists'), OBJ.houses('weaponSmithy'), OBJ.houses('armorSmithy'), OBJ.houses('barracks'), OBJ.soldiers(12)],
    waves: [
      wave(12, 2, 74, 22, [{ type: 'axeFighter', count: 4 }], 'The Usurper\'s scouts probe our defences!'),
      wave(22, 2, 74, 22, [{ type: 'axeFighter', count: 4 }, { type: 'bowman', count: 3 }]),
      wave(34, 2, 74, 22, [{ type: 'swordFighter', count: 3 }, { type: 'axeFighter', count: 4 }, { type: 'bowman', count: 3 }], 'A strong enemy force approaches from the east!'),
      wave(48, 2, 74, 22, [{ type: 'swordFighter', count: 5 }, { type: 'scout', count: 3 }, { type: 'crossbowman', count: 3 }]),
    ],
    setup: g => {
      playerVillage(g, 16, 24, 2);
      const st = g.s.houses[0]; stock(st, { gold: 12, coal: 4, steel: 4 });
      guards(g, g.s.player, [{ type: 'axeFighter', count: 6 }, { type: 'bowman', count: 3 }], 40, 28, 3);
    },
    camera: { x: 22, y: 26 },
    hints: [
      'Mines must touch a deposit: the placement ghost turns red otherwise.',
      'Toggle which weapons a smithy makes by clicking the ware icons in its panel.',
      'In the Barracks panel, click a soldier type to equip a recruit.',
    ],
  },
  {
    id: 'm4', name: 'The Raiders', art: 'art/m4.jpg', campaign: true,
    briefing: [
      'The Usurper has lost patience. His captains have sworn to burn our town before the moon is full, and their war bands are already on the march.',
      'We have a strong town, a barracks with weapons and two watchtowers. Recruits with stones in the towers throw them at anyone who comes too close. Keep the barracks busy, keep the men fed, and hold the line.',
      'Hold out for thirty minutes and the raiders will break. Lose the storehouse and the school, and all is lost.',
    ],
    map: {
      w: 80, h: 72, seed: 51, forest: 0.5, hills: 0.4, paint: [
        { op: 'clear', x: 26, y: 34, r: 16 },
        { op: 'circle', x: 10, y: 18, r: 6, terrain: Terrain.Mountain },
        { op: 'circle', x: 6, y: 20, r: 3, obj: Obj.Coal, data: 40 },
        { op: 'circle', x: 14, y: 14, r: 3, obj: Obj.Iron, data: 40 },
        { op: 'circle', x: 16, y: 24, r: 2, obj: Obj.Gold, data: 30 },
        { op: 'circle', x: 10, y: 50, r: 7, obj: Obj.Tree, density: 0.8 },
        { op: 'circle', x: 40, y: 12, r: 6, obj: Obj.Tree, density: 0.7 },
        { op: 'river', from: { x: 40, y: 71 }, to: { x: 79, y: 40 }, width: 3 },
        { op: 'clear', x: 72, y: 20, r: 6 }, { op: 'clear', x: 40, y: 64, r: 5 }, { op: 'clear', x: 72, y: 58, r: 6 },
      ],
    },
    objectives: [OBJ.survive(30)],
    waves: [
      wave(4, 2, 74, 20, [{ type: 'militia', count: 5 }]),
      wave(8, 2, 74, 20, [{ type: 'axeFighter', count: 5 }, { type: 'bowman', count: 2 }]),
      wave(12, 2, 40, 64, [{ type: 'scout', count: 4 }], 'Riders from the south!'),
      wave(16, 2, 74, 20, [{ type: 'axeFighter', count: 6 }, { type: 'bowman', count: 4 }]),
      wave(20, 2, 72, 58, [{ type: 'swordFighter', count: 4 }, { type: 'lanceCarrier', count: 3 }], 'Heavy infantry from the south-east!'),
      wave(24, 2, 74, 20, [{ type: 'swordFighter', count: 4 }, { type: 'crossbowman', count: 4 }, { type: 'scout', count: 3 }]),
      wave(28, 2, 74, 20, [{ type: 'knight', count: 2 }, { type: 'swordFighter', count: 4 }, { type: 'bowman', count: 3 }], 'The Usurper\'s knights ride against us!'),
    ],
    setup: g => {
      playerVillage(g, 18, 26, 3);
      const p = g.s.player;
      house(g, p, 'watchtower', 40, 24); stock(g.s.houses[g.s.houses.length - 1], { stone: 5 });
      house(g, p, 'watchtower', 40, 34); stock(g.s.houses[g.s.houses.length - 1], { stone: 5 });
      units(g, p, 'recruit', 4, 38, 30);
      connectRoads(g, p);
      guards(g, p, [{ type: 'axeFighter', count: 6 }, { type: 'swordFighter', count: 2 }], 42, 29, 4);
      guards(g, p, [{ type: 'bowman', count: 6 }], 38, 29, 6);
    },
    camera: { x: 28, y: 28 },
    hints: [
      'Watchtowers need a recruit inside and stones delivered by serfs.',
      'Bowmen behind a line of axe fighters do most of the work.',
      'Hungry soldiers fight badly. Serfs bring them food automatically while there is bread in the storehouse.',
    ],
  },
  {
    id: 'm5', name: 'Across the River', art: 'art/m5.jpg', campaign: true,
    briefing: [
      'The raiders are broken and their captain lies dead. Now it is our turn. Across the river stands the fort from which the raids were launched: a storehouse, a barracks and towers to guard them.',
      'There is a ford in the middle of the river. Muster an army at the barracks, march it across and raze the fort. Watchtowers throw stones: bring them down with archers or rush them with cavalry.',
      'The fort will not sit idle. Expect counter-attacks while you build up.',
    ],
    map: {
      w: 80, h: 72, seed: 67, forest: 0.45, hills: 0.4, paint: [
        { op: 'clear', x: 22, y: 34, r: 15 },
        { op: 'river', from: { x: 44, y: 0 }, to: { x: 50, y: 71 }, width: 4 },
        { op: 'clear', x: 47, y: 36, r: 3 },
        { op: 'circle', x: 8, y: 14, r: 6, terrain: Terrain.Mountain },
        { op: 'circle', x: 4, y: 16, r: 3, obj: Obj.Coal, data: 40 },
        { op: 'circle', x: 12, y: 10, r: 3, obj: Obj.Iron, data: 40 },
        { op: 'circle', x: 14, y: 20, r: 2, obj: Obj.Gold, data: 30 },
        { op: 'circle', x: 10, y: 54, r: 7, obj: Obj.Tree, density: 0.8 },
        { op: 'circle', x: 30, y: 12, r: 6, obj: Obj.Tree, density: 0.7 },
        { op: 'clear', x: 64, y: 30, r: 14 },
      ],
    },
    objectives: [OBJ.destroy(2, 'enemy fort')],
    waves: [
      wave(8, 2, 60, 36, [{ type: 'axeFighter', count: 5 }, { type: 'bowman', count: 3 }]),
      wave(20, 2, 60, 36, [{ type: 'swordFighter', count: 4 }, { type: 'crossbowman', count: 3 }, { type: 'scout', count: 2 }]),
      wave(35, 2, 60, 36, [{ type: 'knight', count: 3 }, { type: 'pikeman', count: 4 }, { type: 'crossbowman', count: 4 }]),
    ],
    setup: g => {
      playerVillage(g, 14, 26, 3);
      const p = g.s.player;
      stock(g.s.houses[0], { steel: 10, coal: 10, ironArmor: 4, sword: 4, horse: 2, gold: 20 });
      guards(g, p, [{ type: 'axeFighter', count: 6 }, { type: 'bowman', count: 4 }], 38, 32, 4);
      enemyTown(g, 2, 58, 24, 2, 2);
      guards(g, 2, [{ type: 'swordFighter', count: 4 }, { type: 'axeFighter', count: 4 }], 56, 38, 4);
      guards(g, 2, [{ type: 'bowman', count: 5 }], 62, 40, 5);
      guards(g, 2, [{ type: 'lanceCarrier', count: 4 }], 68, 36, 4);
    },
    camera: { x: 22, y: 30 },
    hints: [
      'Link small groups into one big group with the Link button, then split them before a fight to flank.',
      'Towers run out of stones. Draw their fire with cheap militia.',
    ],
  },
  {
    id: 'm6', name: "The Usurper's Keep", art: 'art/m6.jpg', campaign: true,
    briefing: [
      'This is the end of the road, my lord. The Usurper has retreated to his keep in the north, and his last ally holds a fortified town in the south-east. Both will send everything they have against us.',
      'Our town is strong and the smithies glow day and night. Build the largest army the valley has ever seen: knights and sword fighters to break their lines, pikemen against their cavalry, crossbowmen against their towers.',
      'Raze both strongholds and the valley is ours forever.',
    ],
    map: {
      w: 96, h: 80, seed: 89, forest: 0.45, hills: 0.5, paint: [
        { op: 'clear', x: 24, y: 40, r: 17 },
        { op: 'circle', x: 8, y: 30, r: 7, terrain: Terrain.Mountain },
        { op: 'circle', x: 4, y: 34, r: 3, obj: Obj.Coal, data: 60 },
        { op: 'circle', x: 12, y: 26, r: 3, obj: Obj.Iron, data: 60 },
        { op: 'circle', x: 14, y: 36, r: 2, obj: Obj.Gold, data: 40 },
        { op: 'circle', x: 10, y: 60, r: 7, obj: Obj.Tree, density: 0.8 },
        { op: 'circle', x: 40, y: 60, r: 6, obj: Obj.Tree, density: 0.7 },
        { op: 'river', from: { x: 50, y: 0 }, to: { x: 60, y: 79 }, width: 4 },
        { op: 'clear', x: 54, y: 30, r: 3 }, { op: 'clear', x: 57, y: 56, r: 3 },
        { op: 'clear', x: 72, y: 14, r: 15 }, { op: 'clear', x: 76, y: 60, r: 14 },
      ],
    },
    objectives: [OBJ.destroy(2, "Usurper's keep"), OBJ.destroy(3, 'southern stronghold')],
    waves: [
      wave(6, 2, 62, 28, [{ type: 'axeFighter', count: 6 }, { type: 'bowman', count: 3 }]),
      wave(14, 3, 62, 56, [{ type: 'swordFighter', count: 4 }, { type: 'lanceCarrier', count: 3 }]),
      wave(24, 2, 62, 28, [{ type: 'knight', count: 3 }, { type: 'swordFighter', count: 4 }, { type: 'crossbowman', count: 4 }]),
      wave(36, 3, 62, 56, [{ type: 'scout', count: 5 }, { type: 'pikeman', count: 4 }, { type: 'bowman', count: 4 }]),
      wave(50, 2, 62, 28, [{ type: 'knight', count: 5 }, { type: 'swordFighter', count: 6 }, { type: 'crossbowman', count: 5 }], 'The Usurper sends his household guard!'),
    ],
    setup: g => {
      playerVillage(g, 14, 32, 3);
      const p = g.s.player;
      const st = g.s.houses[0];
      stock(st, { steel: 16, coal: 16, ironArmor: 6, sword: 6, ironShield: 4, horse: 4, gold: 30, bread: 20, sausage: 20 });
      house(g, p, 'coalMine', 6, 38); house(g, p, 'ironMine', 14, 28); house(g, p, 'goldMine', 15, 38);
      house(g, p, 'ironSmithy', 20, 44); house(g, p, 'metallurgists', 24, 44); house(g, p, 'weaponSmithy', 28, 44); house(g, p, 'armorSmithy', 32, 44); house(g, p, 'stables', 36, 40);
      connectRoads(g, p);
      guards(g, p, [{ type: 'swordFighter', count: 6 }, { type: 'axeFighter', count: 4 }], 40, 36, 5);
      guards(g, p, [{ type: 'crossbowman', count: 4 }, { type: 'bowman', count: 4 }], 38, 40, 8);
      enemyTown(g, 2, 66, 8, 3, 3);
      guards(g, 2, [{ type: 'swordFighter', count: 6 }, { type: 'pikeman', count: 4 }], 64, 24, 5);
      guards(g, 2, [{ type: 'crossbowman', count: 6 }], 72, 26, 6);
      guards(g, 2, [{ type: 'knight', count: 4 }], 80, 20, 4);
      enemyTown(g, 3, 70, 54, 2, 2);
      guards(g, 3, [{ type: 'axeFighter', count: 8 }], 66, 68, 4);
      guards(g, 3, [{ type: 'bowman', count: 6 }, { type: 'scout', count: 4 }], 76, 70, 5);
    },
    camera: { x: 24, y: 36 },
    hints: ['Pikemen and lance carriers deal double damage to cavalry.', 'Scouts and knights deal extra damage to archers.'],
  },
  {
    id: 'skirmish', name: 'Free Play: The Long Valley', art: 'art/title.jpg', campaign: false,
    briefing: [
      'A wide valley, a rival lord at the far end, and all the time in the world. Build the town you always wanted, then go and settle the argument.',
      'The enemy grows bolder every ten minutes or so.',
    ],
    map: {
      w: 96, h: 80, seed: 1234, forest: 0.5, hills: 0.5, paint: [
        { op: 'clear', x: 22, y: 40, r: 16 },
        { op: 'circle', x: 8, y: 20, r: 7, terrain: Terrain.Mountain },
        { op: 'circle', x: 4, y: 24, r: 3, obj: Obj.Coal, data: 80 },
        { op: 'circle', x: 12, y: 16, r: 3, obj: Obj.Iron, data: 80 },
        { op: 'circle', x: 14, y: 26, r: 3, obj: Obj.Gold, data: 60 },
        { op: 'circle', x: 30, y: 66, r: 5, terrain: Terrain.Mountain },
        { op: 'circle', x: 10, y: 60, r: 8, obj: Obj.Tree, density: 0.8 },
        { op: 'circle', x: 36, y: 20, r: 7, obj: Obj.Tree, density: 0.7 },
        { op: 'river', from: { x: 56, y: 0 }, to: { x: 62, y: 79 }, width: 4 },
        { op: 'clear', x: 59, y: 40, r: 3 },
        { op: 'clear', x: 76, y: 38, r: 15 },
      ],
    },
    objectives: [OBJ.destroy(2, 'rival lord')],
    waves: Array.from({ length: 12 }, (_, i) => wave(10 + i * 9, 2, 66, 40, i < 3 ? [{ type: 'axeFighter', count: 3 + i }, { type: 'bowman', count: 1 + i }] : i < 7 ? [{ type: 'swordFighter', count: i }, { type: 'bowman', count: 3 }, { type: 'scout', count: 2 }] : [{ type: 'knight', count: i - 4 }, { type: 'swordFighter', count: 5 }, { type: 'crossbowman', count: 4 }, { type: 'pikeman', count: 3 }])),
    setup: g => {
      playerVillage(g, 14, 32, 1);
      stock(g.s.houses[0], { gold: 20, wood: 20, stone: 20 });
      guards(g, g.s.player, [{ type: 'axeFighter', count: 4 }], 36, 36, 4);
      enemyTown(g, 2, 70, 30, 3, 3);
      guards(g, 2, [{ type: 'swordFighter', count: 6 }, { type: 'axeFighter', count: 6 }], 66, 46, 6);
      guards(g, 2, [{ type: 'crossbowman', count: 6 }], 74, 48, 6);
    },
    camera: { x: 22, y: 36 },
    hints: [],
  },
];

export const missionById = (id: string) => MISSIONS.find(m => m.id === id)!;
