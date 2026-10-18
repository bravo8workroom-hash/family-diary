# Satellite maps for the fishing point map (fishmap/) — Naver map captured headless at a known centre/zoom,
# UI chrome cropped off, and the crop's corner lat/lng saved so a phone GPS fix lands on the right pixel.
# Usage: python -X utf8 -I tools/위성지도.py            (all areas)   ·   python -X utf8 -I tools/위성지도.py 동호
# Calibration (2026-10-18): Naver zoom N renders like Web Mercator zoom N+1 (256px tiles); in a WxH headless
# window the map centre is NOT the window centre — it is measured here by capturing zoom N and N+1 at the same
# centre and finding the fixed point (template match). Verified on 4 known street-view coordinates (all on roads).
# Map imagery © NAVER Corp. / 국토지리정보원 — shown with that credit, family use.
import os, sys, json, math, subprocess, tempfile
import numpy as np
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'fishmap', 'maps'); os.makedirs(OUT, exist_ok=True)
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
W, H = 1400, 1800
CROP = (470, 100, 1320, H - 300)        # left panel / top chips / right tools / bottom-right ad cut away
AREAS = {   # key: (title, lng, lat, naver zoom)
    '사천진-북': ('사천진 북쪽 — 하평·사천진해변·바위섬', 128.8705, 37.8445, 16),
    '사천진-남': ('사천진 남쪽 — 항구·작은방파제·사천해변', 128.8770, 37.8320, 16),
    '동호': ('동호해변', 128.6835, 38.0570, 16),
    '물치': ('물치항·물치해변', 128.6085, 38.1545, 16),
    '지경': ('지경해변', 128.8065, 37.9185, 16),
}

def shot(lng, lat, z, path):
    url = f'https://map.naver.com/p?c={lng},{lat},{z},0,0,1,dh'
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=15000',
                    f'--window-size={W},{H}', f'--screenshot={path}', url], capture_output=True, timeout=120)
    return Image.open(path).convert('RGB')

def centre(lng, lat, z):
    tmp = tempfile.gettempdir()
    a = np.asarray(shot(lng, lat, z, os.path.join(tmp, 'm_a.png')).convert('L'), dtype=np.float32)
    b = shot(lng, lat, z + 1, os.path.join(tmp, 'm_b.png')).convert('L').resize((W // 2, H // 2), Image.LANCZOS)
    b = np.asarray(b, dtype=np.float32)
    ty, tx = H // 4 - 100, W // 4 - 100
    T = b[ty:ty + 180, tx:tx + 240]; T = (T - T.mean()) / T.std()
    best = (-9, 0, 0)
    for y in range(0, a.shape[0] - 180, 2):
        for x in range(470, a.shape[1] - 240, 2):
            P = a[y:y + 180, x:x + 240]; s = P.std()
            if s < 1: continue
            v = float(((P - P.mean()) / s * T).mean())
            if v > best[0]: best = (v, x, y)
    v, x, y = best
    return 2 * (x - tx), 2 * (y - ty), v

def merc(lng, lat, z):
    n = 256 * 2 ** z; s = math.sin(math.radians(lat))
    return (lng + 180) / 360 * n, (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n

def unmerc(x, y, z):
    n = 256 * 2 ** z; lng = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n)))); return lng, lat

meta_p = os.path.join(OUT, 'maps.json')
meta = json.load(open(meta_p, encoding='utf-8')) if os.path.exists(meta_p) else {}
only = sys.argv[1:]
for key, (title, lng, lat, z) in AREAS.items():
    if only and not any(o in key for o in only): continue
    cx, cy, score = centre(lng, lat, z)
    im = shot(lng, lat, z, os.path.join(tempfile.gettempdir(), 'm_a.png'))
    zz = z + 1                                    # Naver zoom -> Web Mercator zoom
    mx, my = merc(lng, lat, zz)
    x0, y0, x1, y1 = CROP
    nw = unmerc(mx + (x0 - cx), my + (y0 - cy), zz); se = unmerc(mx + (x1 - cx), my + (y1 - cy), zz)
    im.crop(CROP).save(os.path.join(OUT, key + '.jpg'), quality=82)
    meta[key] = {'title': title, 'img': key + '.jpg', 'w': x1 - x0, 'h': y1 - y0, 'zoom': zz,
                 'nw': [round(nw[0], 7), round(nw[1], 7)], 'se': [round(se[0], 7), round(se[1], 7)],
                 'centrePx': [cx, cy], 'match': round(score, 3), 'credit': '© NAVER Corp. · 국토지리정보원'}
    print(key, 'centre', (cx, cy), 'match', round(score, 3), 'nw', meta[key]['nw'], 'se', meta[key]['se'])
json.dump(meta, open(meta_p, 'w', encoding='utf-8', newline=''), ensure_ascii=False, indent=1)
