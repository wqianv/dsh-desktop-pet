#!/bin/bash
# 用 LaunchServices 打开 Tauri 打包出的 .app：进程挂在 launchd 下，不随启动它的终端/agent 会话退出。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/src-tauri/target/debug/bundle/macos/DSH Pet.app"
if [ ! -d "$APP" ]; then
  echo "找不到 $APP"
  echo "请先构建：cd \"$DIR\" && npm run build"
  exit 1
fi
open -n "$APP"
echo "opened: $APP"
