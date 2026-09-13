"""Split generated 4x3 unit sheets (front/left/back/right rows x 3 walk frames) into
normalised sheets: 4 rows (down, left, up, right) x 3 frames, cell 64x96 at 2x resolution.
usage: python3 scripts/process-units.py <dir with <type>-nobg.png>
"""
import os, sys
from PIL import Image

SRC = sys.argv[1]
OUT = 'public/art/sprites'; os.makedirs(OUT, exist_ok=True)
CELL_W, CELL_H = 64, 96
MOUNTED = {'scout', 'knight'}

def runs(flags, min_len):
    out = []; start = None
    for i, f in enumerate(list(flags) + [False]):
        if f and start is None: start = i
        if not f and start is not None:
            if i - start >= min_len: out.append((start, i))
            start = None
    return out

def split_sheet(im):
    a = im.getchannel('A').point(lambda v: 255 if v > 30 else 0)
    w, h = im.size
    rows_flag = [a.crop((0, y, w, y + 1)).getbbox() is not None for y in range(h)]
    rows = runs(rows_flag, 20)
    # merge rows separated by tiny gaps (weapons sticking out)
    merged = []
    for r in rows:
        if merged and r[0] - merged[-1][1] < 12: merged[-1] = (merged[-1][0], r[1])
        else: merged.append(r)
    rows = merged
    if len(rows) != 4:  # fall back to equal quarters
        rows = [(int(h * i / 4), int(h * (i + 1) / 4)) for i in range(4)]
    cells = []
    for (y0, y1) in rows:
        band = a.crop((0, y0, w, y1))
        cols_flag = [band.crop((x, 0, x + 1, y1 - y0)).getbbox() is not None for x in range(w)]
        cols = runs(cols_flag, 12)
        m2 = []
        for c in cols:
            if m2 and c[0] - m2[-1][1] < 10: m2[-1] = (m2[-1][0], c[1])
            else: m2.append(c)
        cols = m2
        if len(cols) != 3: cols = [(int(w * i / 3), int(w * (i + 1) / 3)) for i in range(3)]
        row = []
        for (x0, x1) in cols:
            cell = im.crop((x0, y0, x1, y1))
            bb = cell.getchannel('A').point(lambda v: 255 if v > 30 else 0).getbbox()
            row.append(cell.crop(bb) if bb else cell)
        cells.append(row)
    return cells

def process(name):
    src = f'{SRC}/{name}-nobg.png'
    if not os.path.exists(src) or os.path.getsize(src) < 5000: print('MISSING', name); return
    im = Image.open(src).convert('RGBA')
    cells = split_sheet(im)
    # normalise: scale so the tallest frame of the sheet is target height
    target_h = (CELL_H - 8) if name not in MOUNTED else (CELL_H - 4)
    max_h = max(c.height for row in cells for c in row)
    scale = target_h / max_h
    sheet = Image.new('RGBA', (CELL_W * 3, CELL_H * 4), (0, 0, 0, 0))
    # our row order: down(front)=src row 0, left = mirrored src row 3 (right), up(back)=src row 2, right = src row 3
    order = [(0, False), (3, True), (2, False), (3, False)]
    for r, (srow, mirror) in enumerate(order):
        for f in range(3):
            c = cells[srow][f]
            c = c.resize((max(1, int(c.width * scale)), max(1, int(c.height * scale))), Image.LANCZOS)
            if c.width > CELL_W: c = c.resize((CELL_W, max(1, int(c.height * CELL_W / c.width))), Image.LANCZOS)
            if mirror: c = c.transpose(Image.FLIP_LEFT_RIGHT)
            x = f * CELL_W + (CELL_W - c.width) // 2
            y = r * CELL_H + CELL_H - c.height - 2
            sheet.alpha_composite(c, (x, y))
    sheet.save(f'{OUT}/unit-{name}.webp', quality=92, method=6)
    print('unit', name, 'rows', len(cells), 'scale %.2f' % scale)

names = sys.argv[2:] or [f[:-9] for f in os.listdir(SRC) if f.endswith('-nobg.png')]
for n in names: process(n)
