# Agent notes

## Create or modify a desktop pet

Read **[`docs/PET_PACK_SPEC.md`](docs/PET_PACK_SPEC.md)** and use the
**[`skills/create-dsh-pet/SKILL.md`](skills/create-dsh-pet/SKILL.md)** skill.

Short version:

1. Make a transparent 8-column × 192×208-cell sprite atlas (at least 9 action rows; see spec).
2. Generate `pet.json` + `behavior.json` with `python3 tools/import-codex-pet.py ...`.
3. Validate with `python3 tools/validate-pet-pack.py pets/<id>`.
4. Copy to `~/.dsh-desktop-pet/pets/<id>/` and select it in **DSH 设置 → 桌宠 → 形象** (hot reload, no restart).

Never ship a pack without a source/license record.
