'use strict'

/**
 * Tauri 2 的 webview 没有 preload；这里用 withGlobalTauri 暴露的 __TAURI__ 造出
 * 与 Electron 版一致的 window.petAPI 接口，renderer.js 不需要改两套。
 *
 * 负责的事：
 *  - invoke 后端命令（bootstrap / drag / hide / quit / reload）
 *  - 监听后端推送的 pet:state 事件
 *  - 点击穿透由 Rust 侧轮询光标位置统一管理（managedHover），前端不再自己切
 */
;(function () {
  if (window.petAPI) return // Electron preload 已经注入
  const T = window.__TAURI__
  if (!T || !T.core) return

  const invoke = T.core.invoke
  const listen = T.event ? T.event.listen : null

  window.petAPI = {
    nativeDrag: true,
    managedHover: true,

    getBootstrap: () => invoke('bootstrap'),

    getSettings: () => invoke('get_settings'),

    setOverlayLayout(totalHeight, panelTop, panelHeight) {
      return invoke('set_overlay_layout', { totalHeight, panelTop, panelHeight })
    },

    ackSession(sessionId) {
      return invoke('ack_session', { sessionId })
    },

    setPack(packId) {
      return invoke('set_pack', { packId })
    },

    onPack(callback) {
      if (listen) {
        listen('pet:pack', (event) => callback(event.payload)).catch(() => {})
      }
    },

    onWalk(callback) {
      if (listen) {
        listen('pet:walk', (event) => callback(event.payload)).catch(() => {})
      }
    },

    onSettings(callback) {
      if (listen) {
        listen('pet:settings', (event) => callback(event.payload)).catch(() => {})
      }
    },

    onState(callback) {
      // 双保险：事件推送（若 capability 允许）+ 600ms 轮询（不依赖事件权限）。
      if (listen) {
        listen('pet:state', (event) => callback(event.payload)).catch(() => {})
      }
      const timer = setInterval(() => {
        invoke('poll_state').then(callback).catch(() => {})
      }, 3000)
      return () => clearInterval(timer)
    },

    onPacks() {
      return () => {}
    },

    onReaction() {
      return () => {}
    },

    setIgnoreMouse() {
      // Rust 侧按光标位置自动切换 click-through
    },

    dragStart() {
      invoke('start_drag').catch(() => {})
    },

    dragMove() {},

    dragEnd() {},

    showContextMenu() {
      invoke('show_context_menu').catch((e) => {
        if (this.log) this.log(`context menu failed: ${e}`)
      })
    },

    reloadPacks() {
      return invoke('reload_packs')
    },

    openDsh() {
      invoke('open_dsh').catch(() => {})
    },

    hide() {
      invoke('hide_pet').catch(() => {})
    },

    quit() {
      invoke('quit_app').catch(() => {})
    },

    log(message) {
      invoke('frontend_log', { message: String(message) }).catch(() => {})
    },
  }

  invoke('frontend_ready', {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
  }).catch(() => {})
})()
