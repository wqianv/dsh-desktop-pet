# DSH 桌宠 · 首次安装与使用指南（macOS）

> 适用版本：**v0.1.2 beta**（Apple Silicon / arm64）
>
> 这是一个「装在 macOS 桌面上的桌宠」，不是 DSH 窗口里的挂件。  
> **推荐下载 `.pkg` 安装包**：双击 → 安装，安装器会自动放好 app、形象、DSH 插件并重启 DSH。  
> 如果下载的是 zip，则按下面的「备用方案」手动安装。

---

## 最推荐：双击 `.pkg` 安装包

下载：

```
DSH-Desktop-Pet-v0.1.2-macos-arm64.pkg
```

1. **双击** pkg。
2. 如果 macOS 提示「无法验证开发者」：右键 pkg → **打开**（只需要第一次）。
3. 输入 Mac 登录密码，点 **安装**。
4. 安装器会自动：
   - 把桌宠装到 `/Applications/DSH Pet.app`
   - 把自带形象和插件装到 `/Library/Application Support/DSH Desktop Pet/`
   - 把插件装进当前用户的 DSH `desktop` profile 并启用
   - 重启 DSH，桌宠自动出现

装完打开 **DSH 设置 → 桌宠** 验收即可。  
如果安装器提示找不到 DSH，先打开一次 DSH 完成初始化，再重新运行 pkg。

---

## 备用：zip + 双击一次安装器

如果你下载的是 zip（或者 pkg 被系统策略拦住），解压后找到：

```
Install DSH Pet.command
```

**双击它**（如果 macOS 拦住，右键 → 打开），然后按提示点两次「继续」。安装器会自动：

1. 放行并打开一次桌宠（过 Gatekeeper）
2. 退出 DSH
3. 把 `dsh-launcher` 插件装进 DSH `desktop` profile
4. 重新打开 DSH，桌宠自动出现

装完回到本页第 4 步验收即可。  
下面的手动步骤是安装器失败时的备用方案，也可以用来理解每一步在做什么。

> 安装器只会修改 DSH profile / 本机桌宠目录；不上传数据。它会调用 DSH 自带的命令行工具，所以需要先打开过一次 DSH。

---

## 开始前，先确认

- [ ] 你是 **Apple Silicon（M1/M2/M3/M4）Mac**
- [ ] 已经安装并登录 **DeepSeek Harness（DSH）**
- [ ] 下载了 `DSH-Desktop-Pet-v0.1.2-macos-arm64.pkg`，或 `.zip`
- [ ] 如果用 zip：知道解压后的文件夹放在哪（建议 `~/Applications`）

> 不需要安装 Rust / Xcode / Node——这是给普通用户的安装包。  
> 如果你拿到的是源码仓库，请先看 README 的「从源码构建」。

---

## 第 1 步：解压，并放到固定位置

双击 zip 解压，会得到一个文件夹：

```
DSH-Desktop-Pet-v0.1.2-macos-arm64/
├── DSH Pet.app          ← 桌宠本体
├── pets/                ← 自带形象
├── dsh-launcher/        ← DSH 插件
├── INSTALL.md           ← 本说明
├── install-guide.html   ← 图文版安装引导
└── ...
```

把整个文件夹拖到一个**以后不会随手删的位置**，例如：

```
~/Applications/DSH-Desktop-Pet-v0.1.2-macos-arm64/
```

✅ **检查点**：文件夹里有 `DSH Pet.app`、`pets`、`dsh-launcher` 三样东西。  
⚠️ **不要只把 `DSH Pet.app` 单独拖到桌面或 /Applications**——它需要和 `pets/`、`dsh-launcher/` 待在一起。

---

## 第 2 步：第一次打开桌宠，过 Gatekeeper

v0.1 还没有 Apple 签名/公证，macOS 第一次会拦住它。**只需要处理一次。**

### 方法 A：右键打开（推荐）

1. 在 Finder 里找到 `DSH Pet.app`
2. **右键（或 Control + 点击）** → **打开**
3. 弹窗里点 **打开**
4. 看到桌宠出现，先不用管它，继续下一步

### 方法 B：系统设置里放行

如果右键打开仍被拦：

1. 打开 **系统设置 → 隐私与安全性**
2. 页面底部会出现 `DSH Pet.app` 被阻止的提示
3. 点 **仍要打开** → 输入密码确认

### 方法 C：终端命令（确认来源可信再用）

```bash
xattr -dr com.apple.quarantine \
  "$HOME/Applications/DSH-Desktop-Pet-v0.1.2-macos-arm64/DSH Pet.app"
open "$HOME/Applications/DSH-Desktop-Pet-v0.1.2-macos-arm64/DSH Pet.app"
```

✅ **检查点**：能看到一只桌宠出现在屏幕右下角。  
⚠️ 这一步是临时的：以后正式签名/公证后会消失。  
💡 **如果桌宠已经出现，先右键它 → 退出**，避免和接下来插件的自动启动打架。

---

## 第 3 步：给 DSH 装插件（只装一次）

1. 打开 **DSH**
2. 进入 **设置 → 插件**（左侧栏有「插件」入口）
3. 点 **添加插件**
4. 选择 **本地目录 / Local directory**
5. 选中解压文件夹里的 **`dsh-launcher` 文件夹**
   - 是里面的 `dsh-launcher`，不是它的上一级
6. 安装完成后，确认插件 **已启用**
7. **完全退出 DSH**：`Cmd + Q`，不是只关窗口
8. 重新打开 DSH

✅ **检查点**：
- 桌宠几秒内出现在桌面右下角
- DSH 设置里多出 **「桌宠」** 页面
- 这个页面里能看到显示开关、图标、形象选择

> 如果 DSH 插件页里找不到「本地目录」，检查 DSH 是否为支持插件的版本；旧版 DSH 可能不支持本地插件。

---

## 第 4 步：确认一切正常

打开 **DSH 设置 → 桌宠**，试着操作一遍：

| 操作 | 预期 |
|---|---|
| 切换「显示 Dock 图标」 | Dock 图标出现/消失 |
| 切换「显示菜单栏图标」 | 菜单栏图标出现/消失 |
| 点「选择 PNG…」选一张图 | 桌宠/菜单栏图标 1 秒内变化 |
| 打开「形象」下拉 | 能看到 7 个自带形象 |
| 选另一个形象 | 约 1 秒热切换，不重启 |

再试桌宠本身：

- 鼠标移上去 → 可以点击/拖动
- 鼠标移开 → 点击穿透到后面的窗口
- 右键桌宠 → 菜单：更换形象 / 设置 / 自定义图标 / 打开 DSH / 退出
- 发一条消息 → 桌宠会随着思考、调用工具、等待确认、完成切换动画
- 完成一轮对话 → 出现费用气泡
- 登录 DSH 账户时 → 气泡/菜单里显示余额

✅ **检查点**：以上都正常，安装完成。

---

## 第 5 步：添加自己的形象（可选）

有两个办法：

### 用 DSH 设置页

1. 把新的宠物包目录放到：

```
~/.dsh-desktop-pet/pets/<id>/
```

2. 回到 **DSH 设置 → 桌宠 → 形象**
3. 点 **刷新**
4. 下拉选择新形象

### 用右键菜单

右键桌宠 → **更换形象** → 选一个。

宠物包格式见 `docs/PET_PACK_SPEC.md`；也可以把 `skills/create-dsh-pet/SKILL.md` 交给 Codex / DSH agent，让它帮你做一个。

---

## 常见问题

### 1. DSH 起来了，但桌宠没出现

依次检查：

1. 插件是否启用？（DSH 设置 → 插件）
2. 是否**完全退出并重启**过 DSH？
3. 安装时选的是不是 `dsh-launcher` 文件夹？
4. 第 2 步是否完成过？未签名的 app 第一次可能被 Gatekeeper 挡住，插件拉不起来。
5. 手动打开一次 `DSH Pet.app`，看是否报错。
6. 运行排障脚本（在解压目录里）：

```bash
bash scripts/doctor.sh
```

### 2. 双击 app 提示「无法打开，因为无法验证开发者」

回到第 2 步：右键 → 打开，或系统设置 → 隐私与安全性 → 仍要打开。  
这是 v0.1.2 未公证导致的，正式签名版不会有。

### 3. DSH 设置里没有「桌宠」页面

- 确认插件已启用
- 完全退出 DSH 再开
- 确认安装的是 `dsh-launcher`，不是仓库根目录

### 4. 点击桌宠没反应 / 挡住鼠标

- 鼠标悬停在桌宠身上时才可交互；移开即点击穿透
- 如果卡住，右键 → 退出，然后重启 DSH

### 5. 有桌宠，但没有费用/余额

- 费用需要 DSH 正常产生会话事件；开一轮对话后再看
- 余额需要在 DSH 登录 DeepSeek 账户
- 未登录/离线时其余动画和互动不受影响

### 6. 想卸载

**用 pkg 安装的：**

1. DSH → 插件 → 停用/移除 `dsh-desktop-pet-launcher`
2. 完全退出 DSH
3. 右键桌宠 → 退出
4. 删除 `/Applications/DSH Pet.app` 和 `/Library/Application Support/DSH Desktop Pet/`
5. 可选清理用户数据：

**用 zip 安装的：**

1. DSH → 插件 → 停用/移除 `dsh-desktop-pet-launcher`
2. 完全退出 DSH
3. 右键桌宠 → 退出
4. 删除解压文件夹
5. 可选清理用户数据：

```bash
rm -rf ~/.dsh-desktop-pet
```

---

## 一句话流程

```
解压到固定目录
  → 右键 DSH Pet.app → 打开（只第一次）
  → DSH 设置 → 插件 → 本地目录 → 选 dsh-launcher → 启用
  → 完全退出 DSH 再打开
  → 桌宠自动出现
```

有问题把 `bash scripts/doctor.sh` 的输出和 `~/Library/Logs/DeepSeek Harness/crash-*.log` 一起发回即可。
