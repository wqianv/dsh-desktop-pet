#!/usr/bin/env python3
"""把 PC2005-cloud/dsh-pet 的透明 WebM 动画抽帧，拼成 8×9 宠物图集。

素材来源：https://github.com/PC2005-cloud/dsh-pet （MIT；素材允许开源使用、禁止商用）
这里只做「抽帧 → 固定裁切窗 → 缩放 → 拼图集」，不重绘任何角色。

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
COLS, ROWS = 8, 9

# 源视频 640×360，角色活动范围约 x 179..461, y 9..331。
# 用 300×325 的固定裁切窗（与 192×208 同比例），所有动作共用，保证大小/基线一致。
CROP = (170, 6, 470, 331)  # left, top, right, bottom

# row: (状态, 行, 源文件, 帧数, 截取秒数, 起始秒)
# 起始秒按源片段的“有效动作区间”挑：失败 ❌、等待时钟、干活工具、review ? 等都在镜头中后段。
CLIP_ROWS = [
    ("idle", 0, "idle.webm", 8, 3.0, 0.0),
    ("running-right", 1, "run.webm", 8, 2.0, 2.5),
    ("running-left", 2, None, 8, 0.0, 0.0),  # mirror of row 1
    ("waving", 3, "wave.webm", 4, 1.6, 2.6),
    ("jumping", 4, "jump.webm", 5, 1.5, 3.5),
    ("failed", 5, "failed.webm", 8, 2.0, 2.0),
    ("waiting", 6, "waiting.webm", 6, 2.5, 3.5),
    ("running", 7, "work.webm", 6, 2.0, 4.0),
    ("review", 8, "review.webm", 6, 2.0, 1.0),
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


def main() -> None:
    PACK.mkdir(parents=True, exist_ok=True)
    DOCS.mkdir(parents=True, exist_ok=True)

    cells: list[list[Image.Image]] = []
    tracks: dict[str, dict] = {}

    with tempfile.TemporaryDirectory(prefix="dafeiyu-") as tmp:
        tmp_root = Path(tmp)
        for state, row, filename, count, seconds, start in CLIP_ROWS:
            if filename is None:
                mirrored = [
                    cell.transpose(Image.FLIP_LEFT_RIGHT) for cell in cells[row - 1]
                ]
                cells.append(mirrored)
                tracks[state] = tracks[CLIP_ROWS[row - 1][0]]
                continue

            frames = extract_frames(SRC / filename, seconds, start, tmp_root / state)
            picked = sample(frames, count)
            row_cells = []
            for path in picked:
                im = Image.open(path).convert("RGBA").crop(CROP)
                im = im.resize((CELL_W, CELL_H), Image.LANCZOS)
                row_cells.append(im)
            cells.append(row_cells)
            tracks[state] = {"durations": [round(seconds * 1000 / count)] * count}

    atlas = Image.new("RGBA", (CELL_W * COLS, CELL_H * ROWS), (0, 0, 0, 0))
    for r, row_cells in enumerate(cells):
        for c, cell in enumerate(row_cells):
            atlas.paste(cell, (c * CELL_W, r * CELL_H), cell)

    sheet_path = PACK / "spritesheet.webp"
    atlas.save(sheet_path, "WEBP", lossless=True, quality=100, method=6)

    frames = [len(row) for row in cells]
    manifest = {
        "petManifestVersion": 2,
        "id": "dafeiyu",
        "displayName": "吃白饭的蓝色大肥鱼",
        "description": "来自 PC2005-cloud/dsh-pet 的蓝发小鲸娘桌宠（MIT；素材允许开源使用、禁止商用）。8×9 图集适配，跟随 DSH 会话状态换动作。",
        "version": "1.0.0",
        "author": "PC2005-cloud",
        "license": "Code MIT (c) 2026 PC2005-cloud; assets open-source use allowed, non-commercial. See NOTICE.md",
        "renderer": "sprite2d",
        "sprite2d": {
            "spritesheetPath": "spritesheet.webp",
            "cell": {"width": CELL_W, "height": CELL_H},
            "columns": COLS,
            "atlasRows": ROWS,
            "frames": frames,
            "tracks": tracks,
        },
        "sequences": {
            "idle": ["idle", "idle", "idle"],
            "thinking": ["running"],
            "tool": ["running-right", "running", "running-left", "running"],
            "waiting": ["waiting"],
            "review": ["review", "running"],
            "done": ["jumping", "waving", "idle"],
            "failed": ["failed", "waiting", "idle"],
        },
        "remarks": {
            "click": ["哦鲸鲸…", "在呢在呢", "别戳啦～"],
            "done": ["搞定！", "干得漂亮"],
            "failed": ["出问题了…", "要不要看看日志？"],
        },
    }
    (PACK / "pet.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # 预览图交给通用工具裁切（保持字体/排版一致）
    subprocess.run(
        ["python3", str(ROOT / "tools" / "make-pet-preview.py"),
         "--pack", "pets/dafeiyu", "--out", "docs/pet.png"],
        check=True,
    )

    print("wrote", sheet_path, sheet_path.stat().st_size, "bytes")
    print("wrote", PACK / "pet.json")
    print("wrote", DOCS / "pet.png")


if __name__ == "__main__":
    main()
