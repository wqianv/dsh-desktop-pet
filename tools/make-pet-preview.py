#!/usr/bin/env python3
"""从 pet pack 的图集里裁几帧，拼一张 README 预览图（只做裁切/排版，不画角色）。

用法：
  python3 tools/make-pet-preview.py --pack pets/jingjing --out docs/pet.png
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent

SHOTS = [
    ("idle", 0, "待机"),
    ("waving", 2, "打招呼"),
    ("jumping", 2, "完成 / 跳跃"),
    ("waiting", 0, "等你确认"),
    ("failed", 3, "出错"),
    ("running", 0, "干活中"),
]
ROW = {
    "idle": 0, "running-right": 1, "running-left": 2, "waving": 3, "jumping": 4,
    "failed": 5, "waiting": 6, "running": 7, "review": 8,
}


def load_font(size: int):
    for path in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", default="pets/jingjing")
    ap.add_argument("--out", default="docs/pet.png")
    args = ap.parse_args()

    pack = (ROOT / args.pack).resolve()
    manifest = json.loads((pack / "pet.json").read_text(encoding="utf-8"))
    sprite = manifest["sprite2d"]
    sheet = Image.open(pack / sprite["spritesheetPath"]).convert("RGBA")
    cw = sprite.get("cell", {}).get("width", 192)
    ch = sprite.get("cell", {}).get("height", 208)
    cols = sprite.get("columns", 8)

    W, H = 1400, 500
    card = Image.new("RGB", (W, H), (236, 244, 255))
    d = ImageDraw.Draw(card)
    title = load_font(40)
    sub = load_font(20)
    label = load_font(22)
    d.text((48, 34), manifest.get("displayName", manifest["id"]), font=title, fill=(26, 42, 70))
    d.text((48, 90), f"来自 {manifest.get('author', '')} · {manifest.get('license', '')}",
           font=sub, fill=(84, 104, 134))

    x = 48
    for state, frame, text in SHOTS:
        row = ROW[state]
        cell = sheet.crop((frame * cw, row * ch, (frame + 1) * cw, (row + 1) * ch))
        cell = cell.resize((cw, ch), Image.LANCZOS)
        y = 360 - cell.height
        card.paste(cell, (x, y), cell)
        d.text((x, 392), text, font=label, fill=(40, 58, 88))
        x += cell.width + 24

    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    card.save(out)
    print("wrote", out, card.size)


if __name__ == "__main__":
    main()
