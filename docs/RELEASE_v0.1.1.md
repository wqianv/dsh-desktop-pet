# DSH Desktop Pet v0.1.1

v0.1 的修复/升级包，可以直接覆盖安装 v0.1，不需要先卸载。

## 下载

- **推荐** `DSH-Desktop-Pet-v0.1.1-macos-arm64.pkg`
  - 双击 → 输入密码 → 点「安装」，作为升级覆盖旧版本
  - 自动更新 `/Applications/DSH Pet.app`、内置形象和 DSH 插件
- 备用 `DSH-Desktop-Pet-v0.1.1-macos-arm64.zip`

## 修复

- **Retina 屏裁切**：之前窗口用物理像素当逻辑像素，dpr=2 的 MacBook 上 CSS 视口只有一半，宠物头顶和左右会被裁掉。现在改用 LogicalSize，Retina 上完整显示。
- 安装器不再使用错误的 JavaScript `installation-check`（v0.1 的 pkg 打开会报「评估软件包的 JavaScript 时发生错误」）。

## 安装/升级

1. 下载 `.pkg`
2. 关闭/保存 DSH 里手头的东西（安装器会退出并重启 DSH）
3. 双击 pkg；第一次被 Gatekeeper 拦就右键 → 打开
4. 输入密码 → 安装
5. 安装器覆盖旧 app/插件并重启 DSH，桌宠自动出现

安装器会把版本更新为 0.1.1；如果 Installer 认为没有可升级内容，已修复的 v0.1.1 包也会覆盖写入。

## 已知限制

- 未签名/未公证：第一次仍要右键打开
- 仅 Apple Silicon（arm64）
- 仍是非商业 beta；形象素材许可见包内 LICENSE / NOTICE
