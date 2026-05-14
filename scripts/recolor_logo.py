#!/usr/bin/env python3
"""Recolor the Telegram logo SVG: rotate every blue hue to red while preserving lightness and saturation.

Usage:
    python scripts/recolor_logo.py <input.svg> <output.svg>
"""
import colorsys
import re
import sys
from pathlib import Path

# Hue range considered "blue" (degrees on the HSL wheel).
BLUE_LOW_DEG = 180
BLUE_HIGH_DEG = 260

# Target red hue (0deg = pure red). Slight bias toward 355deg keeps it from looking pink at low saturation.
RED_HUE_DEG = 355

HEX_RE = re.compile(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")
RGB_RE = re.compile(r"rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)")


def hex_to_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255)


def rgb_to_hex(r: float, g: float, b: float) -> str:
    return "#{:02X}{:02X}{:02X}".format(
        round(r * 255), round(g * 255), round(b * 255)
    )


def is_blue(r: float, g: float, b: float) -> bool:
    h, _l, s = colorsys.rgb_to_hls(r, g, b)
    return s >= 0.05 and BLUE_LOW_DEG <= h * 360 <= BLUE_HIGH_DEG


def shift_to_red(r: float, g: float, b: float) -> tuple[float, float, float]:
    _h, l, s = colorsys.rgb_to_hls(r, g, b)
    return colorsys.hls_to_rgb(RED_HUE_DEG / 360, l, s)


def recolor_svg(text: str) -> tuple[str, list[tuple[str, str]]]:
    swaps: list[tuple[str, str]] = []

    def repl_hex(m: re.Match[str]) -> str:
        original = m.group(0)
        r, g, b = hex_to_rgb(original)
        if not is_blue(r, g, b):
            return original
        new = rgb_to_hex(*shift_to_red(r, g, b))
        swaps.append((original, new))
        return new

    def repl_rgb(m: re.Match[str]) -> str:
        original = m.group(0)
        r, g, b = (int(m.group(i)) / 255 for i in (1, 2, 3))
        if not is_blue(r, g, b):
            return original
        nr, ng, nb = shift_to_red(r, g, b)
        new = f"rgb({round(nr * 255)}, {round(ng * 255)}, {round(nb * 255)})"
        swaps.append((original, new))
        return new

    text = HEX_RE.sub(repl_hex, text)
    text = RGB_RE.sub(repl_rgb, text)
    return text, swaps


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    src = Path(argv[1])
    dst = Path(argv[2])
    recolored, swaps = recolor_svg(src.read_text())
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(recolored)
    print(f"Wrote {dst} ({len(recolored)} bytes)")
    if swaps:
        print("Color swaps:")
        for old, new in swaps:
            print(f"  {old} -> {new}")
    else:
        print("No blue colors detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
