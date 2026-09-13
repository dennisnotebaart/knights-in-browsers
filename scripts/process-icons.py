"""Split the generated 4x7 ware icon sheet into public/art/sprites/ware-<name>.webp (32x32, alpha)."""
import sys
from PIL import Image
from collections import deque
src = sys.argv[1]
ORDER = ['trunk', 'stone', 'wood', 'ironOre', 'goldOre', 'coal', 'steel', 'gold', 'wine', 'corn', 'flour', 'bread', 'pig', 'skin',
         'leather', 'sausage', 'horse', 'shield', 'leatherArmor', 'axe', 'sword', 'bow', 'crossbow', 'lance', 'pike', 'ironShield', 'ironArmor', 'banner']
im = Image.open(src).convert('RGBA'); w, h = im.size; px = im.load()
# flood-fill white background from the border
seen = bytearray(w * h); q = deque()
for x in range(w): q.append((x, 0)); q.append((x, h - 1))
for y in range(h): q.append((0, y)); q.append((w - 1, y))
while q:
    x, y = q.popleft()
    if x < 0 or y < 0 or x >= w or y >= h or seen[y * w + x]: continue
    seen[y * w + x] = 1
    p = px[x, y]
    if not (p[0] > 228 and p[1] > 228 and p[2] > 228): continue
    px[x, y] = (255, 255, 255, 0)
    q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
cw, ch = w / 7, h / 4
n = 0
for r in range(4):
    for c in range(7):
        cell = im.crop((int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch)))
        bb = cell.getchannel('A').point(lambda v: 255 if v > 30 else 0).getbbox()
        if bb: cell = cell.crop(bb)
        size = max(cell.width, cell.height)
        sq = Image.new('RGBA', (size, size), (0, 0, 0, 0)); sq.alpha_composite(cell, ((size - cell.width) // 2, (size - cell.height) // 2))
        sq = sq.resize((32, 32), Image.LANCZOS)
        sq.save(f'public/art/sprites/ware-{ORDER[n]}.webp', quality=92, method=6)
        n += 1
print('icons', n)
