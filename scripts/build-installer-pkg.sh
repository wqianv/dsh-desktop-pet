#!/usr/bin/env bash
# 构建 macOS .pkg 安装包：app + 自带形象 + DSH 插件 + 安装后脚本。
set -euo pipefail

# 避免 ditto/cp 把 macOS resource fork 的 ._ 文件带进 payload。
export COPYFILE_DISABLE=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(python3 -c 'import json;print(json.load(open("package.json"))["version"])')"
APP="$ROOT/src-tauri/target/release/bundle/macos/DSH Pet.app"
BUILD="$ROOT/dist/pkg-build"
STAGE="$BUILD/stage"
OUT="$ROOT/dist/DSH-Desktop-Pet-v${VERSION}-macos-arm64.pkg"

if [[ ! -d "$APP" ]]; then
  echo "找不到 release app：$APP" >&2
  echo "先运行 npm run build:release" >&2
  exit 1
fi

echo "== clean"
rm -rf "$BUILD"
mkdir -p "$STAGE/Applications" "$STAGE/Library/Application Support/DSH Desktop Pet"

echo "== ad-hoc sign app"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "== stage payload"
/usr/bin/ditto --norsrc --noextattr "$APP" "$STAGE/Applications/DSH Pet.app"
/usr/bin/ditto --norsrc --noextattr "$ROOT/pets" "$STAGE/Library/Application Support/DSH Desktop Pet/pets"
/usr/bin/ditto --norsrc --noextattr "$ROOT/dsh-launcher" "$STAGE/Library/Application Support/DSH Desktop Pet/dsh-launcher"
mkdir -p "$STAGE/Library/Application Support/DSH Desktop Pet/docs"
cp "$ROOT/docs/INSTALL.md" "$STAGE/Library/Application Support/DSH Desktop Pet/docs/INSTALL.md"
cp "$ROOT/docs/PET_PACK_SPEC.md" "$STAGE/Library/Application Support/DSH Desktop Pet/docs/PET_PACK_SPEC.md"
cp "$ROOT/docs/BEHAVIOR.md" "$STAGE/Library/Application Support/DSH Desktop Pet/docs/BEHAVIOR.md"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$STAGE/Library/Application Support/DSH Desktop Pet/THIRD_PARTY_NOTICES.md"

# 去掉 xattr / FinderInfo，否则 pkgbuild 会生成 ._ AppleDouble 文件。
/usr/bin/xattr -cr "$STAGE" 2>/dev/null || true

echo "== pkgbuild component"
pkgbuild \
  --root "$STAGE" \
  --scripts "$ROOT/installer/scripts" \
  --identifier "com.deepseek.dsh.pet" \
  --version "$VERSION" \
  --install-location "/" \
  --ownership recommended \
  "$BUILD/DSH-Pet-component.pkg"

echo "== productbuild installer"
sed "s/__VERSION__/$VERSION/g" "$ROOT/installer/distribution.xml" > "$BUILD/distribution.xml"
productbuild \
  --distribution "$BUILD/distribution.xml" \
  --resources "$ROOT/installer/resources" \
  --package-path "$BUILD" \
  "$OUT"

echo "== checksum"
shasum -a 256 "$OUT" > "$OUT.sha256"

echo "== verify"
pkgutil --payload-files "$OUT" | head -20
pkgutil --check-signature "$OUT" | head -8 || true
ls -lh "$OUT" "$OUT.sha256"
cat "$OUT.sha256"
