#!/usr/bin/env python3
"""校验 dsh-desktop-pet 宠物包（pet.json + 图集 + behavior.json）。

用法：
  python3 tools/validate-pet-pack.py pets/<id>
  python3 tools/validate-pet-pack.py --all
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CELL_W, CELL_H = 192, 208
COLS = 8
STANDARD_ROWS = 9


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def validate(pack: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    manifest_path = pack / "pet.json"
    if not manifest_path.is_file():
        return [f"缺少 {manifest_path}"], warnings
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [f"pet.json 解析失败: {exc}"], warnings

    if manifest.get("renderer", "sprite2d") != "sprite2d":
        fail(errors, "renderer 必须是 sprite2d（当前引擎）")
    if not manifest.get("id"):
        fail(errors, "缺少 id")
    if not manifest.get("displayName"):
        warnings.append("缺少 displayName；设置页会显示 id")

    sprite = manifest.get("sprite2d") or {}
    cell = sprite.get("cell") or {}
    cw = cell.get("width", CELL_W)
    ch = cell.get("height", CELL_H)
    columns = sprite.get("columns", COLS)
    rows = sprite.get("atlasRows")
    sheet_path = pack / sprite.get("spritesheetPath", "spritesheet.webp")
    if not sheet_path.is_file():
        fail(errors, f"图集不存在: {sheet_path}")
        return errors, warnings
    try:
        image = Image.open(sheet_path)
        image.load()
    except Exception as exc:
        fail(errors, f"图集无法读取: {exc}")
        return errors, warnings
    if image.mode != "RGBA":
        fail(errors, f"图集必须是 RGBA/带 alpha，当前 {image.mode}")
    if cw != CELL_W or ch != CELL_H:
        fail(errors, f"单元格必须是 {CELL_W}×{CELL_H}，当前 {cw}×{ch}")
    if columns != COLS:
        fail(errors, f"列数必须是 {COLS}，当前 {columns}")
    if rows is None:
        rows = image.height // ch
        warnings.append(f"未写 atlasRows，按高度推断 {rows}")
    if image.width != cw * columns or image.height != ch * rows:
        fail(errors, f"图集尺寸 {image.width}×{image.height} 应为 {cw * columns}×{ch * rows}")
    if rows < STANDARD_ROWS:
        fail(errors, f"至少需要 {STANDARD_ROWS} 行动作，当前 {rows}")

    frames = manifest.get("sprite2d", {}).get("frames")
    if not isinstance(frames, list) or len(frames) < STANDARD_ROWS:
        fail(errors, "sprite2d.frames 至少要包含 9 行帧数")
    else:
        for index, count in enumerate(frames):
            if not isinstance(count, int) or not 1 <= count <= columns:
                fail(errors, f"frames[{index}] 必须是 1..{columns} 的整数")

    behavior = manifest.get("behavior")
    behavior_path = pack / manifest.get("behaviorPath", "behavior.json")
    if behavior is None and behavior_path.is_file():
        try:
            behavior = json.loads(behavior_path.read_text(encoding="utf-8"))
        except Exception as exc:
            fail(errors, f"behavior.json 解析失败: {exc}")
    if behavior is not None:
        animations = behavior.get("animations") or {}
        for name, spec in animations.items():
            row = spec.get("row")
            count = spec.get("frames")
            if not isinstance(row, int) or not 0 <= row < rows:
                fail(errors, f"animation {name} 的 row 超出范围")
                continue
            if not isinstance(count, int) or not 1 <= count <= columns:
                fail(errors, f"animation {name} 的 frames 非法")
            durations = spec.get("durations")
            if not isinstance(durations, list) or not durations:
                warnings.append(f"animation {name} 没写 durations，使用默认值")
        phases = behavior.get("phases") or {}
        for phase in ["idle", "thinking", "tool", "waiting", "review", "done", "failed"]:
            spec = phases.get(phase)
            if spec is None:
                continue
            names = spec.get("sequence") or ([spec.get("animation")] if spec.get("animation") else [])
            for name in names:
                if name not in animations:
                    fail(errors, f"phase {phase} 引用了不存在的 animation: {name}")

    if not manifest.get("license"):
        warnings.append("建议写 license，并在目录里附 LICENSE/NOTICE")
    return errors, warnings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("packs", nargs="*")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    targets = [Path(p) for p in args.packs]
    if args.all or not targets:
        targets = sorted(path for path in (ROOT / "pets").iterdir() if path.is_dir())
    failed = 0
    for pack in targets:
        errors, warnings = validate(pack)
        print(f"\n=== {pack.name}")
        for warning in warnings:
            print(f"  ⚠ {warning}")
        for error in errors:
            print(f"  ✗ {error}")
        if not errors:
            print("  ✓ ok")
        failed += bool(errors)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
