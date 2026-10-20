#!/bin/bash
# DSH 桌宠首次安装器（双击运行）
# 只做首次安装：放行 app、安装 DSH 插件、重启 DSH。不修改宠物数据。
set -u

SELF="$(cd "$(dirname "$0")" && pwd)"
APP="$SELF/DSH Pet.app"
PLUGIN="$SELF/dsh-launcher"
BIN="$APP/Contents/MacOS/dsh-desktop-pet"
DSH_APP="/Applications/DeepSeek Harness.app"
DSH_CLI="$DSH_APP/Contents/Resources/runtime/cli/bin/dsh"
PROFILE="${DSH_PROFILE:-desktop}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

say() { printf '%s\n' "$*"; }
pause_dialog() {
  /usr/bin/osascript - "$1" <<'AS' >/dev/null 2>&1
on run argv
  display dialog (item 1 of argv) buttons {"好"} default button "好" with title "DSH 桌宠安装器" with icon note
end run
AS
}
ask() {
  /usr/bin/osascript - "$1" "$2" <<'AS' 2>/dev/null
on run argv
  set r to display dialog (item 1 of argv) buttons {"取消", "继续"} default button "继续" with title "DSH 桌宠安装器" with icon note
  return button returned of r
end run
AS
}
fail() {
  say "✗ $*"
  pause_dialog "安装没有完成：\n\n$*\n\n可以按 INSTALL.md 手动安装，或把本窗口内容发给开发者。"
  exit 1
}

say "DSH 桌宠安装器"
say "目录：$SELF"

if [[ "$DRY_RUN" == "1" ]]; then
  say "dry-run: app=$APP"
  say "dry-run: plugin=$PLUGIN"
  say "dry-run: cli=$DSH_CLI profile=$PROFILE"
  exit 0
fi

[[ -d "$APP" && -d "$PLUGIN" ]] || fail "安装包不完整：需要 DSH Pet.app 和 dsh-launcher 在同一个目录。"
[[ -x "$BIN" ]] || fail "DSH Pet.app 不可执行。"

[[ "$(ask "欢迎安装 DSH 桌宠。\n\n安装器会：\n1. 放行并打开一次桌宠\n2. 给 DSH 安装插件\n3. 重启 DSH\n\n桌宠数据不会上传。")" == "继续" ]] || exit 0

# 1. Gatekeeper：确认后去掉 quarantine 并打开一次。
say "== 放行 / 打开桌宠"
/usr/bin/xattr -dr com.apple.quarantine "$APP" >/dev/null 2>&1 || true
/usr/bin/open "$APP" >/dev/null 2>&1 || true
APP_OK=0
for _ in $(seq 1 20); do
  if /usr/bin/pgrep -f "$BIN" >/dev/null 2>&1; then APP_OK=1; break; fi
  sleep 0.5
done
if [[ "$APP_OK" != "1" ]]; then
  fail "桌宠没有成功打开。macOS 可能拦住了它：请右键 DSH Pet.app → 打开（或系统设置 → 隐私与安全性 → 仍要打开），确认能打开后再运行安装器。"
fi
say "桌宠已打开，正在关闭，交给插件接管…"
/usr/bin/pkill -f "$BIN" >/dev/null 2>&1 || true
sleep 1

# 2. 找 DSH CLI。
if [[ ! -x "$DSH_CLI" ]]; then
  DSH_CLI="$(command -v dsh 2>/dev/null || true)"
fi
[[ -n "$DSH_CLI" && -x "$DSH_CLI" ]] || fail "找不到 DSH 命令行工具（$DSH_APP）。请先打开一次 DSH，再重新运行安装器。"
[[ -d "$HOME/.dsh/profiles/$PROFILE" ]] || fail "找不到 DSH profile：~/.dsh/profiles/$PROFILE。请先打开一次 DSH 完成初始化。"

# 3. 退出 DSH，安装插件，再打开 DSH。
say "== 退出 DSH"
/usr/bin/osascript -e 'tell application "DeepSeek Harness" to quit' >/dev/null 2>&1 || true
for _ in $(seq 1 20); do
  /usr/bin/pgrep -f "$DSH_APP/Contents/MacOS/DeepSeek Harness" >/dev/null 2>&1 || break
  sleep 0.5
done
if /usr/bin/pgrep -f "$DSH_APP/Contents/MacOS/DeepSeek Harness" >/dev/null 2>&1; then
  fail "DSH 还在运行。请手动 Cmd+Q 退出 DSH，再重新运行安装器。"
fi

say "== 安装插件到 profile: $PROFILE"
"$DSH_CLI" plugin --profile "$PROFILE" add "link:$PLUGIN" 2>&1 || fail "DSH 插件安装失败。可以按 INSTALL.md 在 DSH 插件页手动添加。"

say "== 重新打开 DSH"
/usr/bin/open -b com.deepseek.dsh >/dev/null 2>&1 || fail "无法重新打开 DSH，请手动打开。"

say "✓ 安装完成"
pause_dialog "安装完成 🎉\n\n桌宠会自动出现在桌面。\n\n打开 DSH 设置 → 桌宠：\n- 换形象（约 1 秒热切换）\n- 改显示/图标\n\n右键桌宠可以换形象、打开设置或退出。"
