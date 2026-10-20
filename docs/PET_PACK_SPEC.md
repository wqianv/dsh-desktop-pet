# DSH 桌宠包规范（pet pack spec v1）

> 目标：让任何人（或 Codex / DSH / Claude 等 agent）按这份规范生成一个形象包，丢进目录后即可被 DSH 桌宠发现、预览并**热切换**。
>
> 参考实现：`pets/dafeiyu/`。配套工具：`tools/import-codex-pet.py`、`tools/validate-pet-pack.py`。

## 1. 目录结构

```
pets/<id>/
├── pet.json              # 必填：身份 + 图集布局
├── behavior.json         # 推荐：状态/互动/气泡/费用行为
├── spritesheet.webp      # 必填：RGBA 图集（png 也可以）
├── LICENSE               # 推荐：素材许可全文
├── NOTICE.md             # 推荐：来源、署名、修改说明
└── icon.png / tray.png   # 可选：Dock/菜单栏图标
```

安装位置（按顺序查找，同 id 后者覆盖前者）：

1. 项目 `pets/<id>/`
2. `$DSH_HOME/pets/<id>/`
3. `~/.dsh-desktop-pet/pets/<id>/`

放进目录后在 **DSH 设置 → 桌宠 → 形象** 点「刷新」，选中即热加载（约 1 秒），不需要重启。

## 2. 图集（spritesheet）

固定 8 列 × 192×208 单元格，RGBA/透明背景，纵向按行扩展：

| 属性 | 值 |
|---|---|
| 列数 | 8 |
| 单元格 | 192 × 208 px |
| 图集宽 | 1536 px |
| 行高 | 208 px |
| 图集高 | `rows × 208` |
| 背景 | 必须透明（alpha） |
| 内容 | 每格一个动作帧，建议底部对齐、不要跨格 |

### 标准 9 行（必须）

| row | 状态 | 建议帧数 | 用途 |
|---|---|---|---|
| 0 | idle | 6 | 待机循环 |
| 1 | running-right | 8 | 向右跑/干活 |
| 2 | running-left | 8 | 向左跑/干活（可镜像 row 1） |
| 3 | waving | 4 | 点击回应/打招呼 |
| 4 | jumping | 5 | 完成/庆祝 |
| 5 | failed | 8 | 出错 |
| 6 | waiting | 6 | 等待确认 |
| 7 | running | 6 | 工作中 |
| 8 | review | 6 | 检查中 |

可选 row 9–10 是 Codex 的 16 向视线帧（每行 8 帧）；本引擎不使用，但保留可兼容 Codex / Work Pets v2。

### 自定义动作

`atlasRows` 可以大于 9；row 9 之后可以放任意动作，在 `behavior.json.animations` 里用名字引用。注意：Codex 客户端会把 9/10 当作方向帧，若同时要兼容 Codex，建议自定义动作从 row 11 开始。

## 3. pet.json

最小示例：

```json
{
  "petManifestVersion": 2,
  "id": "my-pet",
  "displayName": "我的桌宠",
  "description": "一句话介绍",
  "version": "1.0.0",
  "author": "your-name",
  "license": "MIT",
  "renderer": "sprite2d",
  "behaviorPath": "behavior.json",
  "sprite2d": {
    "spritesheetPath": "spritesheet.webp",
    "cell": { "width": 192, "height": 208 },
    "columns": 8,
    "atlasRows": 9,
    "frames": [6, 8, 8, 4, 5, 8, 6, 6, 6],
    "tracks": {
      "idle": { "durations": [280, 110, 110, 140, 140, 320] }
    }
  },
  "sequences": {
    "idle": ["idle"],
    "done": ["jump", "wave", "idle"]
  }
}
```

- `frames`：每一行**有效帧数**（1–8）；渲染器只播这些列。
- `tracks.<name>.durations`：每帧毫秒，长度不足会循环取值。
- `sequences`：旧版按 phase 串动画的回退配置；有 `behavior.json` 时以 behavior 为准。
- `license` 不要写 `UNKNOWN`；素材有单独条款时写摘要并在目录放 LICENSE。

## 4. behavior.json（推荐）

完整 schema 见 [`docs/BEHAVIOR.md`](BEHAVIOR.md)。最小示例：

```json
{
  "version": 1,
  "animations": {
    "idle": { "row": 0, "frames": 6, "durations": [280, 110, 110, 140, 140, 320], "loop": true },
    "wave": { "row": 3, "frames": 4, "durations": [200, 200, 200, 200] }
  },
  "phases": {
    "idle": { "animation": "idle" },
    "done": { "sequence": ["jump", "wave", "idle"] }
  },
  "bubbles": { "done": ["搞定！", "收工～"] },
  "interactions": {
    "click": { "animations": ["wave"], "bubbles": ["在呢在呢"] },
    "drag": null,
    "idleActions": []
  },
  "cost": { "enabled": true, "template": "本轮 {lastAmount} · 本会话 {sessionAmount}", "delayMs": 700, "ttlMs": 9000 }
}
```

要点：

- `animations[].row` 对应图集行，`frames` 不能超过 8。
- `phases` 支持 `animation` 或 `sequence`；循环 phase：idle/thinking/tool/waiting/review。
- `interactions.click` 的 `animations` 会随机选一个；`drag` 可指向自定义拖拽动画。
- `idleActions` 可以实现发呆/睡觉/吃东西等挂机彩蛋（见 dafeiyu 示例）。

## 5. 生成流程（给 agent 的 checklist）

1. **决定角色/动作**：先确认版权；不要用未授权的第三方角色或官方 logo。
2. **产出图集**：
   - 8 列 × 至少 9 行、192×208/格、透明背景、八帧内不要出血；
   - 建议先生成/绘制一张统一角色设定，再逐行动作生成，最后用脚本拼图集；
   - 不要在图里写文字、水印、对话框。
3. **写 `pet.json` + `behavior.json`**：可直接用 `tools/import-codex-pet.py` 生成骨架。
4. **补 `LICENSE` / `NOTICE.md`**：写清来源、作者、许可、是否商用。
5. **校验**：`python3 tools/validate-pet-pack.py pets/<id>`，必须输出 `✓ ok`。
6. **安装**：复制到 `~/.dsh-desktop-pet/pets/<id>/`（或项目 `pets/`），在 DSH 设置 → 桌宠 → 形象点刷新，选中。
7. **视觉验收**：待机/点击/等待/完成/失败各切一遍；确认动作不变形、不裁切、大小与基线一致。

## 6. AI 绘图提示词模板

> 可以先把这段交给生图模型，再把结果整理成图集；生成式模型很难一次给出精确的 8×9 网格，**更可靠的做法是逐动作生成后拼图集**。

```
Character: <角色描述>, chibi/Q版, clean line art, transparent background, no text, no bubble.
Sprite sheet compatibility: one pose per frame, character fully inside a 192x208 area,
feet aligned to the bottom, same scale across all frames, 8 frames per action row.
Actions: idle breathing, running right, running left, waving, jumping/celebrate,
failed/sad, waiting, working/tool-use, reviewing/thinking.
Keep the same outfit, hair, proportions and colors in every frame.
Output: separate PNG poses with transparent background, not a JPEG, no grid lines.
```

## 7. 兼容性

- 本项目支持 `renderer: "sprite2d"`；Codex / Work Pets v2 的标准 9 行图集可直接使用。
- 11 行图集（9 动作 + 2 方向）也支持；方向帧当前忽略。
- 未来可能支持 frames2d / Live2D；新 renderer 会单独在本规范中标注。
- 尺寸不匹配、带 alpha 缺失或帧数越界会被验证脚本拦下；桌宠端也会拒绝不合法 pack。

## 8. 许可

- 代码/适配清单：建议 MIT。
- 素材：必须写清来源与许可；禁止商用素材要在 `NOTICE.md` 和 `license` 字段明确标注。
- 第三方角色/IP：即使图是自己生成的，角色版权也可能不属于你；公开发布前自行确认。
