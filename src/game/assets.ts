// ---- Image asset loading ----
import type { HouseType, UnitType, Ware } from './defs';
import { UNIT_DEFS, WARES } from './defs';

export interface Assets {
  tex: Record<string, HTMLImageElement>;
  houses: Partial<Record<HouseType, HTMLImageElement>>;
  trees: HTMLImageElement[];
  objs: Record<string, HTMLImageElement>;
  units: Partial<Record<UnitType, HTMLImageElement>>;
  wares: Partial<Record<Ware, HTMLImageElement>>;
}

const TEXTURES = ['grass', 'dirt', 'sand', 'water', 'rock', 'road', 'cornyoung', 'cornripe', 'vine', 'plough', 'wood', 'parchment'];
const HOUSES: HouseType[] = ['storehouse', 'school', 'inn', 'quarry', 'woodcutters', 'sawmill', 'farm', 'mill', 'bakery', 'swineFarm', 'butchers', 'vineyard', 'tannery', 'coalMine', 'ironMine', 'goldMine', 'ironSmithy', 'metallurgists', 'weaponsWorkshop', 'armorWorkshop', 'weaponSmithy', 'armorSmithy', 'stables', 'barracks', 'watchtower'];
const TREES = ['oak', 'pine', 'birch'];
const OBJS = ['stump', 'sapling', 'bush', 'boulder'];

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { console.warn('missing asset', src); resolve(null); };
    img.src = src;
  });
}

export async function loadAssets(onProgress?: (done: number, total: number) => void): Promise<Assets> {
  const jobs: { key: string; group: 'tex' | 'house' | 'tree' | 'obj' | 'unit' | 'ware'; src: string }[] = [];
  for (const w of WARES) jobs.push({ key: w, group: 'ware', src: `art/sprites/ware-${w}.webp` });
  for (const u of Object.keys(UNIT_DEFS) as UnitType[]) jobs.push({ key: u, group: 'unit', src: `art/sprites/unit-${u}.webp` });
  for (const t of TEXTURES) jobs.push({ key: t, group: 'tex', src: `art/tex/${t}.webp` });
  for (const h of HOUSES) jobs.push({ key: h, group: 'house', src: `art/sprites/house-${h}.webp` });
  for (const t of TREES) jobs.push({ key: t, group: 'tree', src: `art/sprites/tree-${t}.webp` });
  for (const o of OBJS) jobs.push({ key: o, group: 'obj', src: `art/sprites/obj-${o}.webp` });
  const A: Assets = { tex: {}, houses: {}, trees: [], objs: {}, units: {}, wares: {} };
  let done = 0;
  await Promise.all(jobs.map(async j => {
    const img = await load(j.src);
    done++; onProgress?.(done, jobs.length);
    if (!img) return;
    if (j.group === 'tex') A.tex[j.key] = img;
    else if (j.group === 'house') A.houses[j.key as HouseType] = img;
    else if (j.group === 'tree') A.trees.push(img);
    else if (j.group === 'unit') A.units[j.key as UnitType] = img;
    else if (j.group === 'ware') A.wares[j.key as Ware] = img;
    else A.objs[j.key] = img;
  }));
  return A;
}
