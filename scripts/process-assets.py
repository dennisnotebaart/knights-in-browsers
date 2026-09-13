"""Turn generated Imagine.art images into game assets.
usage: python3 scripts/process-assets.py <gen dir>
Expects <gen>/<texture>.png, <gen>/h/<house>-nobg.png, <gen>/<tree>-nobg.png, <gen>/h/objects-nobg.png
Writes public/art/tex/*.webp and public/art/sprites/*.webp
"""
import os, sys
from PIL import Image, ImageFilter, ImageDraw

G = sys.argv[1]
OUT_TEX = 'public/art/tex'; OUT_SPR = 'public/art/sprites'
os.makedirs(OUT_TEX, exist_ok=True); os.makedirs(OUT_SPR, exist_ok=True)

TILE = 40

def seamless(im, band=48):
    """Soften the wrap seam: crossfade a band at the edges with the opposite edge."""
    im = im.convert('RGB')
    w, h = im.size
    shifted = Image.new('RGB', (w, h))
    shifted.paste(im.crop((w // 2, 0, w, h)), (0, 0)); shifted.paste(im.crop((0, 0, w // 2, h)), (w // 2, 0))
    top = Image.new('RGB', (w, h)); top.paste(shifted.crop((0, h // 2, w, h)), (0, 0)); top.paste(shifted.crop((0, 0, w, h // 2)), (0, h // 2))
    # mask: 1 near the original edges (where the seam of the shifted image lands in the middle... inverse)
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    for i in range(band):
        a = int(255 * (1 - i / band) ** 1.5)
        d.rectangle((i, i, w - 1 - i, h - 1 - i), outline=a)
    return Image.composite(top, im, mask)

def texture(name, size=512, out=None, quality=88):
    p = f'{G}/{name}.png'
    if not os.path.exists(p) or os.path.getsize(p) < 1000: print('skip texture', name); return
    im = Image.open(p).convert('RGB').resize((size, size), Image.LANCZOS)
    im = seamless(im)
    im.save(f'{OUT_TEX}/{out or name}.webp', quality=quality, method=6)
    print('tex', name, im.size)

for t in ['grass', 'dirt', 'sand', 'water', 'rock', 'road', 'cornyoung', 'cornripe', 'vine', 'wood', 'parchment']:
    texture(t, 256 if t in ("wood", "parchment") else 480)
if os.path.exists(f'{G}/plough.png') and os.path.getsize(f'{G}/plough.png') > 1000: texture('plough')

def sprite(src, out, width, extra_scale=1.0, trim=True):
    im = Image.open(src).convert('RGBA')
    if trim:
        # drop nearly transparent fringe, then crop
        a = im.getchannel('A').point(lambda v: 255 if v > 24 else 0)
        bb = a.getbbox()
        im = im.crop(bb)
    target = int(width * extra_scale)
    scale = target / im.width
    im = im.resize((target, max(1, int(im.height * scale))), Image.LANCZOS)
    im.save(f'{OUT_SPR}/{out}.webp', quality=92, method=6)
    print('spr', out, im.size)
    return im

# houses at 2x resolution (renderer draws them scaled down)
HOUSES = {  # name: (tiles wide, extra scale)
    'storehouse': (3, 1.2), 'school': (3, 1.1), 'inn': (3, 1.1), 'quarry': (2, 1.25), 'woodcutters': (2, 1.25), 'sawmill': (3, 1.1),
    'farm': (3, 1.15), 'mill': (2, 1.2), 'bakery': (2, 1.2), 'swineFarm': (3, 1.15), 'butchers': (2, 1.2), 'vineyard': (2, 1.25),
    'tannery': (2, 1.25), 'coalMine': (2, 1.35), 'ironMine': (2, 1.35), 'goldMine': (2, 1.35), 'ironSmithy': (2, 1.25), 'metallurgists': (2, 1.25),
    'weaponsWorkshop': (3, 1.1), 'armorWorkshop': (3, 1.1), 'weaponSmithy': (3, 1.1), 'armorSmithy': (3, 1.1), 'stables': (3, 1.15),
    'barracks': (3, 1.2), 'watchtower': (1, 1.6),
}
for name, (w, extra) in HOUSES.items():
    src = f'{G}/h/{name}-nobg.png'
    if not os.path.exists(src): src = f'{G}/{name}-nobg.png'
    if not os.path.exists(src) or os.path.getsize(src) < 1000: print('MISSING house', name); continue
    sprite(src, f'house-{name}', w * TILE * 2, extra)

for t in ['oak', 'pine', 'birch']:
    src = f'{G}/{t}-nobg.png'
    if os.path.exists(src) and os.path.getsize(src) > 1000: sprite(src, f'tree-{t}', TILE * 2 * 1.3)

# objects sheet: split into columns by alpha
src = f'{G}/h/objects-nobg.png'
if os.path.exists(src) and os.path.getsize(src) > 1000:
    im = Image.open(src).convert('RGBA')
    a = im.getchannel('A').point(lambda v: 255 if v > 24 else 0)
    cols = [any(a.getpixel((x, y)) for y in range(0, im.height, 2)) for x in range(im.width)]
    parts = []; start = None
    for x, c in enumerate(cols + [False]):
        if c and start is None: start = x
        if not c and start is not None:
            if x - start > 20: parts.append((start, x))
            start = None
    print('object parts', parts)
    names = ['stump', 'sapling', 'bush', 'boulder']
    for (x0, x1), n in zip(parts, names):
        part = im.crop((x0, 0, x1, im.height))
        bb = part.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox(); part = part.crop(bb)
        part.save('/tmp/_part.png')
        sprite('/tmp/_part.png', f'obj-{n}', TILE * 2 * (0.7 if n != 'sapling' else 0.5), trim=False)
print('done')
