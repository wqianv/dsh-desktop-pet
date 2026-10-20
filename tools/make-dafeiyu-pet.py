#!/usr/bin/env python3
"""把 PC2005-cloud/dsh-pet 的透明 WebM 动画抽帧，拼成宠物图集 + behavior.json。

素材来源：https://github.com/PC2005-cloud/dsh-pet （MIT；素材允许开源使用、禁止商用）
这里只做「抽帧 → 固定裁切窗 → 缩放 → 拼图集 / 写行为配置」，不重绘任何角色。

用法：python3 tools/make-dafeiyu-pet.py
依赖：ffmpeg（解码 VP9 alpha 需要 -c:v libvpx-vp9）
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "art-src" / "dafeiyu"
PACK = ROOT / "pets" / "dafeiyu"
DOCS = ROOT / "docs"

CELL_W, CELL_H = 192, 208
COLS, ROWS = 8, 17

# 源视频 640×360。角色在不同动作里会左右移动、举高、低头吃碗，统一用一个
# 360×390 的裁切窗（含 30px 底部透明垫高，保持 192:208 比例），全部动作共用，
# 保证大小/基线一致。
CROP_BOX = (110, 0, 470, 390)  # left, top, right, bottom（可超出源图，超出部分透明）
CROP_W, CROP_H = CROP_BOX[2] - CROP_BOX[0], CROP_BOX[3] - CROP_BOX[1]

# row: (动画 id, 行, 源文件, 帧数, 截取秒数, 起始秒)
CLIP_ROWS = [
    ("idle", 0, "idle.webm", 8, 3.0, 0.0),
    ("walk-right", 1, "run.webm", 8, 2.0, 2.5),
    ("walk-left", 2, None, 8, 0.0, 0.0),  # 镜像 row 1
    ("wave", 3, "wave.webm", 4, 1.6, 2.6),
    ("jump", 4, "jump.webm", 5, 1.5, 3.5),
    ("sad", 5, "failed.webm", 8, 2.0, 2.0),
    ("wait", 6, "waiting.webm", 6, 2.5, 3.5),
    ("work", 7, "work.webm", 6, 2.0, 4.0),
    ("think", 8, "review.webm", 6, 2.0, 1.0),
    # ——— 交互 / 彩蛋 ———
    ("drag", 9, "drag.webm", 6, 2.0, 0.0),
    ("pet", 10, "pet.webm", 6, 2.0, 4.0),
    ("shy", 11, "shy.webm", 6, 2.0, 4.5),
    ("sleep", 12, "sleep.webm", 8, 2.0, 4.0),
    ("eat", 13, "eat.webm", 6, 2.0, 2.5),
    ("stretch", 14, "stretch.webm", 6, 2.0, 6.0),
    ("dance", 15, "dance.webm", 8, 2.0, 3.0),
    ("daydream", 16, "daydream.webm", 6, 2.0, 3.0),
]


def extract_frames(video: Path, seconds: float, start: float, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y",
            "-c:v", "libvpx-vp9",
            "-ss", f"{start:.2f}",
            "-i", str(video),
            "-t", f"{seconds:.2f}",
            "-vf", "fps=12",
            "-pix_fmt", "rgba",
            str(out_dir / "f%03d.png"),
        ],
        check=True,
    )
    return sorted(out_dir.glob("f*.png"))


def sample(frames: list[Path], count: int) -> list[Path]:
    if not frames:
        raise RuntimeError("no frames extracted")
    if count == 1:
        return [frames[0]]
    idx = [round(i * (len(frames) - 1) / (count - 1)) for i in range(count)]
    return [frames[min(i, len(frames) - 1)] for i in idx]


def crop_frame(im: Image.Image) -> Image.Image:
    """裁统一窗口；窗口超出源图的部分补透明，再缩放到单元格。"""
    x0, y0, x1, y1 = CROP_BOX
    canvas = Image.new("RGBA", (CROP_W, CROP_H), (0, 0, 0, 0))
    sx0, sy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(im.width, x1), min(im.height, y1)
    if sx1 > sx0 and sy1 > sy0:
        canvas.paste(im.crop((sx0, sy0, sx1, sy1)), (sx0 - x0, sy0 - y0))
    return canvas.resize((CELL_W, CELL_H), Image.LANCZOS)


def main() -> None:
    PACK.mkdir(parents=True, exist_ok=True)
    DOCS.mkdir(parents=True, exist_ok=True)

    cells: list[list[Image.Image]] = []
    animations: dict[str, dict] = {}

    with tempfile.TemporaryDirectory(prefix="dafeiyu-") as tmp:
        tmp_root = Path(tmp)
        for animation, row, filename, count, seconds, start in CLIP_ROWS:
            if filename is None:
                source = CLIP_ROWS[row - 1][0]
                row_cells = [cell.transpose(Image.FLIP_LEFT_RIGHT) for cell in cells[row - 1]]
                cells.append(row_cells)
                animations[animation] = {**animations[source], "row": row}
                continue

            frames = extract_frames(SRC / filename, seconds, start, tmp_root / animation)
            picked = sample(frames, count)
            row_cells: list[Image.Image] = []
            for path in picked:
                row_cells.append(crop_frame(Image.open(path).convert("RGBA")))
            cells.append(row_cells)
            durations = [round(seconds * 1000 / count)] * count
            animations[animation] = {
                "row": row,
                "frames": count,
                "durations": durations,
                "loop": animation not in {"jump", "wave", "pet", "shy", "sleep", "eat", "stretch", "dance", "daydream", "drag"},
            }

    atlas = Image.new("RGBA", (CELL_W * COLS, CELL_H * ROWS), (0, 0, 0, 0))
    for r, row_cells in enumerate(cells):
        for c, cell in enumerate(row_cells):
            atlas.paste(cell, (c * CELL_W, r * CELL_H), cell)

    sheet_path = PACK / "spritesheet.webp"
    atlas.save(sheet_path, "WEBP", lossless=True, quality=100, method=6)

    frames = [len(row) for row in cells]
    tracks = {name: {"durations": spec["durations"]} for name, spec in animations.items()}

    manifest = {
        "petManifestVersion": 2,
        "id": "dafeiyu",
        "displayName": "吃白饭的蓝色大肥鱼",
        "description": "来自 PC2005-cloud/dsh-pet 的蓝发小鲸娘桌宠（MIT；素材允许开源使用、禁止商用）。8×17 图集 + behavior.json：待机/工作/等待/出错，以及拖拽、摸头、害羞、睡觉、吃白饭、伸懒腰、跳舞、发呆等互动。",
        "version": "1.1.0",
        "author": "PC2005-cloud",
        "license": "Code MIT (c) 2026 PC2005-cloud; assets open-source use allowed, non-commercial. See NOTICE.md",
        "renderer": "sprite2d",
        "behaviorPath": "behavior.json",
        "sprite2d": {
            "spritesheetPath": "spritesheet.webp",
            "cell": {"width": CELL_W, "height": CELL_H},
            "columns": COLS,
            "atlasRows": ROWS,
            "frames": frames,
            "tracks": tracks,
        },
        "sequences": {
            "idle": ["idle"],
            "thinking": ["think"],
            "tool": ["work"],
            "waiting": ["wait"],
            "review": ["think"],
            "done": ["jump", "wave", "idle"],
            "failed": ["sad", "wait"],
        },
    }
    (PACK / "pet.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    behavior = {
        "version": 1,
        "animations": animations,
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
            "thinking": ["思考中…", "让我想想…", "整理一下思路…"],
            "waiting": ["等你确认…", "这里需要你一下"],
            "review": ["检查中…", "复盘一下…"],
            "done": ["搞定！", "干得漂亮", "收工～"],
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
            "click": {
                "animations": ["wave", "pet", "shy", "dance"],
                "bubbles": ["嗯哼～", "在呢在呢", "别戳啦～", "摸鱼中…"],
            },
            "drag": {"animation": "drag", "bubble": "放我下来～"},
            "idleActions": [
                {"afterMs": 90000, "animation": "daydream", "bubble": "发会儿呆…", "once": True},
                {"afterMs": 240000, "animation": "sleep", "bubble": "Zzz…", "once": True},
                {"afterMs": 420000, "animation": "eat", "bubble": "吃白饭时间到", "once": True},
                {"afterMs": 540000, "animation": "stretch", "bubble": "伸个懒腰～", "once": True},
            ],
        },
        "cost": {
            "enabled": True,
            "template": "本轮 {lastAmount} · 本会话 {sessionAmount}",
            "tokensTemplate": "{tokens} tokens",
            "delayMs": 700,
            "ttlMs": 9000,
        },
    }
    (PACK / "behavior.json").write_text(json.dumps(behavior, ensure_ascii=False, indent=2), encoding="utf-8")

    subprocess.run(
        ["python3", str(ROOT / "tools" / "make-pet-preview.py"),
         "--pack", "pets/dafeiyu", "--out", "docs/pet.png"],
        check=True,
    )

    print("wrote", sheet_path, sheet_path.stat().st_size, "bytes")
    print("wrote", PACK / "pet.json", "and", PACK / "behavior.json")
    print("wrote", DOCS / "pet.png")


if __name__ == "__main__":
    main()
