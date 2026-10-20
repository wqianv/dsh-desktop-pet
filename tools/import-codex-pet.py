#!/usr/bin/env python3
"""把一个 Codex / Work Pets v2 图集包装成 dsh-desktop-pet 宠物包。

用法：
  python3 tools/import-codex-pet.py \
    --source /path/spritesheet.webp --id my-pet --name "我的桌宠" \
    --author "someone" --license "MIT" --out pets/my-pet

会生成 pet.json、behavior.json，并把图集转成 spritesheet.webp。
图集约定：8 列 × 192×208 单元格，透明背景；前 9 行是标准动作（idle/right/left/wave/jump/failed/waiting/running/review），
可选后 2 行是 Codex 的 16 向视线（本渲染器不使用）。
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CELL_W, CELL_H = 192, 208
COLS = 8
STANDARD_FRAMES = [6, 8, 8, 4, 5, 8, 6, 6, 6]
ANIMATIONS = [
    ("idle", 0, True, 280),
    ("walk-right", 1, True, 180),
    ("walk-left", 2, True, 180),
    ("wave", 3, False, 200),
    ("jump", 4, False, 200),
    ("sad", 5, False, 200),
    ("wait", 6, True, 240),
    ("work", 7, True, 200),
    ("think", 8, True, 240),
]


def default_frames(rows: int) -> list[int]:
    frames = list(STANDARD_FRAMES[: min(rows, 9)])
    while len(frames) < rows:
        frames.append(8)
    return frames


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--description", default="")
    ap.add_argument("--author", default="")
    ap.add_argument("--license", default="UNKNOWN")
    ap.add_argument("--version", default="1.0.0")
    ap.add_argument("--out", default=None)
    ap.add_argument("--frames", default="")
    args = ap.parse_args()

    source = Path(args.source)
    image = Image.open(source).convert("RGBA")
    if image.width != CELL_W * COLS or image.height % CELL_H != 0:
        raise SystemExit(f"图集尺寸不符：{image.size}，应为 {CELL_W * COLS} × N×{CELL_H}")
    rows = image.height // CELL_H
    if rows < 9:
        raise SystemExit(f"至少需要 9 行，实际 {rows}")
    frames = default_frames(rows)
    if args.frames:
        frames = [int(part.strip()) for part in args.frames.split(",") if part.strip()]
        if len(frames) != rows:
            raise SystemExit(f"--frames 需要 {rows} 项")
    if any(n < 1 or n > COLS for n in frames):
        raise SystemExit("每个 row 的帧数必须在 1..8")

    out = Path(args.out) if args.out else ROOT / "pets" / args.id
    out.mkdir(parents=True, exist_ok=True)
    sheet = out / "spritesheet.webp"
    if source.suffix.lower() == ".webp":
        shutil.copyfile(source, sheet)
    else:
        image.save(sheet, "WEBP", lossless=True, quality=100, method=6)

    durations = {name: [dur] * frames[row] for name, row, _loop, dur in ANIMATIONS}
    manifest = {
        "petManifestVersion": 2,
        "id": args.id,
        "displayName": args.name,
        "description": args.description,
        "version": args.version,
        "author": args.author,
        "license": args.license,
        "renderer": "sprite2d",
        "behaviorPath": "behavior.json",
        "sprite2d": {
            "spritesheetPath": "spritesheet.webp",
            "cell": {"width": CELL_W, "height": CELL_H},
            "columns": COLS,
            "atlasRows": rows,
            "frames": frames,
            "tracks": {name: {"durations": durations[name]} for name, _row, _loop, _dur in ANIMATIONS},
        },
        "sequences": {
            "idle": ["idle"],
            "thinking": ["think"],
            "tool": ["work"],
            "waiting": ["wait"],
            "review": ["think"],
            "done": ["jump", "wave", "idle"],
            "failed": ["sad", "wait", "idle"],
        },
    }
    behavior = {
        "version": 1,
        "animations": {
            name: {
                "row": row,
                "frames": frames[row],
                "durations": durations[name],
                "loop": loop,
            }
            for name, row, loop, _dur in ANIMATIONS
        },
        "phases": {
            "idle": {"animation": "idle"},
            "thinking": {"animation": "think"},
            "tool": {"animation": "work"},
            "waiting": {"animation": "wait"},
            "review": {"animation": "think"},
            "done": {"sequence": ["jump", "wave", "idle"]},
            "failed": {"sequence": ["sad", "wait", "idle"]},
        },
        "bubbles": {
            "thinking": ["思考中…", "让我想想…"],
            "waiting": ["等你确认…"],
            "review": ["检查中…"],
            "done": ["搞定！", "收工～"],
            "failed": ["出问题了…", "要不要看看日志？"],
        },
        "toolLabels": {
            "shell": "跑命令中…",
            "edit": "改代码中…",
            "web": "查资料中…",
            "read": "读文件…",
            "agent": "调度子代理…",
            "mcp": "调工具中…",
        },
        "interactions": {
            "click": {"animations": ["wave"], "bubbles": ["在呢在呢", "嗯哼～"]},
            "drag": None,
            "idleActions": [],
        },
        "cost": {
            "enabled": True,
            "template": "本轮 {lastAmount} · 本会话 {sessionAmount}",
            "tokensTemplate": "{tokens} tokens",
            "delayMs": 700,
            "ttlMs": 9000,
        },
    }
    (out / "pet.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "behavior.json").write_text(json.dumps(behavior, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out} ({rows} rows, frames={frames}, atlas={image.size})")
    print("next: 加 LICENSE/NOTICE，然后运行 tools/validate-pet-pack.py")


if __name__ == "__main__":
    main()
