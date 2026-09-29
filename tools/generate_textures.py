"""
Generador de texturas procedurales para VETA AIROSA.

Crea todas las texturas del juego (albedo + mapas normales) sin depender de
recursos externos. Todas las texturas son "tileables" (se repiten sin costuras)
porque el ruido se filtra con mode="wrap".

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


def speckles(size, count, rmin, rmax, seed):
    """Máscara de piedritas/manchas redondeadas (tileable por envoltura)."""
    rng = np.random.default_rng(seed)
    m = np.zeros((size, size), np.float32)
    yy, xx = np.mgrid[0:size, 0:size]
    for _ in range(count):
        cx, cy = rng.random(2) * size
        r = rng.uniform(rmin, rmax)
        dx = np.minimum(np.abs(xx - cx), size - np.abs(xx - cx))
        dy = np.minimum(np.abs(yy - cy), size - np.abs(yy - cy))
        d = np.sqrt(dx * dx + dy * dy)
        m = np.maximum(m, np.clip(1 - d / r, 0, 1) ** 0.6 * rng.uniform(0.5, 1.0))
    return m


# ----------------------------------------------------------------- texturas
def ground():
    s = 1024
    base = fbm(s, [(64, 1.0), (24, 0.7), (8, 0.45), (2, 0.25)], 11)
    fine = fbm(s, [(1.2, 1.0)], 12)
    pebbles = speckles(s, 900, 2, 7, 13)
    cracks_n = fbm(s, [(18, 1.0), (6, 0.4)], 14)
    cracks = np.clip(1 - np.abs(cracks_n - 0.5) * 60, 0, 1) * (fbm(s, [(40, 1)], 15) > 0.5)
    t = norm01(base * 0.8 + fine * 0.2)
    rgb = lerp_color((140, 94, 58), (201, 152, 101), t)
    rgb = rgb * (0.9 + 0.2 * fine[..., None])
    peb_col = lerp_color((96, 78, 64), (214, 196, 170), fbm(s, [(3, 1)], 16))
    rgb = rgb * (1 - pebbles[..., None] * 0.85) + peb_col * pebbles[..., None] * 0.85
    rgb *= (1 - cracks[..., None] * 0.45)
    save(to_img(rgb), "ground_albedo.jpg")
    h = base * 0.6 + fine * 0.3 + pebbles * 0.9 - cracks * 0.5
    save(normal_map(h, 7.0), "ground_normal.jpg", 92)


def rock():
    s = 1024
    warp = fbm(s, [(48, 1.0), (16, 0.5)], 21)
    yy = np.mgrid[0:s, 0:s][0].astype(np.float32) / s
    strata = (yy + (warp - 0.5) * 0.12) * 9.0          # 9 capas por repetición (tileable)
    band = np.sin(strata * 2 * np.pi) * 0.5 + 0.5
    band2 = np.sin(strata * 2 * np.pi * 3.0 + 1.3) * 0.5 + 0.5
    detail = fbm(s, [(10, 1.0), (3, 0.6), (1, 0.3)], 22)
    palette_t = norm01(band * 0.6 + band2 * 0.25 + detail * 0.35)
    c_dark = (104, 64, 44)
    c_mid = (168, 108, 70)
    c_light = (214, 176, 132)
    rgb = np.where(palette_t[..., None] < 0.5,
                   lerp_color(c_dark, c_mid, np.clip(palette_t * 2, 0, 1)),
                   lerp_color(c_mid, c_light, np.clip(palette_t * 2 - 1, 0, 1)))
    crack_n = fbm(s, [(12, 1.0), (4, 0.3)], 23)
    cracks = np.clip(1 - np.abs(crack_n - 0.5) * 45, 0, 1)
    rgb *= (1 - cracks[..., None] * 0.5)
    rgb *= (0.85 + 0.3 * detail[..., None])
    save(to_img(rgb), "rock_albedo.jpg")
    h = band * 0.5 + band2 * 0.2 + detail * 0.6 - cracks * 0.6
    save(normal_map(h, 9.0), "rock_normal.jpg", 92)


def stone_block():
    s = 512
    d = fbm(s, [(20, 1.0), (6, 0.6), (1.5, 0.5)], 31)
    chips = speckles(s, 160, 1.5, 4, 32)
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32) / s
    edge = np.minimum(np.minimum(xx, 1 - xx), np.minimum(yy, 1 - yy))
    bevel = np.clip(edge / 0.06, 0, 1)
    rgb = lerp_color((122, 116, 106), (190, 182, 166), d)
    rgb *= (0.55 + 0.45 * bevel[..., None])
    rgb *= (1 - chips[..., None] * 0.35)
    save(to_img(rgb), "stone_albedo.jpg")
    h = d * 0.5 + bevel * 1.2 - chips * 0.4
    save(normal_map(h, 6.0), "stone_normal.jpg", 92)


def stone_wall():
    s = 512
    rows = 6
    cols = 3
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    row_h = s / rows
    row = np.floor(yy / row_h)
    offset = (row % 2) * (s / cols / 2)
    col_w = s / cols
    lx = ((xx + offset) % col_w) / col_w
    ly = (yy % row_h) / row_h
    mortar = np.minimum(np.minimum(lx, 1 - lx) * col_w, np.minimum(ly, 1 - ly) * row_h)
    joint = np.clip(mortar / 7.0, 0, 1)
    block_id = (np.floor((xx + offset) / col_w) + row * 7) % 11
    tone = (block_id / 11.0) * 0.35
    d = fbm(s, [(12, 1.0), (3, 0.6), (1, 0.4)], 41)
    rgb = lerp_color((110, 96, 84), (186, 166, 140), np.clip(d * 0.8 + tone, 0, 1))
    mortar_col = np.array((78, 70, 62), np.float32)
    rgb = rgb * joint[..., None] + mortar_col * (1 - joint[..., None])
    save(to_img(rgb), "stonewall_albedo.jpg")
    h = joint * 1.0 + d * 0.4
    save(normal_map(h, 5.0), "stonewall_normal.jpg", 92)


def wood():
    s = 512
    planks = 4
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    pw = s / planks
    pid = np.floor(xx / pw)
    lx = (xx % pw) / pw
    warp = fbm(s, [(40, 1.0), (12, 0.4)], 51)
    grain = np.sin(xx * 0.55 + warp * 5.0 + pid * 3.7 + np.sin(yy * 0.012 + pid) * 1.2) * 0.5 + 0.5
    grain = grain ** 2.2
    rng = np.random.default_rng(52)
    streak = gaussian_filter(rng.random((s, s)).astype(np.float32), (24, 0.8), mode="wrap")
    fine = norm01(streak)
    tone = ((pid * 37) % 5) / 5.0 * 0.25
    t = np.clip(grain * 0.55 + fine * 0.25 + tone, 0, 1)
    rgb = lerp_color((92, 60, 36), (170, 120, 76), t)
    gap = np.clip(np.minimum(lx, 1 - lx) * pw / 3.0, 0, 1)
    rgb *= (0.35 + 0.65 * gap[..., None])
    # clavos
    nails = np.zeros((s, s), np.float32)
    for p in range(planks):
        for ny in (0.12, 0.88):
            cx = (p + 0.5) * pw
            cy = ny * s
            dd = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
            nails = np.maximum(nails, np.clip(1 - dd / 5.0, 0, 1))
    rgb = rgb * (1 - nails[..., None]) + np.array((60, 58, 56)) * nails[..., None]
    save(to_img(rgb), "wood_albedo.jpg")
    h = grain * 0.4 + gap * 1.0 + nails * 0.5
    save(normal_map(h, 5.0), "wood_normal.jpg", 92)


def crate():
    s = 512
    base = Image.open(OUT / "wood_albedo.jpg").resize((s, s))
    img = base.copy()
    dr = ImageDraw.Draw(img, "RGBA")
    frame = 46
    dark = (72, 46, 26, 255)
    light = (150, 104, 62, 255)
    # marco
    for rect in [(0, 0, s, frame), (0, s - frame, s, s), (0, 0, frame, s), (s - frame, 0, s, s)]:
        dr.rectangle(rect, fill=light)
    dr.rectangle((0, 0, s - 1, s - 1), outline=dark, width=6)
    dr.rectangle((frame, frame, s - frame, s - frame), outline=dark, width=5)
    # travesaño diagonal
    dr.line((frame, s - frame, s - frame, frame), fill=light, width=52)
    dr.line((frame + 6, s - frame - 30, s - frame - 30, frame + 6), fill=dark, width=4)
    dr.line((frame + 30, s - frame - 6, s - frame - 6, frame + 30), fill=dark, width=4)
    # esténcil
    f = font(40)
    dr.text((s / 2, s / 2 + 70), "CERRO AIROSO", font=f, fill=(40, 24, 14, 150), anchor="mm")
    dr.text((s / 2, s / 2 - 70), "FRÁGIL", font=font(34), fill=(120, 30, 20, 150), anchor="mm")
    # clavos en esquinas
    for cx, cy in [(23, 23), (s - 23, 23), (23, s - 23), (s - 23, s - 23)]:
        dr.ellipse((cx - 7, cy - 7, cx + 7, cy + 7), fill=(58, 56, 54, 255))
    save(img.filter(ImageFilter.SMOOTH), "crate_albedo.jpg")
    g = np.asarray(img.convert("L"), np.float32) / 255.0
    save(normal_map(gaussian_filter(g, 1.2), 4.0), "crate_normal.jpg", 92)


def supply_crate():
    s = 512
    d = fbm(s, [(18, 1.0), (4, 0.5), (1, 0.3)], 61)
    rgb = lerp_color((34, 72, 78), (58, 108, 112), d)
    img = to_img(rgb)
    dr = ImageDraw.Draw(img, "RGBA")
    dr.rectangle((0, 0, s - 1, s - 1), outline=(20, 30, 32, 255), width=18)
    # franja de peligro
    band_y0, band_y1 = 330, 410
    for i in range(-4, 16):
        x0 = i * 48
        dr.polygon([(x0, band_y1), (x0 + 24, band_y1), (x0 + 24 + 80, band_y0), (x0 + 80, band_y0)],
                   fill=(245, 190, 40, 255))
    dr.rectangle((0, band_y0, s, band_y1), outline=(20, 20, 20, 255), width=4)
    # icono de batería
    cx, cy = s // 2, 170
    dr.rounded_rectangle((cx - 90, cy - 55, cx + 80, cy + 55), radius=14, outline=(235, 240, 230, 255), width=12)
    dr.rectangle((cx + 80, cy - 22, cx + 100, cy + 22), fill=(235, 240, 230, 255))
    dr.polygon([(cx - 5, cy - 45), (cx - 40, cy + 8), (cx - 8, cy + 8), (cx - 20, cy + 45), (cx + 30, cy - 12),
                (cx - 2, cy - 12), (cx + 10, cy - 45)], fill=(120, 255, 170, 255))
    dr.text((s / 2, 275), "ENERGÍA", font=font(46), fill=(235, 240, 230, 230), anchor="mm")
    for cx2, cy2 in [(30, 30), (s - 30, 30), (30, s - 30), (s - 30, s - 30)]:
        dr.ellipse((cx2 - 9, cy2 - 9, cx2 + 9, cy2 + 9), fill=(150, 160, 160, 255))
    save(img, "supply_albedo.jpg")


def barrel():
    s = 512
    d = fbm(s, [(14, 1.0), (3, 0.5), (1, 0.3)], 71)
    rgb = lerp_color((120, 22, 18), (178, 40, 30), d)
    yy = np.mgrid[0:s, 0:s][0].astype(np.float32) / s
    ribs = np.clip(1 - np.abs(((yy * 3) % 1) - 0.5) * 30, 0, 1)
    rgb *= (1 - ribs[..., None] * 0.35)
    rust = np.clip((fbm(s, [(6, 1), (2, 0.5)], 72) - 0.62) * 6, 0, 1)
    rgb = rgb * (1 - rust[..., None]) + np.array((96, 56, 30)) * rust[..., None]
    img = to_img(rgb)
    dr = ImageDraw.Draw(img, "RGBA")
    # franjas de peligro superior e inferior
    for (y0, y1) in [(0, 48), (s - 48, s)]:
        dr.rectangle((0, y0, s, y1), fill=(20, 20, 20, 255))
        for i in range(-2, 24):
            x0 = i * 32
            dr.polygon([(x0, y1), (x0 + 16, y1), (x0 + 16 + 48, y0), (x0 + 48, y0)], fill=(250, 196, 30, 255))
    # etiquetas (dos alrededor del barril)
    for cx in (s * 0.25, s * 0.75):
        dr.rounded_rectangle((cx - 92, 150, cx + 92, 362), radius=10, fill=(240, 236, 222, 245),
                             outline=(30, 30, 30, 255), width=5)
        dr.polygon([(cx, 170), (cx - 46, 250), (cx + 46, 250)], fill=(250, 196, 30, 255), outline=(20, 20, 20, 255))
        dr.text((cx, 228), "!", font=font(56), fill=(20, 20, 20, 255), anchor="mm")
        dr.text((cx, 292), "PELIGRO", font=font(34), fill=(160, 20, 16, 255), anchor="mm")
        dr.text((cx, 332), "EXPLOSIVO", font=font(24), fill=(30, 30, 30, 255), anchor="mm")
    save(img, "barrel_albedo.jpg")


def metal():
    s = 512
    d = fbm(s, [(22, 1.0), (6, 0.5), (1.5, 0.4)], 81)
    rgb = lerp_color((58, 62, 66), (104, 110, 116), d)
    rust_n = fbm(s, [(10, 1.0), (3, 0.6), (1, 0.3)], 82)
    rust = np.clip((rust_n - 0.5) * 5, 0, 1)
    rust_col = lerp_color((110, 52, 24), (170, 92, 44), fbm(s, [(2, 1)], 83))
    rgb = rgb * (1 - rust[..., None]) + rust_col * rust[..., None]
    scratches = np.zeros((s, s), np.float32)
    rng = np.random.default_rng(84)
    img = to_img(rgb)
    dr = ImageDraw.Draw(img, "RGBA")
    for _ in range(90):
        x, y = rng.random(2) * s
        a = rng.uniform(0, np.pi)
        L = rng.uniform(10, 50)
        dr.line((x, y, x + np.cos(a) * L, y + np.sin(a) * L), fill=(190, 190, 185, 60), width=1)
    save(img, "metal_albedo.jpg")
    h = d * 0.4 + rust * 0.5 + scratches
    save(normal_map(h, 4.0), "metal_normal.jpg", 92)


def sign(name, lines, bg=(245, 190, 40), fg=(24, 20, 16), icon=True):
    w, h = 512, 256
    img = Image.new("RGB", (w, h), bg)
    dr = ImageDraw.Draw(img)
    dr.rectangle((0, 0, w - 1, h - 1), outline=fg, width=14)
    dr.rectangle((20, 20, w - 21, h - 21), outline=fg, width=3)
    x_text = w / 2
    if icon:
        dr.polygon([(90, 60), (40, 170), (140, 170)], fill=fg)
        dr.polygon([(90, 80), (56, 158), (124, 158)], fill=bg)
        dr.text((90, 132), "!", font=font(58), fill=fg, anchor="mm")
        x_text = w / 2 + 50
    sizes = [52, 34, 28]
    y = 80 if len(lines) > 1 else 128
    for i, line in enumerate(lines):
        dr.text((x_text, y), line, font=font(sizes[min(i, 2)]), fill=fg, anchor="mm")
        y += 58 if i == 0 else 44
    noise = (fbm(256, [(3, 1)], hash(name) % 1000) * 30 - 15)
    arr = np.asarray(img, np.float32) + np.kron(noise, np.ones((1, 2)))[..., None][:h, :w]
    save(to_img(arr), name, 90)


if __name__ == "__main__":
    print("Generando texturas en", OUT)
    ground()
    rock()
    stone_block()
    stone_wall()
    wood()
    crate()
    supply_crate()
    barrel()
    metal()
    sign("sign_danger.jpg", ["¡PELIGRO!", "GRIETA PROFUNDA", "NO SE ACERQUE"])
    sign("sign_hoist.jpg", ["MALACATE", "PUNTO DE EXTRACCIÓN"], bg=(40, 120, 90), fg=(236, 240, 228), icon=False)
    sign("sign_camp.jpg", ["CERRO AIROSO", "MINA DE PLATA · 1887", "CAMPAMENTO CHISPA"], bg=(214, 190, 150),
         fg=(60, 36, 20), icon=False)
    print("Listo.")
