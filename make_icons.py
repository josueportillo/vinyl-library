#!/usr/bin/env python3
"""Generate PWA icons for the Vinyl Library app (vinyl record motif)."""
from PIL import Image, ImageDraw


def make_record(size):
    img = Image.new("RGBA", (size, size), (14, 14, 18, 255))
    d = ImageDraw.Draw(img)
    cx = cy = size / 2.0
    R = size * 0.46

    # record disc
    d.ellipse([cx - R, cy - R, cx + R, cy + R],
              fill=(18, 18, 22, 255), outline=(42, 42, 50, 255),
              width=max(1, size // 96))

    # grooves
    for i in range(1, 7):
        r = R * (0.52 + 0.06 * i)
        d.ellipse([cx - r, cy - r, cx + r, cy + r],
                  outline=(28, 28, 34, 255), width=max(1, size // 320))

    # label
    lr = R * 0.34
    d.ellipse([cx - lr, cy - lr, cx + lr, cy + lr],
              fill=(240, 165, 0, 255), outline=(196, 128, 0, 255),
              width=max(1, size // 96))

    # label ring
    lr2 = R * 0.23
    d.ellipse([cx - lr2, cy - lr2, cx + lr2, cy + lr2],
              outline=(140, 92, 0, 255), width=max(1, size // 256))

    # spindle hole
    hr = R * 0.055
    d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=(14, 14, 18, 255))

    return img


if __name__ == "__main__":
    make_record(512).save("icons/icon-512.png")
    make_record(192).save("icons/icon-192.png")
    make_record(180).save("icons/apple-touch-icon.png")
    print("icons written")
