# behavior.json · 行为包

宠物包目录里放一个 `behavior.json`，就能不改一行 JS 地定义：动画表、状态映射、点击/拖拽互动、长时间挂机小动作、气泡文案、费用气泡模板。

Rust 加载 pack 时会把 `behavior.json` 合并进 `manifest.behavior`，renderer 读取；没有该文件的旧 pack 使用内置默认行为，保持兼容。

## 最小结构

```json
{
  "version": 1,
  "animations": {
    "idle": { "row": 0, "frames": 8, "durations": [375], "loop": true }
  },
  "phases": {
    "idle": { "animation": "idle" }
  }
}
```

`animations` 也可以用 pet.json 的 `frames`（按 row）和 `tracks[<animation>].durations` 补帧数/时长；显式写 `frames` / `durations` 优先。

## animations

| 字段 | 说明 |
|---|---|
| `row` | 图集行号（必填） |
| `frames` | 该动画用几帧（1–columns） |
| `durations` | 每帧毫秒；比 frames 短会循环取值 |
| `loop` | 是否循环（阶段循环由 phases 决定，这里只是给互动用） |

## phases

支持 `animation`（单动画）或 `sequence`（按顺序播完；循环阶段会从头再播）：

```json
"phases": {
  "idle": { "animation": "idle" },
  "thinking": { "animation": "think" },
  "tool": { "animation": "work" },
  "waiting": { "animation": "wait" },
  "review": { "animation": "think" },
  "done": { "sequence": ["jump", "wave", "idle"] },
  "failed": { "sequence": ["sad", "wait", "idle"] }
}
```

`idle/thinking/tool/waiting/review` 是循环阶段；`done/failed` 播完自动回 idle。未知 phase 回退到内置默认。

## bubbles

每个 phase 对应一个字符串数组，切换时随机取一句。`tool` 阶段的文案默认来自 `toolLabels`（`shell/edit/web/read/agent/mcp`），可自定义。

## interactions

```json
"interactions": {
  "click": {
    "animations": ["wave", "pet", "shy", "dance"],
    "bubbles": ["嗯哼～", "在呢在呢", "别戳啦～"]
  },
  "drag": { "animation": "drag", "bubble": "放我下来～" },
  "idleActions": [
    { "afterMs": 90000, "animation": "daydream", "bubble": "发会儿呆…", "once": true },
    { "afterMs": 240000, "animation": "sleep", "bubble": "Zzz…", "once": true }
  ]
}
```

- `click`：单击时随机选动画/气泡，播完回到当前 phase。
- `drag`：拖动时循环播该动画，松手恢复。
- `idleActions`：idle 持续 N 毫秒后触发一次小动作；`once` 为 true 时同一轮 idle 只触发一次；离开 idle 会重置。

## cost

```json
"cost": {
  "enabled": true,
  "template": "本轮 {lastAmount} · 本会话 {sessionAmount}",
  "delayMs": 700,
  "ttlMs": 9000
}
```

模板占位符：`{lastAmount}`、`{sessionAmount}`、`{tokens}`、`{sessionTokens}`、`{model}`。费用由 host 插件写入 state，renderer 只负责格式化；没有桥插件时不会显示。

## 调试

```bash
npm run preview     # 重新生成 docs/pet.png
npm run state       # JSONL 回退模式的状态映射
tail -f pet.log     # 看 behavior loaded / cost bubble / sprite loaded
```
