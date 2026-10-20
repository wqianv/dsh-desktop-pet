#!/usr/bin/env bash
# 本地 smoke test：静态检查 + 全部 pet pack 校验 + (可选) 启动一次桌宠。
# 用法：
#   bash scripts/smoke-test.sh          # 静态检查 + pack 校验
#   bash scripts/smoke-test.sh --app    # 额外用临时 HOME 启动一次桌宠并检查日志
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for TOOLCHAIN in "$ROOT/.toolchains" "$ROOT/../.toolchains"; do
  if [[ -d "$TOOLCHAIN/cargo" ]]; then
    export CARGO_HOME="$TOOLCHAIN/cargo"
    export RUSTUP_HOME="$TOOLCHAIN/rustup"
    export PATH="$CARGO_HOME/bin:$PATH"
    break
  fi
done

echo "== 1/3 pet pack 校验"
python3 tools/validate-pet-pack.py --all

echo "== 2/3 JS / 工具语法"
for f in renderer/*.js dsh-launcher/*.js tools/state-dump.js; do
  node --check "$f"
done
python3 -m py_compile tools/import-codex-pet.py tools/validate-pet-pack.py tools/make-pet-preview.py
echo "ok"

echo "== 3/3 Rust 编译检查"
if command -v cargo >/dev/null 2>&1; then
  (cd "$ROOT/src-tauri" && cargo check)
else
  echo "⚠ 未找到 cargo，跳过 Rust 检查（正常用户需要先在终端里装 rustup 或使用项目 .toolchains）"
fi

if [[ "${1:-}" == "--app" ]]; then
  APP="$ROOT/src-tauri/target/debug/bundle/macos/DSH Pet.app"
  BIN="$APP/Contents/MacOS/dsh-desktop-pet"
  if [[ ! -x "$BIN" ]]; then
    echo "⚠ 还没有 debug .app，跳过应用启动测试（先 npm run build）"
    exit 0
  fi
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/dsh-pet-smoke.XXXXXX")"
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
  echo "== app smoke (临时 HOME=${TMP})"
  HOME="$TMP" DSH_PET_LOG="$LOG" DSH_PET_CONFIG="$CFG" "$BIN" >"$TMP/app.out" 2>&1 &
  PET_PID=$!
  for _ in $(seq 1 40); do
    if grep -q "frontend ready" "$LOG" 2>/dev/null && grep -q "sprite loaded" "$LOG" 2>/dev/null; then
      break
    fi
    if ! kill -0 "$PET_PID" 2>/dev/null; then
      echo "✗ 桌宠提前退出；日志："
      cat "$LOG" 2>/dev/null || true
      cat "$TMP/app.out" 2>/dev/null || true
      exit 1
    fi
    sleep 0.5
  done
  if grep -q "frontend ready" "$LOG" && grep -q "sprite loaded" "$LOG"; then
    echo "✓ app 启动成功："
    grep -E "sprite loaded|behavior loaded" "$LOG" | tail -3
  else
    echo "✗ app 没有完成启动；日志："
    tail -40 "$LOG" 2>/dev/null || true
    exit 1
  fi
fi

echo "✓ smoke test 通过"
