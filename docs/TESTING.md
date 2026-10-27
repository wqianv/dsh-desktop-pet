# 测试与给别人使用前的检查

分三层：**自动化静态检查 → 本机干净环境 smoke → 另一台 Mac / 另一个 macOS 用户的 beta**。

## 1. 自动化（每次改完都跑）

```bash
bash scripts/smoke-test.sh          # pack 校验 + JS 语法 + cargo check
bash scripts/smoke-test.sh --app    # 再用临时 HOME 启动一次真正桌宠并检查日志
```

`--app` 做的事：

- 创建临时 `HOME`（不碰真实配置）
- 用 `DSH_PET_LOG` / `DSH_PET_CONFIG` 隔离日志和配置
- 启动 debug `.app`，等 `frontend ready` 和 `sprite loaded`
- 自动关闭并清理临时目录

CI 在 `.github/workflows/ci.yml`：`validate-pet-pack --all` + JS `node --check` + `cargo check`（macOS runner）。

## 2. 干净环境 smoke（模拟新用户）

在一台**没有本项目历史状态**的环境里做：

1. 全新 clone 仓库（或干净目录），确认没有 `~/.dsh-desktop-pet/`、没有旧插件
2. `npm install && npm run build`
3. DSH → 设置 → 插件 → 添加插件 → 本地目录 → 仓库里的 `dsh-launcher/`
4. 启用插件，**完全退出 DSH 再打开**
5. 预期：
   - 桌宠自动出现（settings 默认 `autoStart:true`）
   - DSH 设置 → 桌宠 页面能打开
   - 设置 → 形象 能看到仓库自带的 pack
   - 切形象约 1 秒生效，不重启
   - 改当前 pack 的 `pet.json` / 图集 / `behavior.json`，约 1 秒热重载
   - 光标移到宠物上可点/拖，移开穿透
   - 一轮对话结束后有费用气泡；登录账户时显示余额
6. 退出 DSH → 桌宠应被关掉；再开 DSH → 应自动拉起
7. 强制退出 DSH（kill）→ 桌宠应在几秒内自己退出
8. 首次启动时如果桌宠已手动运行 → DSH 启动不应把它杀掉且不留空窗（v0.7.1 的 5 秒兜底）

## 3. 边界矩阵

| 场景 | 操作 | 预期 |
|---|---|---|
| 无账户 / 未登录 | 关闭 DSH 登录或断网 | 余额显示未登录/不可用；费用/状态/动画不受影响 |
| 无 DSH 会话 | 刚启动，不发消息 | 桌宠 idle，不崩溃 |
| 当前 pack 被删除 | 切到 pack 后删目录 | 2 秒内回落上一有效 pack，设置修复 |
| 非法 pack | 缺图集/尺寸错/alpha 缺失 | `validate-pet-pack.py` 报错；DSH 列表可刷新但加载失败回退 |
| 图标 | 上传 Dock/菜单栏 PNG，恢复默认 | 1 秒内应用；重启仍保留 |
| 新 pack | 往 `~/.dsh-desktop-pet/pets/<id>/` 放目录 | 设置页刷新后可选，热加载 |
| 多 pack 快速切换 | 连续切 5 次 | 不崩、不残留旧图集 |
| 高负载 | Agent 连续跑工具 | CPU idle 低；状态实时（桥 <1s） |
| 多显示器 | 拖到另一块屏 | 不跑到屏幕外；托盘“移到当前屏幕” |
| Retina / 缩放 | 在 Retina 屏（dpr=2）启动/换屏 | 宠物完整显示，头顶/左右不裁切；窗口逻辑尺寸 280×320 左右 |
| 非前台拖动 | 切到 Finder/其他 app，直接按住桌宠拖动 | 第一次按下就能拖，不需要先点一下激活 |
| DSH 重启时宠物在跑 | 手动开着宠物重启 DSH | 不出现空窗（5 秒兜底拉起） |

## 3.5 Release 构建检查

```bash
export RUSTUP_HOME=... CARGO_HOME=... PATH=...
node_modules/.bin/tauri build --bundles app
# 产物：src-tauri/target/release/bundle/macos/DSH Pet.app
```

本机 0.8.0 已验证 release `.app` 可启动（11.19 MiB，sprite/behavior 正常加载）。未签名/未公证，Gatekeeper 仍会拦；这是对外分发前必须补的。

## 4. Beta（真给别人用）

至少找一台**另一台 Mac** / 另一个 macOS 用户：

1. 按 README 的构建步骤装依赖：rustup、Xcode CLT、Node 20+
2. 只给仓库链接 + `AGENTS.md` / 安装说明，不口头补步骤
3. 让对方完整走一遍“构建 → 装插件 → 重启 → 切形象 → 改 pack → 卸载”
4. 收对方的 `bash scripts/doctor.sh` 输出（环境、profile、settings、日志）
5. 记录：构建耗时、失败点、是否有 Gatekeeper 提示、CPU/内存感受

## 5. 给别人“正常用”还缺的发布项

当前版本仍是**开发者版**，新用户需要自己编译。真正对外分发前还要做：

- [x] `npm run build:release` 产出 release `.app`（本机 0.8.0 验证：11.19 MiB，可直接启动）
- [ ] 代码签名 + notarization（否则 Gatekeeper 会拦）
- [ ] 提供 release 下载 / 安装说明（不要求用户装 Rust）
- [ ] 插件安装可以继续用 DSH 的本地目录，或发布 npm/GitHub release
- [ ] 卸载说明：停用插件、退出桌宠、删除 `~/.dsh-desktop-pet/`
- [ ] 在 macOS 14/15/26、Apple Silicon/Intel 上各跑一遍
- [ ] Windows/Linux 目前未适配（Tauri 透明窗/点击穿透需要单独实现）

在这些完成前，“给别人测试”请明确标注为 **beta / 需要自己构建**。

## 6. 出问题怎么收信息

```bash
bash scripts/doctor.sh
```

会打印系统、DSH profile、插件、settings、pack 列表、最近日志；把输出和 `~/Library/Logs/DeepSeek Harness/crash-*.log` 一起发即可，不会上传任何数据。
