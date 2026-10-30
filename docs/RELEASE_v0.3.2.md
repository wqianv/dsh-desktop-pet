# DSH Desktop Pet v0.3.2

点击桌宠会话面板里的某条消息，直接跳到 DSH 对应的会话。

## 新增

- 会话面板每行可点击：
  - 点击某条会话 → 自动激活 DSH 并打开对应会话
  - 鼠标悬停有提示
  - 行末的清除按钮仍只清提醒，不会触发跳转
- 实现方式：
  - 桌宠写入本机 pending 请求
  - DSH 插件客户端轮询后调用 `uiWorkspace.openSession(sessionId)`
  - 不依赖 DSH 的 URL 路由

## 下载

- **推荐** `DSH-Desktop-Pet-v0.3.2-macos-arm64.pkg`
- 备用 `DSH-Desktop-Pet-v0.3.2-macos-arm64.zip`

直接覆盖升级 v0.3.1；安装器会重启 DSH，让 host/client 插件都更新。

## 已知限制

- 未签名/未公证：第一次仍要右键打开
- 仅 Apple Silicon（arm64）
- 仍是非商业 beta
