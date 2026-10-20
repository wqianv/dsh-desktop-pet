# dsh-desktop-pet-launcher

让独立桌宠 `DSH Pet.app` 跟着 DeepSeek Harness 一起启动/退出。

## 安装（DSH 桌面端）

1. DSH 左侧栏 → **插件** → **添加插件** → **本地目录**
2. 填：`/Users/wqian/Dev/dsh-desktop-pet/dsh-launcher`（或你 clone 后的路径）
3. 安装后启用，**完全退出 DSH 再打开**（插件层需要重启才组装）

## 行为

- DSH 启动加载插件 → 直接 spawn `DSH Pet.app/Contents/MacOS/dsh-desktop-pet`，并注入 `DSH_PET_MANAGED=1`
- DSH 退出/卸载插件 → `pkill -f "DSH Pet.app/Contents/MacOS/dsh-desktop-pet"`（安装前手动跑的实例也会被接管关闭）
- DSH 被强杀、dispose 没跑 → 桌宠带 `DSH_PET_MANAGED=1` 启动，会轮询 DSH 进程，不在就自己退出
- 桌宠已在运行时不重复拉起（第一次安装后建议托盘退出一次再重启 DSH）；`DSH_PET_APP` 可覆盖 .app 路径

## 手动测试插件逻辑

```bash
# 不装插件也能验证“拉起/关闭”：
node -e "import('./index.js').then(m => m.apply({ effect(fn){ const d = fn(); console.log('running'); setTimeout(() => { d(); console.log('stopped') }, 3000) } }))"
```
