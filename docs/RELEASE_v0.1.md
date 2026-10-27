# DSH Desktop Pet v0.1

首个公开 beta。一个真正跑在 macOS 桌面上的 DSH 桌宠：读取 DSH 会话/工具状态，显示余额和本轮/本会话费用，支持互动、托盘/右键菜单，以及可热切换的宠物形象包。

## 下载

- **推荐** `DSH-Desktop-Pet-v0.1.0-macos-arm64.pkg`（双击安装，自动装 app + 形象 + DSH 插件）
- 备用 `DSH-Desktop-Pet-v0.1.0-macos-arm64.zip`（含 app、pets、插件、安装器）
- 两者都附 SHA256
- 仅 **Apple Silicon / macOS**；未签名/未公证的开发者 beta。

## 包含

- `DSH Pet.app`：Tauri 2 桌面宠物（透明、置顶、点击穿透、Dock/菜单栏图标默认隐藏）
- `pets/`：7 个自带形象（dafeiyu / jingjing / whale-pixel / dpsk-girl / yuexinmiao / shenshen / snowball-red-scarf）
- `dsh-launcher/`：DSH 插件（自动启动、状态/费用/余额桥、DSH 设置 → 桌宠 页面）
- `docs/`：宠物包规范、行为 schema、测试清单、安装说明
- `install-guide.html`：可在浏览器打开的交互式首装向导
- `Install DSH Pet.command`：双击式安装器（自动处理 Gatekeeper、装插件、重启 DSH）
- `skills/create-dsh-pet/`：给 Codex/DSH/Claude 等 agent 的桌宠生成 skill

## 安装

看 `INSTALL.md`；简版：

1. **推荐**：双击 `.pkg` → 输入密码 → 点「安装」；安装器会自动放好 app/形象/插件并重启 DSH
2. 备用：解压 zip，双击 `Install DSH Pet.command`，按提示点两次「继续」
3. 手动：DSH → 插件 → 本地目录 → 选 `dsh-launcher/` → 启用，完全退出 DSH 再打开
4. 首次启动如果被 Gatekeeper 拦，右键 `DSH Pet.app` → 打开

## 已知限制

- 未签名 / 未公证：Gatekeeper 会提示；需要右键打开
- 仅 arm64，Intel / Windows / Linux 未打包
- 费用/余额依赖 DSH 的 `sessionQuery` / `deepseekAccount` 服务；未登录/离线时对应气泡不可用，其他功能正常
- 形象包素材许可各自独立，见包内 `LICENSE` / `NOTICE.md`；`dafeiyu`/`shenshen` 非商业，其余注意角色/IP 权利
- 这是 beta，请保留 `bash scripts/doctor.sh` 的输出方便反馈
