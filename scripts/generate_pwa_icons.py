#!/usr/bin/env python3
"""Generate PNG icons for Merdeka Share and MIS PWAs."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = "/app/public/icons"
os.makedirs(OUT_DIR, exist_ok=True)


def draw_gradient(size, top_color, bottom_color):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    for y in range(size):
        t = y / (size - 1)
        r = int(top_color[0] * (1 - t) + bottom_color[0] * t)
        g = int(top_color[1] * (1 - t) + bottom_color[1] * t)
        b = int(top_color[2] * (1 - t) + bottom_color[2] * t)
        for x in range(size):
            img.putpixel((x, y), (r, g, b, 255))
    return img


def rounded_rect_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def draw_share_icon(draw: ImageDraw.ImageDraw, size, color=(255, 255, 255, 255)):
    # Simple "share" glyph: an arrow up + horizontal base, drawn scaled to size
    cx = size / 2
    # Arrow (up chevron)
    arrow_h = size * 0.30
    arrow_w = size * 0.40
    top_y = size * 0.28
    bottom_y = top_y + arrow_h
    # Chevron: triangle-like
    draw.polygon([
        (cx - arrow_w / 2, bottom_y * 0.75),
        (cx, top_y),
        (cx + arrow_w / 2, bottom_y * 0.75),
    ], fill=color)
    # Vertical shaft
    shaft_w = size * 0.10
    draw.rectangle([
        cx - shaft_w / 2, top_y + arrow_h * 0.35,
        cx + shaft_w / 2, bottom_y + arrow_h * 0.55
    ], fill=color)
    # Horizontal base bar (representing the "output" doc)
    base_top = size * 0.72
    base_w = size * 0.55
    draw.rectangle([
        cx - base_w / 2, base_top,
        cx + base_w / 2, base_top + size * 0.03
    ], fill=color)
    base_bar2_top = base_top + size * 0.08
    draw.rectangle([
        cx - base_w / 2, base_bar2_top,
        cx - base_w / 2 + base_w * 0.62, base_bar2_top + size * 0.025
    ], fill=color + tuple() if isinstance(color, tuple) and len(color) == 4 else color)


def make_icon(name, size, gradient, radius_ratio, maskable=False):
    grad = draw_gradient(size, gradient[0], gradient[1])
    if maskable:
        # Maskable: full-bleed background, icon at safer center area (~80% radius)
        radius = 0
    else:
        radius = int(size * radius_ratio)

    if radius > 0:
        mask = rounded_rect_mask(size, radius)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(grad, (0, 0), mask=mask)
    else:
        out = grad.convert("RGBA")

    draw = ImageDraw.Draw(out)
    # For maskable, scale down icon to fit safe zone (80% of size)
    if maskable:
        # Draw icon in a smaller centered area
        inner = int(size * 0.62)
        icon_img = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
        icon_draw = ImageDraw.Draw(icon_img)
        draw_share_icon(icon_draw, inner)
        offset = (size - inner) // 2
        out.paste(icon_img, (offset, offset), icon_img)
    else:
        draw_share_icon(draw, size)

    path = os.path.join(OUT_DIR, name)
    out.save(path, "PNG", optimize=True)
    print(f"wrote {path} ({size}x{size})")


def draw_mis_letters(draw: ImageDraw.ImageDraw, size, color=(255, 255, 255, 255)):
    # Draw "MIS" text
    try:
        # Use built-in default; may look basic but works
        # Use larger font by loading DejaVu if available
        font = None
        for candidate in [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        ]:
            if os.path.exists(candidate):
                font = ImageFont.truetype(candidate, int(size * 0.36))
                break
        if font is None:
            font = ImageFont.load_default()
        text = "MIS"
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text(((size - tw) / 2, (size - th) / 2 - bbox[1]), text, fill=color, font=font)
    except Exception as e:
        # fallback: draw a big square
        draw.rectangle([size * 0.25, size * 0.25, size * 0.75, size * 0.75], fill=color)


def make_mis_icon(name, size, radius_ratio, maskable=False):
    gradient = ((59, 130, 246), (168, 85, 247))  # blue → purple
    grad = draw_gradient(size, gradient[0], gradient[1])
    if maskable:
        radius = 0
    else:
        radius = int(size * radius_ratio)

    if radius > 0:
        mask = rounded_rect_mask(size, radius)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(grad, (0, 0), mask=mask)
    else:
        out = grad.convert("RGBA")

    draw = ImageDraw.Draw(out)
    if maskable:
        inner = int(size * 0.62)
        icon_img = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
        icon_draw = ImageDraw.Draw(icon_img)
        draw_mis_letters(icon_draw, inner)
        offset = (size - inner) // 2
        out.paste(icon_img, (offset, offset), icon_img)
    else:
        draw_mis_letters(draw, size)

    path = os.path.join(OUT_DIR, name)
    out.save(path, "PNG", optimize=True)
    print(f"wrote {path} ({size}x{size})")


if __name__ == "__main__":
    # Merdeka Share icons: emerald green (16,185,129) → blue (59,130,246)
    ms_grad = ((16, 185, 129), (59, 130, 246))
    make_icon("merdeka-share-192.png", 192, ms_grad, radius_ratio=0.19)
    make_icon("merdeka-share-512.png", 512, ms_grad, radius_ratio=0.19)
    make_icon("merdeka-share-maskable-512.png", 512, ms_grad, radius_ratio=0, maskable=True)

    # MIS icons: blue → purple
    make_mis_icon("mis-192.png", 192, radius_ratio=0.19)
    make_mis_icon("mis-512.png", 512, radius_ratio=0.19)
    make_mis_icon("mis-maskable-512.png", 512, radius_ratio=0, maskable=True)

    print("Done.")
