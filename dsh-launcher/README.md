# dsh-desktop-pet-launcher

DSH host 插件：**随 DSH 启动桌宠** + **把 DSH 会话状态/费用写到本地 state 文件**。

## 安装（DSH 桌面端）

1. DSH 左侧栏 → **插件** → **添加插件** → **本地目录**
2. 填：`/Users/wqian/Dev/dsh-desktop-pet/dsh-launcher`（或你 clone 后的路径）
3. 安装后启用，**完全退出 DSH 再打开**（插件层需要重启才组装）

> 更新插件代码后同样需要重启 DSH；本地目录是 link 安装，不需要重新 add。

## 启动/退出（默认关）

- 默认 `autoStart=false`：只写状态桥，**不拉起桌宠**
- 用户在桌宠托盘勾选「随 DSH 启动」→ `~/.dsh-desktop-pet/settings.json` 写 `autoStart: true` → **下次 DSH 启动**生效
- autoStart=true 时：DSH 启动加载插件 → spawn `DSH Pet.app/Contents/MacOS/dsh-desktop-pet`，注入 `DSH_PET_MANAGED=1`
- autoStart=true 且 DSH 退出/卸载插件 → 关掉由插件拉起的桌宠
- DSH 被强杀、dispose 没跑 → 桌宠的 `DSH_PET_MANAGED=1` 会轮询 DSH Helper 进程，不在就自己退出
- 桌宠已在运行时不重复拉起；`DSH_PET_APP` 可覆盖 .app 路径，`DSH_PET_AUTOSTART=1` 可临时强制开启

## 设置文件

```json
{ "autoStart": false, "icons": { "app": null, "tray": null } }
```

路径：`~/.dsh-desktop-pet/settings.json`。默认不存在 = `autoStart:false`，只做桥。

## 状态桥

订阅 `ctx.on('session/event')`，维护每个会话的 phase/tool/active，写：

```
~/.dsh-desktop-pet/state.json
```

桌宠 Rust 侧优先读这个文件（<30s 新鲜），bridge 不在时自动回退 JSONL。心跳每 10s 一次；写入 40ms 防抖，原子 rename。

字段与桌宠 `PetState` 一致：`phase`、`toolFamily`、`activeCount`、`sessions[]`、可选 `cost`、`updatedAt`。

## 费用

每轮 `turn/end` 调用 `ctx.get('sessionQuery').readSession(session.id)` 折叠整段日志，按事件时刻分高峰/空闲桶：

- 高峰：北京时间 周一至周五 09:00–12:00、14:00–18:00（法定节假日除外）
- 空闲价 = 高峰价 × 50%
- `deepseek-flash` 高峰价（元/百万 tokens）：缓存命中 0.04 / 未命中 2 / 输出 8
- 可用 `~/.dsh-desktop-pet/pricing.json` 覆盖（高峰价，空闲自动减半）

输出 `cost.lastTurn` 与 `cost.session`，气泡显示 `本轮 ¥x · 本会话 ¥y`。估算值，不是官方账单；子代理独立会话不计入。

## 手动测试

```bash
# 不装插件也能验证拉起/关闭（会真的启动桌宠）：
node -e "import('./index.js').then(m => m.apply({ on(){return()=>{}}, get(){}, effect(fn){ const d = fn(); console.log('running'); setTimeout(() => { d(); console.log('stopped') }, 3000) } }))"
```

## 配置

| 环境变量 | 作用 |
|---|---|
| `DSH_PET_APP` | 指定 `DSH Pet.app` 路径 |
| `DSH_PET_SKIP_LAUNCH=1` | 只写桥状态，不拉起桌宠（调试用） |
| `DSH_PET_DSH_PROC` | 桌宠 managed 模式检测 DSH 的 pgrep pattern |
