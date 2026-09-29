"""
Generador de texturas procedurales para ECO DE ORIÓN.

Crea todas las texturas del juego (albedo, mapas normales y máscaras de
emisión) sin depender de recursos externos. Son "tileables" (se repiten sin
costuras) porque el ruido se filtra con mode="wrap".

Uso:
    python tools/generate_textures.py

Requisitos: numpy, scipy, pillow
Salida:     assets/textures/*.jpg | *.png   (licencia CC0 1.0)
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy.ndimage import gaussian_filter

OUT = Path(__file__).resolve().parent.parent / "assets" / "textures"
OUT.mkdir(parents=True, exist_ok=True)

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]


def font(size):
    for f in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


# ----------------------------------------------------------------- utilidades
def fbm(size, octaves, seed):
    """Ruido fractal tileable: suma de ruido blanco filtrado a varias escalas."""
    rng = np.random.default_rng(seed)
    acc = np.zeros((size, size), np.float32)
    total = 0.0
    for sigma, amp in octaves:
        n = gaussian_filter(rng.random((size, size)).astype(np.float32), sigma, mode="wrap")
        n = (n - n.min()) / (n.max() - n.min() + 1e-6)
        acc += n * amp
        total += amp
    return acc / total


def norm01(a):
    return (a - a.min()) / (a.max() - a.min() + 1e-6)


def lerp_color(c1, c2, t):
    c1 = np.array(c1, np.float32)
    c2 = np.array(c2, np.float32)
    return c1 + (c2 - c1) * t[..., None]


def normal_map(height, strength=4.0):
    """Mapa normal (convención OpenGL, la que usa Three.js) a partir de una altura."""
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(height)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / length, ny / length, nz / length], axis=-1)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8), "RGB")


def to_img(rgb):
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def save(img, name, quality=88):
    path = OUT / name
    if name.endswith(".png"):
        img.save(path, optimize=True)
    else:
        img.convert("RGB").save(path, quality=quality, optimize=True, progressive=True)
    print(f"  ✓ {name:28s} {path.stat().st_size / 1024:7.1f} KB")


def blobs(size, count, rmin, rmax, seed, power=0.6):
    """Máscara de manchas redondeadas (tileable por envoltura)."""
    rng = np.random.default_rng(seed)
    m = np.zeros((size, size), np.float32)
    yy, xx = np.mgrid[0:size, 0:size]
    for _ in range(count):
        cx, cy = rng.random(2) * size
        r = rng.uniform(rmin, rmax)
        dx = np.minimum(np.abs(xx - cx), size - np.abs(xx - cx))
        dy = np.minimum(np.abs(yy - cy), size - np.abs(yy - cy))
        d = np.sqrt(dx * dx + dy * dy)
        m = np.maximum(m, np.clip(1 - d / r, 0, 1) ** power * rng.uniform(0.5, 1.0))
    return m


def ridges(size, octaves, seed, width=60.0):
    """Líneas finas tipo grieta/vena a partir de los cruces por 0.5 del ruido."""
    n = fbm(size, octaves, seed)
    return np.clip(1 - np.abs(n - 0.5) * width, 0, 1)


# ----------------------------------------------------------------- selva
def jungle_ground():
    s = 1024
    base = fbm(s, [(60, 1.0), (22, 0.7), (7, 0.45), (2, 0.25)], 101)
    fine = fbm(s, [(1.2, 1.0)], 102)
    moss_mask = np.clip((fbm(s, [(40, 1.0), (12, 0.5)], 103) - 0.45) * 4, 0, 1)
    soil = lerp_color((34, 28, 22), (66, 52, 38), norm01(base * 0.8 + fine * 0.2))
    moss = lerp_color((24, 44, 30), (52, 86, 50), fbm(s, [(3, 1), (1, 0.5)], 104))
    rgb = soil * (1 - moss_mask[..., None]) + moss * moss_mask[..., None]
    # hojarasca: hojas alargadas dispersas
    img = to_img(rgb)
    dr = ImageDraw.Draw(img, "RGBA")
    rng = np.random.default_rng(105)
    for _ in range(1400):
        x, y = rng.random(2) * s
        a = rng.uniform(0, np.pi)
        L = rng.uniform(6, 16)
        w = L * rng.uniform(0.25, 0.4)
        col = [(88, 62, 34), (60, 72, 40), (40, 52, 30), (98, 80, 46)][rng.integers(0, 4)]
        pts = []
        for t in np.linspace(0, 2 * np.pi, 10):
            px = np.cos(t) * L / 2
            py = np.sin(t) * w / 2
            pts.append((x + px * np.cos(a) - py * np.sin(a), y + px * np.sin(a) + py * np.cos(a)))
        dr.polygon(pts, fill=(*col, 150))
    img = img.filter(ImageFilter.SMOOTH)
    arr = np.asarray(img, np.float32) * (0.85 + 0.3 * fine[..., None])
    save(to_img(arr), "jungle_ground_albedo.jpg")
    h = base * 0.6 + fine * 0.3 + moss_mask * 0.25 + np.asarray(img.convert("L"), np.float32) / 255 * 0.3
    save(normal_map(h, 6.0), "jungle_ground_normal.jpg", 92)


def alien_rock():
    s = 1024
    warp = fbm(s, [(50, 1.0), (16, 0.5)], 111)
    yy = np.mgrid[0:s, 0:s][0].astype(np.float32) / s
    strata = (yy + (warp - 0.5) * 0.18) * 6.0
    band = np.sin(strata * 2 * np.pi) * 0.5 + 0.5
    detail = fbm(s, [(10, 1.0), (3, 0.6), (1, 0.3)], 112)
    t = norm01(band * 0.45 + detail * 0.55)
    rgb = lerp_color((22, 26, 34), (74, 80, 92), t)
    veins = ridges(s, [(14, 1.0), (5, 0.35)], 113, 55)
    veins2 = ridges(s, [(30, 1.0), (8, 0.3)], 114, 80)
    v = np.clip(veins + veins2 * 0.7, 0, 1)
    rgb *= (1 - v[..., None] * 0.55)
    save(to_img(rgb), "alien_rock_albedo.jpg")
    h = band * 0.3 + detail * 0.6 - v * 0.6
    save(normal_map(h, 8.0), "alien_rock_normal.jpg", 92)
    glow = gaussian_filter(v, 1.2, mode="wrap")
    glow = np.clip(glow * 1.6, 0, 1) * (fbm(s, [(25, 1)], 115) > 0.42)
    save(Image.fromarray((glow * 255).astype(np.uint8), "L"), "alien_rock_veins.png")


def ruin_stone():
    s = 1024
    rows, cols = 4, 2
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    row_h = s / rows
    row = np.floor(yy / row_h)
    offset = (row % 2) * (s / cols / 2)
    col_w = s / cols
    lx = ((xx + offset) % col_w) / col_w
    ly = (yy % row_h) / row_h
    joint = np.clip(np.minimum(np.minimum(lx, 1 - lx) * col_w, np.minimum(ly, 1 - ly) * row_h) / 10.0, 0, 1)
    d = fbm(s, [(18, 1.0), (5, 0.6), (1.5, 0.4)], 121)
    block_id = (np.floor((xx + offset) / col_w) + row * 5) % 7
    tone = block_id / 7.0 * 0.25
    rgb = lerp_color((46, 44, 58), (104, 98, 116), np.clip(d * 0.8 + tone, 0, 1))
    rgb = rgb * joint[..., None] + np.array((18, 16, 24)) * (1 - joint[..., None])
    # glifos alienígenas grabados (una franja por bloque, en el 70 % de los bloques)
    img = to_img(rgb)
    glyph = Image.new("L", (s, s), 0)
    gd = ImageDraw.Draw(glyph)
    rng = np.random.default_rng(122)

    def draw_glyph(gx, gy, sz, kind):
        w = max(4, int(sz * 0.16))
        if kind == 0:
            gd.ellipse((gx - sz * 0.5, gy - sz * 0.5, gx + sz * 0.5, gy + sz * 0.5), outline=255, width=w)
            gd.line((gx, gy - sz * 0.8, gx, gy + sz * 0.8), fill=255, width=w)
        elif kind == 1:
            gd.polygon([(gx, gy - sz * 0.7), (gx + sz * 0.6, gy + sz * 0.45), (gx - sz * 0.6, gy + sz * 0.45)], outline=255, width=w)
            gd.ellipse((gx - w, gy - w * 0.2, gx + w, gy + w * 1.8), fill=255)
        elif kind == 2:
            gd.line((gx - sz * 0.5, gy - sz * 0.6, gx + sz * 0.5, gy + sz * 0.6), fill=255, width=w)
            gd.line((gx + sz * 0.5, gy - sz * 0.6, gx - sz * 0.5, gy + sz * 0.6), fill=255, width=w)
            gd.ellipse((gx - w * 1.4, gy - w * 1.4, gx + w * 1.4, gy + w * 1.4), fill=255)
        elif kind == 3:
            gd.rectangle((gx - sz * 0.45, gy - sz * 0.6, gx + sz * 0.45, gy + sz * 0.6), outline=255, width=w)
            gd.line((gx - sz * 0.45, gy, gx + sz * 0.45, gy), fill=255, width=w)
        else:
            gd.arc((gx - sz * 0.6, gy - sz * 0.6, gx + sz * 0.6, gy + sz * 0.6), 200, 520, fill=255, width=w)
            gd.line((gx - sz * 0.6, gy + sz * 0.6, gx + sz * 0.6, gy + sz * 0.6), fill=255, width=w)

    for r in range(rows):
        for c in range(-1, cols + 1):
            if rng.random() < 0.3:
                continue
            left = c * col_w - (r % 2) * col_w / 2
            cy = r * row_h + row_h / 2
            n = rng.integers(4, 7)
            sz = rng.uniform(46, 62)
            span = (n - 1) * sz * 1.35
            x0 = left + col_w / 2 - span / 2
            for k in range(n):
                draw_glyph(x0 + k * sz * 1.35, cy, sz, int(rng.integers(0, 5)))
            gd.line((x0 - sz, cy + sz, x0 + span + sz, cy + sz), fill=255, width=5)
    g = np.asarray(glyph, np.float32) / 255.0
    arr = np.asarray(img, np.float32) * (1 - g[..., None] * 0.5)
    save(to_img(arr), "ruin_stone_albedo.jpg")
    h = joint * 0.9 + d * 0.4 - g * 0.5
    save(normal_map(h, 6.0), "ruin_stone_normal.jpg", 92)
    save(Image.fromarray((gaussian_filter(g, 1.5) * 255).astype(np.uint8), "L"), "ruin_glyphs.png")


def bark():
    s = 512
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    warp = fbm(s, [(30, 1.0), (8, 0.4)], 131)
    rng = np.random.default_rng(132)
    streak = norm01(gaussian_filter(rng.random((s, s)).astype(np.float32), (28, 1.2), mode="wrap"))
    fib = np.sin(xx * 0.09 + warp * 7) * 0.5 + 0.5
    t = np.clip(fib * 0.5 + streak * 0.5, 0, 1)
    rgb = lerp_color((20, 18, 22), (62, 54, 60), t)
    grooves = np.clip(1 - np.abs(((xx + warp * 60) % 42) / 42 - 0.5) * 9, 0, 1)
    rgb *= (1 - grooves[..., None] * 0.5)
    save(to_img(rgb), "bark_albedo.jpg")
    save(normal_map(t * 0.6 - grooves * 0.8, 6.0), "bark_normal.jpg", 92)


def metal_panel():
    s = 512
    d = fbm(s, [(20, 1.0), (5, 0.5), (1.5, 0.35)], 141)
    rgb = lerp_color((70, 76, 82), (122, 128, 134), d)
    img = to_img(rgb)
    dr = ImageDraw.Draw(img, "RGBA")
    # juntas de paneles
    for x in (0, 256):
        dr.line((x, 0, x, s), fill=(26, 28, 30, 255), width=5)
    for y in (0, 170, 340):
        dr.line((0, y, s, y), fill=(26, 28, 30, 255), width=5)
    rng = np.random.default_rng(142)
    for x0 in (0, 256):
        for y0 in (0, 170, 340):
            for cx, cy in [(x0 + 14, y0 + 14), (x0 + 242, y0 + 14), (x0 + 14, y0 + 156), (x0 + 242, y0 + 156)]:
                dr.ellipse((cx - 4, cy - 4, cx + 4, cy + 4), fill=(48, 50, 54, 255))
    for _ in range(140):
        x, y = rng.random(2) * s
        a = rng.uniform(0, np.pi)
        L = rng.uniform(8, 40)
        dr.line((x, y, x + np.cos(a) * L, y + np.sin(a) * L), fill=(200, 205, 210, 45), width=1)
    # franja de advertencia y esténcil
    for i in range(-2, 12):
        x0 = i * 44
        dr.polygon([(x0, 470), (x0 + 22, 470), (x0 + 22 + 30, 440), (x0 + 30, 440)], fill=(232, 150, 40, 235))
    dr.rectangle((0, 440, s, 470), outline=(20, 20, 20, 255), width=3)
    dr.text((128, 250), "EXP-ORIÓN", font=font(34), fill=(30, 32, 36, 170), anchor="mm")
    dr.text((384, 250), "07", font=font(60), fill=(30, 32, 36, 150), anchor="mm")
    save(img, "metal_panel_albedo.jpg")
    g = np.asarray(img.convert("L"), np.float32) / 255.0
    save(normal_map(gaussian_filter(g, 1.0), 3.5), "metal_panel_normal.jpg", 92)


def crate_military():
    s = 512
    d = fbm(s, [(16, 1.0), (4, 0.5), (1, 0.3)], 151)
    rgb = lerp_color((56, 62, 50), (92, 100, 80), d)
    img = to_img(rgb)
    dr = ImageDraw.Draw(img, "RGBA")
    frame = 40
    dark = (32, 36, 30, 255)
    for rect in [(0, 0, s, frame), (0, s - frame, s, s), (0, 0, frame, s), (s - frame, 0, s, s)]:
        dr.rectangle(rect, fill=(70, 76, 64, 255))
    dr.rectangle((0, 0, s - 1, s - 1), outline=dark, width=6)
    dr.rectangle((frame, frame, s - frame, s - frame), outline=dark, width=4)
    for (x0, y0) in [(0, 0), (s - 90, 0), (0, s - 90), (s - 90, s - 90)]:
        for i in range(3):
            dr.line((x0 + i * 30, y0 + 90, x0 + 90, y0 + i * 30), fill=(230, 140, 40, 220), width=9)
    dr.text((s / 2, s / 2 - 36), "VANGUARDIA", font=font(44), fill=(26, 30, 24, 180), anchor="mm")
    dr.text((s / 2, s / 2 + 22), "SUMINISTROS", font=font(30), fill=(26, 30, 24, 170), anchor="mm")
    dr.text((s / 2, s / 2 + 70), "EXP · ORIÓN", font=font(24), fill=(210, 130, 40, 190), anchor="mm")
    save(img, "crate_military_albedo.jpg")
    g = np.asarray(img.convert("L"), np.float32) / 255.0
    save(normal_map(gaussian_filter(g, 1.2), 3.5), "crate_military_normal.jpg", 92)


def canister():
    s = 512
    d = fbm(s, [(14, 1.0), (3, 0.5), (1, 0.3)], 161)
    rgb = lerp_color((176, 182, 188), (222, 226, 230), d)
    yy = np.mgrid[0:s, 0:s][0].astype(np.float32) / s
    ribs = np.clip(1 - np.abs(((yy * 4) % 1) - 0.5) * 26, 0, 1)
    rgb *= (1 - ribs[..., None] * 0.28)
    img = to_img(rgb)
    dr = ImageDraw.Draw(img, "RGBA")
    dr.rectangle((0, 190, s, 320), fill=(236, 120, 30, 255))
    for i in range(-2, 22):
        x0 = i * 30
        dr.polygon([(x0, 320), (x0 + 15, 320), (x0 + 45, 290), (x0 + 30, 290)], fill=(22, 22, 24, 255))
    for cx in (s * 0.25, s * 0.75):
        dr.text((cx, 225), "PLASMA", font=font(40), fill=(24, 24, 26, 255), anchor="mm")
        dr.text((cx, 262), "INESTABLE", font=font(22), fill=(24, 24, 26, 255), anchor="mm")
    for (y0, y1) in [(0, 30), (s - 30, s)]:
        dr.rectangle((0, y0, s, y1), fill=(52, 56, 62, 255))
    save(img, "canister_albedo.jpg")


def fern():
    s = 512
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    rng = np.random.default_rng(171)
    dots = []
    for k, ang in enumerate([-0.8, -0.4, 0.0, 0.38, 0.75]):
        bx, by = s / 2, s - 4
        L = s * (0.95 - abs(ang) * 0.35)
        pts = []
        for t in np.linspace(0, 1, 48):
            bend = ang + np.sign(ang) * t * t * 0.6
            x = bx + np.sin(bend) * L * t
            y = by - np.cos(bend) * L * t
            pts.append((x, y, bend, t))
        for i in range(3, len(pts) - 1):
            x, y, bend, t = pts[i]
            leaf = (1 - t) * 58 + 12
            col = (int(22 + 40 * t), int(92 + 100 * t), int(78 + 70 * t), 255)
            for side in (-1, 1):
                a = bend + side * 1.35
                ex = x + np.sin(a) * leaf
                ey = y - np.cos(a) * leaf
                nx = x + np.sin(bend) * 9
                ny = y - np.cos(bend) * 9
                dr.polygon([(x, y), (ex, ey), (nx, ny)], fill=col)
                if i % 7 == 0:
                    dots.append((ex, ey))
        for i in range(len(pts) - 1):
            dr.line((pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]), fill=(30, 70, 55, 255), width=5)
    img = img.filter(ImageFilter.SMOOTH)
    dr = ImageDraw.Draw(img)
    for (x, y) in dots:
        dr.ellipse((x - 5, y - 5, x + 5, y + 5), fill=(170, 255, 235, 255))
    save(img, "fern.png")


def grass():
    s = 256
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    rng = np.random.default_rng(181)
    for _ in range(38):
        x = rng.uniform(20, s - 20)
        h = rng.uniform(s * 0.4, s * 0.98)
        lean = rng.uniform(-30, 30)
        col = (int(rng.uniform(25, 50)), int(rng.uniform(70, 120)), int(rng.uniform(60, 95)), 255)
        dr.polygon([(x - 4, s), (x + 4, s), (x + lean, s - h)], fill=col)
    save(img, "grass.png")


if __name__ == "__main__":
    print("Generando texturas en", OUT)
    jungle_ground()
    alien_rock()
    ruin_stone()
    bark()
    metal_panel()
    crate_military()
    canister()
    fern()
    grass()
    print("Listo.")
