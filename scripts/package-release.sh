#!/usr/bin/env bash
# 打 macOS 分发包：DSH Pet.app + pets + dsh-launcher 插件 + 文档，打成 zip。
# 用法：bash scripts/package-release.sh [--build]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -d "$ROOT/../.toolchains/cargo" ]]; then
  export CARGO_HOME="$ROOT/../.toolchains/cargo"
  export RUSTUP_HOME="$ROOT/../.toolchains/rustup"
  export PATH="$CARGO_HOME/bin:$PATH"
fi

VERSION="$(python3 -c 'import json;print(json.load(open("package.json"))["version"])')"
ARCH="$(uname -m)"
APP="$ROOT/src-tauri/target/release/bundle/macos/DSH Pet.app"

if [[ "${1:-}" == "--build" || ! -d "$APP" ]]; then
  echo "== building release app"
  node_modules/.bin/tauri build --bundles app
fi
if [[ ! -d "$APP" ]]; then
  echo "✗ release app 不存在：$APP" >&2
  exit 1
fi

NAME="DSH-Desktop-Pet-v${VERSION}-macos-${ARCH}"
DIST="$ROOT/dist/$NAME"
echo "== staging $DIST"
rm -rf "$DIST"
mkdir -p "$DIST"

# ad-hoc 签名：没有 Developer ID 时至少保证 bundle 内部一致性；Gatekeeper 仍会提示。
echo "== ad-hoc sign"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

cp -R "$APP" "$DIST/DSH Pet.app"
cp -R "$ROOT/pets" "$DIST/pets"
cp -R "$ROOT/dsh-launcher" "$DIST/dsh-launcher"
cp -R "$ROOT/skills" "$DIST/skills"
cp "$ROOT/AGENTS.md" "$DIST/AGENTS.md"
cp "$ROOT/LICENSE" "$DIST/LICENSE"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$DIST/THIRD_PARTY_NOTICES.md"
mkdir -p "$DIST/docs"
cp "$ROOT/docs/PET_PACK_SPEC.md" "$DIST/docs/PET_PACK_SPEC.md"
cp "$ROOT/docs/BEHAVIOR.md" "$DIST/docs/BEHAVIOR.md"
cp "$ROOT/docs/TESTING.md" "$DIST/docs/TESTING.md"
cp "$ROOT/docs/INSTALL.md" "$DIST/docs/INSTALL.md"
cp "$ROOT/docs/install-guide.html" "$DIST/install-guide.html"
cp "$ROOT/README.md" "$DIST/README.md"
cp "$ROOT/scripts/install-first-run.command" "$DIST/Install DSH Pet.command"
chmod +x "$DIST/Install DSH Pet.command"
mkdir -p "$DIST/scripts"
cp "$ROOT/scripts/doctor.sh" "$DIST/scripts/doctor.sh"
chmod +x "$DIST/scripts/doctor.sh"

cp "$ROOT/docs/INSTALL.md" "$DIST/INSTALL.md"

echo "== smoke test packaged app"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dsh-pet-pkg.XXXXXX")"
LOG="$TMP/pet.log"
CFG="$TMP/config.json"
PET_PID=""
cleanup() {
  if [[ -n "$PET_PID" ]] && kill -0 "$PET_PID" 2>/dev/null; then
    kill "$PET_PID" 2>/dev/null || true
    wait "$PET_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT
HOME="$TMP" DSH_PET_ROOT="$DIST" DSH_PET_LOG="$LOG" DSH_PET_CONFIG="$CFG" \
  "$DIST/DSH Pet.app/Contents/MacOS/dsh-desktop-pet" >"$TMP/app.out" 2>&1 &
PET_PID=$!
for _ in $(seq 1 40); do
  grep -q "sprite loaded" "$LOG" 2>/dev/null && break
  if ! kill -0 "$PET_PID" 2>/dev/null; then
    echo "✗ packaged app 提前退出"; cat "$LOG" 2>/dev/null; cat "$TMP/app.out" 2>/dev/null; exit 1
  fi
  sleep 0.5
done
grep -q "sprite loaded" "$LOG" || { echo "✗ packaged app 没加载"; tail -30 "$LOG" 2>/dev/null; exit 1; }
echo "✓ packaged app OK: $(grep 'sprite loaded' "$LOG" | tail -1)"

ZIP="$ROOT/dist/$NAME.zip"
echo "== zip $ZIP"
rm -f "$ZIP"
( cd "$ROOT/dist" && ditto -c -k --norsrc --keepParent "$NAME" "$ZIP" )
shasum -a 256 "$ZIP" > "$ZIP.sha256"
echo "== done"
ls -lh "$ZIP" "$ZIP.sha256"
cat "$ZIP.sha256"
