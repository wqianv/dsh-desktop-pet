# Electron 版（legacy）

第一版 MVP 用的是 Electron（为了立刻验证透明窗/穿透/状态读取）。现在主实现已切到 Tauri 2（`src-tauri/`），这里只作对照保留：

```bash
# 需要 electron 依赖（已不在 package.json 中）
npm i -D electron@44
npx electron legacy/electron/main.js
```

它与 Tauri 版共用 `renderer/`、`pets/` 和 `tools/state-dump.js`。
