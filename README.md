# Knights in Browsers

A fan-made, browser-based strategy game in the spirit of *Knights and Merchants*: build a
medieval economy out of serfs, roads and production chains, keep everyone fed, then raise an
army and settle the argument with the neighbours.

Everything runs client-side (TypeScript + Canvas 2D, no engine). Terrain textures, houses,
trees, unit sprite sheets, ware icons and the menu paintings were generated with Imagine.art
and post-processed with the scripts under `scripts/` (background removal, sheet splitting,
normalisation, WebP packing). Effects and a few icons are still drawn procedurally.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
```

The `dist/` folder is a static site and can be hosted anywhere. A GitHub Actions workflow
deploys `main` to GitHub Pages (enable *Settings → Pages → Source: GitHub Actions* once).

## What's in the box

- **Economy**: storehouse, school, inn, quarry, woodcutter, sawmill, farm, mill, bakery,
  swine farm, butcher, vineyard, tannery, coal/iron/gold mines, iron smithy, metallurgist,
  weapons & armour workshops, weapon & armour smithies, stables, barracks, watchtower.
- **Citizens**: serfs carry wares along roads, labourers build roads, fields and houses,
  every house needs its own trained worker, and everybody gets hungry.
- **Army**: militia, axe fighters, sword fighters, bowmen, crossbowmen, lance carriers,
  pikemen, scouts and knights, equipped from recruits at the barracks. Groups with
  formations, halt/split/link, counters (pikes vs cavalry, cavalry vs archers), towers.
- **Campaign**: six missions with briefings, scripted enemy attacks and fortified enemy towns,
  plus a free-play map. Manual saves, an autosave every 30 seconds (also on refresh or tab close, resumed with Continue) and campaign progress are stored in the browser's localStorage.

## Controls

| Action | Input |
| --- | --- |
| Scroll | arrow keys, WASD, or mouse at the screen edge; shift-drag / middle-drag pans |
| Zoom | mouse wheel |
| Select | left click; drag a box to select soldiers |
| Order soldiers | right-click to move, right-click an enemy to attack |
| Build | Build tab, click a house, click on the map (shift-click to place several) |
| Roads / fields | R / F, then drag on the map |
| Cancel / deselect | right-click / Esc |
| Speed | 1 2 3 keys or the buttons; space pauses |
| Halt group | H |
| Sound / music | toggles in the Menu tab |

## Development

`scripts/` holds headless Playwright checks used during development
(`node scripts/allmissions.mjs` fast-forwards every mission and reports errors).
