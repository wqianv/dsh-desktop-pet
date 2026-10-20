# dsh-desktop-pet

**真正住在操作系统桌面上的 DSH 桌宠**：透明、无边框、置顶、点击穿透，独立于 DSH 窗口；跟随 DSH 会话状态换动作，支持 `pet-manifest-v2` 宠物包（为社区 mod 留接口）。

> 技术栈：**Tauri 2 + Rust + 系统 WebView**（不是 Electron；Electron 版只作为最初验证 MVP 留在 `legacy/electron/`）。
> 已在本机 macOS 26.2 (arm64) 验证：Tauri 2.12 / debug `.app` ~30MB；窗口 `271×310`、floating layer、置顶；sprite 加载成功（1536×1872）；hover 进入宠物时自动从点击穿透切到可交互（日志可见）；状态实时跟随当前 DSH 会话。

![pet](docs/pet.png)
（「吃白饭的蓝色大肥鱼」— 动画来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)；本项目只做抽帧/裁切/适配，不重绘角色。）

## 快速开始

### 1. 构建

需要：Rust（[rustup](https://rustup.rs)）+ Xcode Command Line Tools + Node.js 20+。

```bash
cd dsh-desktop-pet
npm install          # @tauri-apps/cli
npm run build        # tauri build --debug --bundles app
```

> 开发时如果 Rust 装在项目内（比如为了避免污染系统），把 `RUSTUP_HOME`/`CARGO_HOME` 指到项目里的 `.toolchains/`，并把 `$CARGO_HOME/bin` 加进 `PATH` 即可。

### 2. 运行（脱离 agent/终端会话）

```bash
npm run open
# 等价于：open -n "src-tauri/target/debug/bundle/macos/DSH Pet.app"
```

用 `open` 启动 `.app`，进程挂在 launchd 下，**不会随启动它的终端/agent 会话退出**。启动后：

- 屏幕右下角出现「吃白饭的蓝色大肥鱼」，悬在其他应用之上；
- 鼠标移到宠物上才可点/拖（其余区域点击穿透到下层应用）；
- 拖拽移动；单击有回应；托盘图标可显示/隐藏/退出；
- 调试：`npm run state` 不开 GUI 直接看 DSH 状态映射。

> 从 DSH agent 的沙箱里直接跑二进制会被 WebKit 的 sandbox 限制，所以用 `.app + open` 的方式；正常终端里也可以直接 `cargo run` 调试。

## 美术与许可

默认宠物「吃白饭的蓝色大肥鱼」的动画来自 **[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**，本项目**不重绘角色**：`tools/make-dafeiyu-pet.py` 从其透明 VP9 WebM 动画里抽帧，用固定裁切窗拼成 1536×1872 图集（`pets/dafeiyu/`）。原始 8 段 WebM 存在 `tools/art-src/dafeiyu/`，方便复现。

上游许可：**代码 MIT**；**素材（动画/提示词/源视频）允许开源使用、禁止商用**（上游 README）。所以这个宠物包按「非官方、非商用 fan art」处理。

**其他人复用本宠物包/素材的要求**：禁止商用（收费、付费分发、广告变现等，商用需联系上游作者）；再分发/修改时保留 `pets/dafeiyu/NOTICE.md`、`LICENSE` 和根目录 `THIRD_PARTY_NOTICES.md`；本仓库代码自身是 MIT，但不会因此解除素材的非商用限制。个人桌面使用没问题。

## 随 DSH 启动（launcher 插件）

`dsh-launcher/` 是一个极小的 DSH host 插件：DSH 启动时拉起桌宠，DSH 退出/卸载插件时关掉桌宠；DSH 被强杀时，桌宠带 `DSH_PET_MANAGED=1` 会自己检测 DSH Helper 进程并退出。

安装（DSH 桌面端目前不允许外部 CLI 改 profile，需要走插件页）：

1. DSH 左侧栏 → **插件** → 右上 **添加插件** → **本地目录**
2. 填 `/Users/wqian/Dev/dsh-desktop-pet/dsh-launcher`（或你 clone 后的绝对路径）
3. 安装后点 **立即启用**
4. **完全退出 DSH 再打开**（插件层重启才组装）

之后再打开 DSH，桌宠会自己出现；不需要手动 `npm run open`。细节见 [`dsh-launcher/README.md`](dsh-launcher/README.md)。

## 它怎么工作（Tauri 2）

```
DSH events
  └─ ~/.dsh/sessions/<workspace>/<session>/session.v4.jsonl.zstd   ← 只读 tail
        │ Rust: zstd 解压 + 解析 turn/step/tool/turn-end
        ▼
   state 线程（1s）──emit("pet:state")──┐
        │                               │
   hover 线程（40ms，全局光标 + 窗口矩形）│
        └─ set_ignore_cursor_events()   │
                                        ▼
   Tauri WebviewWindow（透明/无边框/置顶/skipTaskbar）
        └─ renderer/（雪碧图 CSS 帧动画 + 气泡 + 拖拽/点击）
```

关键点：

- **真桌宠**：Tauri `WindowConfig`：`transparent: true`、`decorations: false`、`alwaysOnTop: true`、`skipTaskbar: true`、`shadow: false`；系统 WebView，不打包 Chromium。
- **点击穿透**：Tauri 没有 Electron 的 `{forward:true}`，所以 Rust 侧起了一个 40ms 的 hover 线程：轮询全局光标 + 窗口位置，命中宠物矩形才 `set_ignore_cursor_events(false)`，移出恢复 `true`。透明窗其余区域点击直接落到底层应用。
- **状态源（MVP）**：只读 `$DSH_HOME/sessions/**/session.v4.jsonl.zstd`（append-only 多 frame zstd，`zstd` crate 连续解压），零侵入、不用装 DSH 插件。后续产品化换成 DSH host 插件桥（实时事件 + 审批/提问）。
- **宠物包**：`pet-manifest-v2` 的 `sprite2d` 子集；Rust 读 `pet.json` + `spritesheet` 并转 data URL 给前端（避免 dev 下的协议/权限问题）。

## 状态映射

| phase | 触发（session JSONL） | 动画 |
|---|---|---|
| `thinking` | `turn/start` / `step/start` / `tool/result` 之后 | row 7 `running` |
| `tool` | `tool/call`（shell/edit/web/read/agent/mcp） | running-right/left + running |
| `waiting` | `ask_user_question`、`approval/asked`（真正的审批/提问） | row 6 `waiting` |
| `done` | `turn/end completed`（8s 后回落 idle） | jumping → waving |
| `failed` | `turn/end` 的 error/blocked 等（15s 后回落） | row 5 `failed` |
| `idle` | 无活动 / 终态超时 | row 0 `idle` |

多会话按 `waiting > failed > tool > thinking > done > idle` 聚合。

## 宠物包（mod 的 L0）

搜索顺序（同 id 后者覆盖前者）：

1. `dsh-desktop-pet/pets/<id>/pet.json`
2. `$DSH_HOME/pets/<id>/pet.json`（与 DSH 桌宠生态共用）
3. `~/.dsh-desktop-pet/pets/<id>/pet.json`

字段（sprite2d 子集）：`id`、`displayName`、`license`、`renderer:"sprite2d"`、`sprite2d.spritesheetPath`、`cell`、`columns`、`atlasRows`、`frames`、`tracks.durations`、`sequences`、`remarks`。示例见 [`pets/dafeiyu/pet.json`](pets/dafeiyu/pet.json)；素材来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（素材允许开源使用、禁止商用），见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

行约定（Codex/DSH 生态一致）：

```
0 idle | 1 running-right | 2 running-left | 3 waving | 4 jumping
5 failed | 6 waiting | 7 running | 8 review
```

## 目录

```
src-tauri/          Rust 后端（窗口/托盘/hover 穿透/状态桥/pack 加载）
renderer/           共用前端（雪碧图动画/气泡/交互；bridge.js 适配 Tauri / Electron）
pets/dafeiyu/       默认宠物包「吃白饭的蓝色大肥鱼」（上游 WebM 抽帧 + 适配清单）
tools/              抽帧/图集生成、预览图、状态调试 CLI
legacy/electron/    最初验证 MVP 的 Electron 版（仅对照）
```

## Roadmap

- [x] Tauri 2 透明置顶窗 + 点击穿透（Rust 光标轮询）+ 拖拽/托盘 + 雪碧图
- [x] 只读 DSH JSONL 状态桥（thinking/tool/waiting/done/failed/idle）
- [ ] P1：DSH host 插件桥（`ctx.on('session/event')` + 本地带 token 的 WS/SSE），替换 JSONL 轮询；`pet-manifest-v2` 完整支持（frames2d / Live2D）
- [ ] P1：L1 行为包 `behavior.json`（事件→条件→动作，宿主解释执行），让非程序员也能写 mod
- [ ] P2：L3 代码 mod 沙箱 + 权限；release 打包/签名；Windows/Linux 适配；工坊分发

## 已知限制

- debug 构建 `.app` ~30MB；release 会更小但还没打（`npm run build:release`）。
- 状态来自 JSONL：~1s 延迟，看不到“审批弹窗刚弹出”这类未落盘 UI 状态。
- 目前只在 macOS 验证；Windows/Linux 的透明窗/置顶/点击穿透需要各自适配。
- 仅支持 sprite2d 宠物包；Live2D/frames2d 未接。
- 数据/配置写在项目 `.userdata/`（受 DSH 沙箱限制的临时方案），产品化应改用 `app_data_dir`。
