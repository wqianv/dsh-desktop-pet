# 安装（macOS）

> 当前是 **v0.1** 开发者 beta；应用未使用 Apple Developer ID 签名/公证。首次打开如果被 Gatekeeper 拦住，右键 `DSH Pet.app` → 打开；或在确认来源可信后执行：
>
> ```bash
> xattr -dr com.apple.quarantine "/path/to/DSH-Desktop-Pet-v0.1.0-macos-arm64/DSH Pet.app"
> ```

## 1. 放置

把整个解压目录放到一个**固定位置**，例如：

```
~/Applications/DSH-Desktop-Pet-v0.1.0-macos-arm64/
├── DSH Pet.app
├── pets/
├── dsh-launcher/
└── ...
```

不要只把 `.app` 单独挪走——`pets/`、`dsh-launcher/` 和 app 是配套的。

## 2. 安装 DSH 插件

1. DSH 左侧栏 → **插件** → **添加插件** → **本地目录**
2. 选择解压目录里的 `dsh-launcher/`
3. 安装后 **立即启用**
4. **完全退出 DSH 再打开**

插件会用同一目录里的 `DSH Pet.app` 启动桌宠；DSH 退出/强杀时桌宠也会退出。

## 3. 使用

- 桌宠默认出现在当前屏幕右下角；Dock/菜单栏图标默认隐藏
- 右键桌宠 → **设置 / 自定义图标 / 更换形象 / 打开 DSH 窗口 / 退出**
- **DSH 设置 → 桌宠**：显示开关、图标、形象选择
- 形象：`DSH 设置 → 桌宠 → 形象`；新增 pack 放到 `~/.dsh-desktop-pet/pets/`

## 4. 卸载

1. DSH 插件页停用/移除 `dsh-desktop-pet-launcher`
2. 完全退出 DSH
3. 退出桌宠（右键 → 退出）
4. 可选清理：`rm -rf ~/.dsh-desktop-pet`
