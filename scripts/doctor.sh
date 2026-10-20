#!/usr/bin/env bash
# 收集给别人排障用的环境信息；不会上传任何数据。
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "=== dsh-desktop-pet doctor ==="
date
sw_vers 2>/dev/null || true
uname -m
echo "--- app"
ls -ld "$ROOT/src-tauri/target/release/bundle/macos/DSH Pet.app" 2>/dev/null || true
ls -ld "$ROOT/src-tauri/target/debug/bundle/macos/DSH Pet.app" 2>/dev/null || true
echo "--- processes"
pgrep -fl "DSH Pet.app/Contents/MacOS/dsh-desktop-pet" || true
pgrep -fl "DeepSeek Harness Helper" | head -2 || true
echo "--- dsh profile"
python3 - <<'PY' 2>/dev/null || true
import json, os
p=os.path.expanduser('~/.dsh/profiles/desktop/package.json')
try:
    d=json.load(open(p))
    print('bundles:', d.get('dsh',{}).get('profile',{}).get('bundles'))
    print('deps:', list((d.get('dependencies') or {}).keys()))
except Exception as e:
    print('profile read:', e)
PY
echo "--- settings"
cat "$HOME/.dsh-desktop-pet/settings.json" 2>/dev/null || echo "(no settings)"
echo "--- packs"
for d in "$ROOT"/pets/* "$HOME"/.dsh-desktop-pet/pets/*; do
  [ -f "$d/pet.json" ] && python3 -c 'import json,sys; d=json.load(open(sys.argv[1]+"/pet.json")); print(d.get("id"), "|", d.get("displayName"))' "$d"
done 2>/dev/null || true
echo "--- log tail"
tail -n 80 "$ROOT/pet.log" 2>/dev/null || true
echo "=== end ==="
