#!/usr/bin/env python3
"""从 pet pack 的图集里裁几帧，拼一张 README 预览图（只做裁切/排版，不画角色）。

用法：
  python3 tools/make-pet-preview.py --pack pets/dafeiyu --out docs/pet.png
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent

SHOTS = [
    ("idle", 0, "待机"),
    ("wave", 1, "打招呼"),
    ("jump", 1, "完成 / 跳跃"),
    ("wait", 0, "等你确认"),
    ("sad", 2, "出错"),
    ("work", 0, "干活中"),
    ("drag", 1, "被拖拽"),
    ("pet", 2, "开心被摸"),
    ("sleep", 2, "打瞌睡"),
    ("eat", 2, "吃白饭"),
]

FALLBACK_ROW = {
    "idle": 0, "walk-right": 1, "walk-left": 2, "wave": 3, "jump": 4,
    "sad": 5, "wait": 6, "work": 7, "think": 8,
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
    ap.add_argument("--pack", default="pets/dafeiyu")
    ap.add_argument("--out", default="docs/pet.png")
    args = ap.parse_args()

    pack = (ROOT / args.pack).resolve()
    manifest = json.loads((pack / "pet.json").read_text(encoding="utf-8"))
    behavior = manifest.get("behavior") or {}
    if not behavior and (pack / "behavior.json").exists():
        behavior = json.loads((pack / "behavior.json").read_text(encoding="utf-8"))
    animations = behavior.get("animations") or {}
    sprite = manifest["sprite2d"]
    sheet = Image.open(pack / sprite["spritesheetPath"]).convert("RGBA")
    cw = sprite.get("cell", {}).get("width", 192)
    ch = sprite.get("cell", {}).get("height", 208)

    W, H = 1400, 900
    card = Image.new("RGB", (W, H), (236, 244, 255))
    d = ImageDraw.Draw(card)
    title = load_font(40)
    sub = load_font(20)
    label = load_font(22)
    d.text((48, 34), manifest.get("displayName", manifest["id"]), font=title, fill=(26, 42, 70))
    d.text((48, 90), f"来自 {manifest.get('author', '')} · 素材允许开源使用、禁止商用", font=sub, fill=(84, 104, 134))

    for index, (animation, frame, text) in enumerate(SHOTS):
        row = (animations.get(animation) or {}).get("row", FALLBACK_ROW.get(animation, 0))
        cell = sheet.crop((frame * cw, row * ch, (frame + 1) * cw, (row + 1) * ch))
        col = index % 5
        line = index // 5
        x = 48 + col * (cw + 24)
        y = 250 + line * 330
        card.paste(cell, (x, y), cell)
        d.text((x, y + ch + 14), text, font=label, fill=(40, 58, 88))

    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    card.save(out)
    print("wrote", out, card.size)


if __name__ == "__main__":
    main()
