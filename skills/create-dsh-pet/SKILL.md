---
name: create-dsh-pet
description: Create, adapt, or modify a DSH desktop pet (dsh-desktop-pet) pack — generate/collect a transparent 8-column sprite atlas, write pet.json + behavior.json, validate it, install it, and hot-swap it in DSH. Use when the user asks to make a custom desktop pet, convert a Codex/Work Pets pet, change a pet's appearance, or add animations/interactions to an existing pet pack.
---

# Create a DSH desktop pet pack

The canonical format is [`docs/PET_PACK_SPEC.md`](../../docs/PET_PACK_SPEC.md). Read it first if it is available. This skill assumes you are inside (or can copy from) the `dsh-desktop-pet` repository.

## What you produce

```
pets/<id>/
├── pet.json          # identity + atlas layout
├── behavior.json     # phases/interactions/bubbles (recommended)
├── spritesheet.webp  # 1536 × rows*208, RGBA, 8 columns × 192×208 cells
├── LICENSE           # asset license full text
└── NOTICE.md         # source/attribution/modification notes
```

The pack is hot-swappable: after copying it into `~/.dsh-desktop-pet/pets/<id>/` (or the repo's `pets/`), the user selects it in **DSH 设置 → 桌宠 → 形象** and it changes in about 1 second. No restart.

## Workflow

1. **Clarify the character and licensing.** Do not copy an unlicensed character or official logo. If the user supplies images, confirm they have the right to use them. Record the license in `pet.json` and `LICENSE`.
2. **Create or collect frames.**
   - Standard rows: 0 idle (6 frames), 1 run-right (8), 2 run-left (8), 3 wave (4), 4 jump (5), 5 failed (8), 6 waiting (6), 7 working (6), 8 review (6).
   - One frame per cell, 192×208, character fully inside the cell, transparent background, bottom-aligned, consistent scale.
   - Image generators rarely produce exact 8×N grids. Generate individual poses, then assemble the atlas with a script (Pillow) rather than trusting one generated sheet.
3. **Generate the skeleton**:
   ```bash
   python3 tools/import-codex-pet.py \
     --source /path/to/spritesheet.webp \
     --id my-pet --name "我的桌宠" \
     --author "your-name" --license "MIT" \
     --out pets/my-pet
   ```
   You can pass `--frames 6,8,8,4,5,8,6,6,6` if the atlas is non-standard. Then edit `behavior.json` for custom interactions/idle actions.
4. **Add license/attribution.** Write `LICENSE` and `NOTICE.md`; if the character is fan art, say so and do not imply endorsement.
5. **Validate** (must pass):
   ```bash
   python3 tools/validate-pet-pack.py pets/my-pet
   python3 tools/validate-pet-pack.py --all
   ```
6. **Install / hot-swap**:
   ```bash
   mkdir -p ~/.dsh-desktop-pet/pets
   cp -R pets/my-pet ~/.dsh-desktop-pet/pets/
   ```
   Then DSH 设置 → 桌宠 → 形象 → 刷新 → 选择。Or right-click the pet → 更换形象.
7. **Visual QA**: check idle, click, waiting, done, failed, and one drag/idle action; no clipping, no scale jumps, no white fringe.

## Editing an existing pack

- Change `displayName`, `description`, `behavior.json` bubbles, phases or `interactions` — the running pet reloads within about 1s after saving.
- To add an action, extend `sprite2d.atlasRows`/`frames`, add a row to the atlas, then add an animation entry:
  ```json
  "stretch": { "row": 11, "frames": 6, "durations": [200,200,200,200,200,200] }
  ```
  and reference it from `interactions` / `phases`.
- Do not change cell size or columns; the engine is fixed at 8 columns × 192×208.

## Image prompt template

```
Character: <description>, chibi/Q-version, clean line art, transparent background,
no text, no speech bubble, no grid lines.
Pose: <one action>. Full body inside a 192×208 frame, feet at the bottom,
same scale/outfit/colors as the reference, consistent line width.
Output: PNG with transparent background.
```

Generate each action separately, align them on a canvas, then pack the atlas. If a frame has a background, remove it with chroma-key/alpha before packing.

## Guardrails

- Never ship a pack without a license source.
- Never claim the pet is official DeepSeek/Codex; use “非官方 / fan-made” when applicable.
- Assets with non-commercial terms must keep `NOTICE.md` and be marked in `pet.json.license`.
- If the user wants a renderer other than `sprite2d` (frames2d/Live2D), check the repo first; only `sprite2d` is currently supported.
