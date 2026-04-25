"""Generate icon-192.png and icon-512.png for the PWA manifest."""
from PIL import Image, ImageDraw
import os

ACCENT = (125, 211, 252, 255)   # #7dd3fc
FILL   = (125, 211, 252, 38)    # same, ~15% opacity
BG     = (17,  17,  17,  255)   # #111111


def draw_icon(size: int) -> Image.Image:
    img  = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(img)
    p    = size / 512
    lw   = max(2, round(22 * p))

    # Glass bowl triangle
    top_l = (round(112 * p), round(112 * p))
    top_r = (round(400 * p), round(112 * p))
    tip   = (round(256 * p), round(328 * p))

    draw.polygon([top_l, top_r, tip], fill=FILL)
    draw.line([top_l, top_r], fill=ACCENT, width=lw)
    draw.line([top_l, tip],   fill=ACCENT, width=lw)
    draw.line([top_r, tip],   fill=ACCENT, width=lw)

    # Stem
    stem_top = tip
    stem_bot = (round(256 * p), round(420 * p))
    draw.line([stem_top, stem_bot], fill=ACCENT, width=lw)

    # Base
    base_l = (round(176 * p), round(420 * p))
    base_r = (round(336 * p), round(420 * p))
    draw.line([base_l, base_r], fill=ACCENT, width=lw)

    # Olive
    r = round(18 * p)
    cx, cy = round(256 * p), round(210 * p)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT)

    return img


def main():
    os.makedirs("web", exist_ok=True)
    for size in (192, 512):
        path = f"web/icon-{size}.png"
        draw_icon(size).save(path)
        print(f"Generated {path}")


if __name__ == "__main__":
    main()
