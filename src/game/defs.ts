// ---- Core game data: wares, houses, units ----

export type Ware =
  | 'trunk' | 'stone' | 'wood' | 'ironOre' | 'goldOre' | 'coal' | 'steel' | 'gold'
  | 'wine' | 'corn' | 'flour' | 'bread' | 'pig' | 'skin' | 'leather' | 'sausage' | 'horse'
  | 'shield' | 'leatherArmor' | 'axe' | 'sword' | 'bow' | 'crossbow' | 'lance' | 'pike'
  | 'ironShield' | 'ironArmor';

export const WARES: Ware[] = [
  'trunk', 'stone', 'wood', 'ironOre', 'goldOre', 'coal', 'steel', 'gold',
  'wine', 'corn', 'flour', 'bread', 'pig', 'skin', 'leather', 'sausage', 'horse',
  'shield', 'leatherArmor', 'axe', 'sword', 'bow', 'crossbow', 'lance', 'pike',
  'ironShield', 'ironArmor',
];

export const WARE_NAME: Record<Ware, string> = {
  trunk: 'Tree trunk', stone: 'Stone', wood: 'Timber', ironOre: 'Iron ore', goldOre: 'Gold ore',
  coal: 'Coal', steel: 'Steel', gold: 'Gold', wine: 'Wine', corn: 'Corn', flour: 'Flour',
  bread: 'Bread', pig: 'Pig', skin: 'Skin', leather: 'Leather', sausage: 'Sausages',
  horse: 'Horse', shield: 'Wooden shield', leatherArmor: 'Leather armour', axe: 'Hand axe',
  sword: 'Sword', bow: 'Longbow', crossbow: 'Crossbow', lance: 'Lance', pike: 'Pike',
  ironShield: 'Iron shield', ironArmor: 'Iron armour',
};

export const FOOD: Ware[] = ['bread', 'sausage', 'wine'];
export const FOOD_VALUE: Partial<Record<Ware, number>> = { bread: 0.4, sausage: 0.6, wine: 0.3 };
export const WEAPON_WARES: Ware[] = ['shield', 'leatherArmor', 'axe', 'sword', 'bow', 'crossbow', 'lance', 'pike', 'ironShield', 'ironArmor', 'horse'];

export type UnitType =
  | 'serf' | 'laborer' | 'stonemason' | 'woodcutter' | 'carpenter' | 'farmer' | 'miller' | 'baker'
  | 'swineBreeder' | 'butcher' | 'vintner' | 'tanner' | 'miner' | 'metallurgist' | 'smith'
  | 'armorer' | 'stableman' | 'recruit'
  | 'militia' | 'axeFighter' | 'swordFighter' | 'bowman' | 'crossbowman' | 'lanceCarrier'
  | 'pikeman' | 'scout' | 'knight';

export const CITIZEN_TYPES: UnitType[] = [
  'serf', 'laborer', 'stonemason', 'woodcutter', 'carpenter', 'farmer', 'miller', 'baker',
  'swineBreeder', 'butcher', 'vintner', 'tanner', 'miner', 'metallurgist', 'smith', 'armorer',
  'stableman', 'recruit',
];

export const SOLDIER_TYPES: UnitType[] = [
  'militia', 'axeFighter', 'swordFighter', 'bowman', 'crossbowman', 'lanceCarrier', 'pikeman', 'scout', 'knight',
];

export interface UnitDef {
  name: string;
  speed: number;        // tiles per tick
  hp: number;
  attack?: number;      // damage per hit
  defense?: number;     // damage reduction
  range?: number;       // in tiles (>=2 means ranged)
  attackRate?: number;  // ticks between attacks
  mounted?: boolean;
  sight: number;
  desc: string;
  equipment?: Partial<Record<Ware, number>>; // barracks cost
  color: string;        // tunic colour
}

const BASE_SPEED = 0.12;

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  serf:         { name: 'Serf', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Carries wares between houses along roads.', color: '#c9b48a' },
  laborer:      { name: 'Labourer', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Builds roads, fields and houses.', color: '#8a6b3f' },
  stonemason:   { name: 'Stonemason', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Works in the quarry, cuts stone from mountains.', color: '#9a9a9a' },
  woodcutter:   { name: 'Woodcutter', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Fells trees and plants new ones.', color: '#4f7a3a' },
  carpenter:    { name: 'Carpenter', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Saws trunks into timber; also makes wooden weapons and armour.', color: '#b07a40' },
  farmer:       { name: 'Farmer', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Sows and harvests corn fields; also tends vineyards.', color: '#d8c04a' },
  miller:       { name: 'Miller', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Grinds corn into flour.', color: '#e8e0c8' },
  baker:        { name: 'Baker', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Bakes bread from flour.', color: '#f0d8a0' },
  swineBreeder: { name: 'Swine breeder', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Raises pigs on corn.', color: '#c88a8a' },
  butcher:      { name: 'Butcher', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Turns pigs into sausages.', color: '#a03030' },
  vintner:      { name: 'Vintner', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Grows grapes and presses wine.', color: '#7a3a7a' },
  tanner:       { name: 'Tanner', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Tans skins into leather.', color: '#7a5a30' },
  miner:        { name: 'Miner', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Digs coal, iron ore and gold ore.', color: '#505050' },
  metallurgist: { name: 'Metallurgist', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Smelts gold and iron.', color: '#d0a020' },
  smith:        { name: 'Blacksmith', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Forges steel weapons.', color: '#404858' },
  armorer:      { name: 'Armourer', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Makes iron armour and shields.', color: '#6a7080' },
  stableman:    { name: 'Stableman', speed: BASE_SPEED, hp: 8, sight: 4, desc: 'Breeds horses.', color: '#a08050' },
  recruit:      { name: 'Recruit', speed: BASE_SPEED, hp: 10, sight: 4, desc: 'Waits in the barracks to be equipped, or mans a watchtower.', color: '#b0b0b0' },

  militia:      { name: 'Militia', speed: BASE_SPEED, hp: 14, attack: 3, defense: 0, range: 1, attackRate: 10, sight: 6, desc: 'Cheap axe-wielding footman.', color: '#a09070', equipment: { axe: 1 } },
  axeFighter:   { name: 'Axe fighter', speed: BASE_SPEED, hp: 20, attack: 4, defense: 1, range: 1, attackRate: 10, sight: 6, desc: 'Solid melee infantry with leather armour and a shield.', color: '#806040', equipment: { axe: 1, leatherArmor: 1, shield: 1 } },
  swordFighter: { name: 'Sword fighter', speed: BASE_SPEED, hp: 30, attack: 6, defense: 2, range: 1, attackRate: 10, sight: 6, desc: 'Heavy infantry in iron armour.', color: '#607090', equipment: { sword: 1, ironArmor: 1, ironShield: 1 } },
  bowman:       { name: 'Bowman', speed: BASE_SPEED, hp: 14, attack: 3, defense: 0, range: 6, attackRate: 16, sight: 8, desc: 'Ranged archer. Weak up close.', color: '#5a8a4a', equipment: { bow: 1, leatherArmor: 1 } },
  crossbowman:  { name: 'Crossbowman', speed: BASE_SPEED, hp: 18, attack: 5, defense: 1, range: 6, attackRate: 20, sight: 8, desc: 'Armoured ranged unit with a hard-hitting crossbow.', color: '#4a6a7a', equipment: { crossbow: 1, ironArmor: 1 } },
  lanceCarrier: { name: 'Lance carrier', speed: BASE_SPEED, hp: 18, attack: 4, defense: 1, range: 1, attackRate: 12, sight: 6, desc: 'Anti-cavalry infantry. Bonus damage against mounted units.', color: '#907050', equipment: { lance: 1, leatherArmor: 1 } },
  pikeman:      { name: 'Pikeman', speed: BASE_SPEED, hp: 26, attack: 5, defense: 2, range: 1, attackRate: 12, sight: 6, desc: 'Armoured anti-cavalry. Bonus damage against mounted units.', color: '#506070', equipment: { pike: 1, ironArmor: 1 } },
  scout:        { name: 'Scout', speed: 0.22, hp: 24, attack: 4, defense: 1, range: 1, attackRate: 10, sight: 9, mounted: true, desc: 'Fast light cavalry. Bonus damage against ranged units.', color: '#a07040', equipment: { horse: 1, axe: 1, leatherArmor: 1, shield: 1 } },
  knight:       { name: 'Knight', speed: 0.2, hp: 40, attack: 7, defense: 3, range: 1, attackRate: 10, sight: 8, mounted: true, desc: 'Elite heavy cavalry.', color: '#8090b0', equipment: { horse: 1, sword: 1, ironArmor: 1, ironShield: 1 } },
};

export type HouseType =
  | 'storehouse' | 'school' | 'inn' | 'quarry' | 'woodcutters' | 'sawmill' | 'farm' | 'mill' | 'bakery'
  | 'swineFarm' | 'butchers' | 'vineyard' | 'tannery' | 'coalMine' | 'ironMine' | 'goldMine'
  | 'ironSmithy' | 'metallurgists' | 'weaponsWorkshop' | 'armorWorkshop' | 'weaponSmithy'
  | 'armorSmithy' | 'stables' | 'barracks' | 'watchtower';

export interface Recipe { inputs: Partial<Record<Ware, number>>; outputs: Partial<Record<Ware, number>>; time: number; }

export interface HouseDef {
  name: string;
  w: number; h: number;
  entrance: number;           // x offset of the door tile on the bottom row
  cost: { wood: number; stone: number };
  worker?: UnitType;
  inputs: Ware[];
  outputs: Ware[];
  recipes?: Recipe[];         // house picks the first recipe whose inputs are satisfied
  special?: 'store' | 'school' | 'inn' | 'quarry' | 'woodcutters' | 'farm' | 'vineyard' | 'mine' | 'barracks' | 'tower';
  mineWare?: Ware;
  hp: number;
  buildTime: number;          // labourer work ticks
  desc: string;
  roof: string; wall: string; // colours
  order: number;              // build menu order
}

const R = (inputs: Partial<Record<Ware, number>>, outputs: Partial<Record<Ware, number>>, time: number): Recipe => ({ inputs, outputs, time });

export const HOUSE_DEFS: Record<HouseType, HouseDef> = {
  storehouse:  { name: 'Storehouse', w: 3, h: 3, entrance: 1, cost: { wood: 3, stone: 4 }, inputs: WARES, outputs: WARES, special: 'store', hp: 120, buildTime: 220, desc: 'Stores every kind of ware. Serfs fetch and deliver from here.', roof: '#8c3b2b', wall: '#c8b596', order: 0 },
  school:      { name: 'School', w: 3, h: 2, entrance: 1, cost: { wood: 3, stone: 3 }, inputs: ['gold'], outputs: [], special: 'school', hp: 80, buildTime: 160, desc: 'Trains citizens. Each citizen costs one gold.', roof: '#3b4c8c', wall: '#d8d0b0', order: 1 },
  inn:         { name: 'Inn', w: 3, h: 2, entrance: 1, cost: { wood: 4, stone: 3 }, inputs: ['bread', 'sausage', 'wine'], outputs: [], special: 'inn', hp: 80, buildTime: 160, desc: 'Hungry citizens come here to eat bread, sausages and wine.', roof: '#a0522d', wall: '#e0c8a0', order: 2 },
  quarry:      { name: 'Quarry', w: 2, h: 2, entrance: 0, cost: { wood: 2, stone: 1 }, worker: 'stonemason', inputs: [], outputs: ['stone'], special: 'quarry', hp: 60, buildTime: 110, desc: 'The stonemason cuts stone from nearby mountains.', roof: '#707070', wall: '#a8a090', order: 3 },
  woodcutters: { name: "Woodcutter's", w: 2, h: 2, entrance: 0, cost: { wood: 2, stone: 1 }, worker: 'woodcutter', inputs: [], outputs: ['trunk'], special: 'woodcutters', hp: 60, buildTime: 110, desc: 'The woodcutter fells nearby trees and plants new ones.', roof: '#556b2f', wall: '#a88860', order: 4 },
  sawmill:     { name: 'Sawmill', w: 3, h: 2, entrance: 1, cost: { wood: 3, stone: 2 }, worker: 'carpenter', inputs: ['trunk'], outputs: ['wood'], recipes: [R({ trunk: 1 }, { wood: 2 }, 70)], hp: 70, buildTime: 140, desc: 'Saws tree trunks into timber.', roof: '#8b5a2b', wall: '#c8a878', order: 5 },
  farm:        { name: 'Farm', w: 3, h: 2, entrance: 1, cost: { wood: 3, stone: 2 }, worker: 'farmer', inputs: [], outputs: ['corn'], special: 'farm', hp: 70, buildTime: 140, desc: 'The farmer sows and harvests corn on nearby fields.', roof: '#c8a020', wall: '#e0d0a0', order: 6 },
  mill:        { name: 'Mill', w: 2, h: 2, entrance: 0, cost: { wood: 2, stone: 3 }, worker: 'miller', inputs: ['corn'], outputs: ['flour'], recipes: [R({ corn: 1 }, { flour: 1 }, 60)], hp: 70, buildTime: 140, desc: 'Grinds corn into flour.', roof: '#a08060', wall: '#e8e0d0', order: 7 },
  bakery:      { name: 'Bakery', w: 2, h: 2, entrance: 0, cost: { wood: 2, stone: 3 }, worker: 'baker', inputs: ['flour'], outputs: ['bread'], recipes: [R({ flour: 1 }, { bread: 2 }, 70)], hp: 70, buildTime: 140, desc: 'Bakes bread from flour.', roof: '#b0482a', wall: '#f0e0c0', order: 8 },
  swineFarm:   { name: 'Swine farm', w: 3, h: 2, entrance: 1, cost: { wood: 3, stone: 2 }, worker: 'swineBreeder', inputs: ['corn'], outputs: ['pig', 'skin'], recipes: [R({ corn: 2 }, { pig: 1, skin: 1 }, 110)], hp: 70, buildTime: 140, desc: 'Fattens pigs on corn. Yields pigs and skins.', roof: '#8a6a4a', wall: '#c8b0a0', order: 9 },
  butchers:    { name: "Butcher's", w: 2, h: 2, entrance: 0, cost: { wood: 2, stone: 3 }, worker: 'butcher', inputs: ['pig'], outputs: ['sausage'], recipes: [R({ pig: 1 }, { sausage: 3 }, 80)], hp: 70, buildTime: 140, desc: 'Makes sausages from pigs.', roof: '#a03030', wall: '#e0c0c0', order: 10 },
  vineyard:    { name: 'Vineyard', w: 2, h: 2, entrance: 0, cost: { wood: 2, stone: 2 }, worker: 'farmer', inputs: [], outputs: ['wine'], special: 'vineyard', hp: 60, buildTime: 120, desc: 'The farmer tends nearby wine fields and presses wine.', roof: '#6a2a6a', wall: '#d8c8b0', order: 11 },
  tannery:     { name: 'Tannery', w: 2, h: 2, entrance: 0, cost: { wood: 2, stone: 2 }, worker: 'tanner', inputs: ['skin'], outputs: ['leather'], recipes: [R({ skin: 1 }, { leather: 2 }, 70)], hp: 60, buildTime: 130, desc: 'Tans skins into leather.', roof: '#6a4a2a', wall: '#b09070', order: 12 },
  coalMine:    { name: 'Coal mine', w: 2, h: 2, entrance: 0, cost: { wood: 3, stone: 1 }, worker: 'miner', inputs: [], outputs: ['coal'], special: 'mine', mineWare: 'coal', hp: 60, buildTime: 130, desc: 'Mines coal. Must be placed next to a coal deposit.', roof: '#303030', wall: '#706860', order: 13 },
  ironMine:    { name: 'Iron mine', w: 2, h: 2, entrance: 0, cost: { wood: 3, stone: 1 }, worker: 'miner', inputs: [], outputs: ['ironOre'], special: 'mine', mineWare: 'ironOre', hp: 60, buildTime: 130, desc: 'Mines iron ore. Must be placed next to an iron deposit.', roof: '#5a4a40', wall: '#807060', order: 14 },
  goldMine:    { name: 'Gold mine', w: 2, h: 2, entrance: 0, cost: { wood: 3, stone: 1 }, worker: 'miner', inputs: [], outputs: ['goldOre'], special: 'mine', mineWare: 'goldOre', hp: 60, buildTime: 130, desc: 'Mines gold ore. Must be placed next to a gold deposit.', roof: '#8a7020', wall: '#a09060', order: 15 },
  ironSmithy:  { name: 'Iron smithy', w: 2, h: 2, entrance: 0, cost: { wood: 2, stone: 3 }, worker: 'metallurgist', inputs: ['ironOre', 'coal'], outputs: ['steel'], recipes: [R({ ironOre: 1, coal: 1 }, { steel: 1 }, 80)], hp: 70, buildTime: 140, desc: 'Smelts iron ore with coal into steel.', roof: '#404850', wall: '#a09890', order: 16 },
  metallurgists: { name: "Metallurgist's", w: 2, h: 2, entrance: 0, cost: { wood: 2, stone: 3 }, worker: 'metallurgist', inputs: ['goldOre', 'coal'], outputs: ['gold'], recipes: [R({ goldOre: 1, coal: 1 }, { gold: 2 }, 80)], hp: 70, buildTime: 140, desc: 'Smelts gold ore with coal into gold.', roof: '#b08a20', wall: '#d8c890', order: 17 },
  weaponsWorkshop: { name: 'Weapons workshop', w: 3, h: 2, entrance: 1, cost: { wood: 3, stone: 3 }, worker: 'carpenter', inputs: ['wood'], outputs: ['axe', 'bow', 'lance'], recipes: [R({ wood: 1 }, { axe: 1 }, 90), R({ wood: 1 }, { bow: 1 }, 90), R({ wood: 1 }, { lance: 1 }, 90)], hp: 70, buildTime: 150, desc: 'Makes hand axes, longbows and lances from timber.', roof: '#7a5a3a', wall: '#c0a880', order: 18 },
  armorWorkshop: { name: 'Armour workshop', w: 3, h: 2, entrance: 1, cost: { wood: 3, stone: 3 }, worker: 'carpenter', inputs: ['wood', 'leather'], outputs: ['shield', 'leatherArmor'], recipes: [R({ wood: 1 }, { shield: 1 }, 90), R({ leather: 1 }, { leatherArmor: 1 }, 90)], hp: 70, buildTime: 150, desc: 'Makes wooden shields and leather armour.', roof: '#5a4a3a', wall: '#b8a080', order: 19 },
  weaponSmithy: { name: 'Weapon smithy', w: 3, h: 2, entrance: 1, cost: { wood: 3, stone: 4 }, worker: 'smith', inputs: ['steel', 'coal'], outputs: ['sword', 'crossbow', 'pike'], recipes: [R({ steel: 1, coal: 1 }, { sword: 1 }, 100), R({ steel: 1, coal: 1 }, { crossbow: 1 }, 100), R({ steel: 1, coal: 1 }, { pike: 1 }, 100)], hp: 80, buildTime: 160, desc: 'Forges swords, crossbows and pikes from steel.', roof: '#303840', wall: '#908880', order: 20 },
  armorSmithy: { name: 'Armour smithy', w: 3, h: 2, entrance: 1, cost: { wood: 3, stone: 4 }, worker: 'armorer', inputs: ['steel', 'coal'], outputs: ['ironArmor', 'ironShield'], recipes: [R({ steel: 1, coal: 1 }, { ironArmor: 1 }, 100), R({ steel: 1, coal: 1 }, { ironShield: 1 }, 100)], hp: 80, buildTime: 160, desc: 'Forges iron armour and iron shields.', roof: '#404040', wall: '#a0a0a0', order: 21 },
  stables:     { name: 'Stables', w: 3, h: 2, entrance: 1, cost: { wood: 4, stone: 2 }, worker: 'stableman', inputs: ['corn'], outputs: ['horse'], recipes: [R({ corn: 2 }, { horse: 1 }, 130)], hp: 70, buildTime: 150, desc: 'Breeds horses for cavalry. Needs corn.', roof: '#8a6a40', wall: '#d0b890', order: 22 },
  barracks:    { name: 'Barracks', w: 3, h: 3, entrance: 1, cost: { wood: 4, stone: 5 }, inputs: WEAPON_WARES, outputs: [], special: 'barracks', hp: 140, buildTime: 240, desc: 'Recruits are equipped here to become soldiers.', roof: '#6a2020', wall: '#a09080', order: 23 },
  watchtower:  { name: 'Watchtower', w: 1, h: 1, entrance: 0, cost: { wood: 1, stone: 4 }, worker: 'recruit', inputs: ['stone'], outputs: [], special: 'tower', hp: 100, buildTime: 120, desc: 'A recruit inside throws stones at nearby enemies.', roof: '#606060', wall: '#909090', order: 24 },
};

export const HOUSE_TYPES = (Object.keys(HOUSE_DEFS) as HouseType[]).sort((a, b) => HOUSE_DEFS[a].order - HOUSE_DEFS[b].order);

export const MAX_STOCK = 5;         // input / output capacity per ware in a production house
export const TICKS_PER_SEC = 10;
export const HUNGER_PER_TICK = 1 / (TICKS_PER_SEC * 60 * 30); // full to empty in ~30 minutes
export const SCHOOL_TRAIN_TIME = 60;
export const TREE_GROW_TICKS = 1800;
export const FIELD_GROW_TICKS = 700;

export const PLAYER_COLORS = ['#ffffff', '#3a6fd8', '#d83a3a', '#3ab04a', '#d8b03a', '#8a3ad8'];
