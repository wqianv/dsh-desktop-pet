'use strict'

/**
 * dsh-desktop-pet — 真正的 OS 桌面宠物（Electron 透明置顶窗）。
 *
 * 第一版目标：
 *  - 独立于 DSH 窗口：透明、无边框、置顶、skipTaskbar、不抢焦点；
 *  - 点击穿透：默认整窗 setIgnoreMouseEvents(true, { forward: true })，
 *    渲染端检测到指针进入宠物/气泡区域后再切回可交互；
 *  - 状态源：只读 tail DSH 的 session JSONL（$DSH_HOME/sessions/**.jsonl.zstd），
 *    归一化成 idle / thinking / tool / waiting / review / done / failed；
 *  - 内容：pet-manifest-v2 兼容的 pet pack（sprite2d 图集），为后续社区 mod 留接口。
 *
 * 运行：npm start
 */

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, shell, protocol, net } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { pathToFileURL } = require('node:url')

const { DshStateWatcher } = require('../../src/dsh-state')
const { loadPacks, findPack } = require('../../src/pet-pack')

const APP_DIR = require('node:path').resolve(__dirname, '..', '..')
const HOME = os.homedir()
// 开发期把数据写在项目内，避免受 DSH 文件沙箱限制；产品化时可切回 app.getPath('userData')。
const DATA_DIR = path.join(APP_DIR, '.userdata')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const LOG_PATH = path.join(APP_DIR, 'pet.log')

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`
  try {
    fs.mkdirSync(APP_DIR, { recursive: true })
    fs.appendFileSync(LOG_PATH, line + '\n')
  } catch {
    /* ignore */
  }
  console.log(line)
}

process.on('uncaughtException', (err) => log('[fatal]', err && err.stack ? err.stack : String(err)))

// 开发环境可能受沙箱限制：把 Electron 的 userData/cache 放进项目目录，避免写 ~/Library。
try {
  app.setPath('userData', path.join(APP_DIR, '.userdata'))
} catch {
  /* ignore */
}

const DEFAULT_CONFIG = {
  packId: 'whale',
  size: 190,
  x: null,
  y: null,
  visible: true,
  dshUrl: 'http://127.0.0.1:62065',
}

const DEFAULT_FRAMES = [6, 8, 8, 4, 5, 8, 6, 6, 6]

let win = null
let tray = null
let packs = []
let config = null
let watcher = null
let dragState = null
let lastState = { phase: 'idle', sessions: [] }

protocol.registerSchemesAsPrivileged([
  { scheme: 'pet', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    return { ...DEFAULT_CONFIG, ...raw }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function saveConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  } catch (err) {
    console.error('[pet] save config failed:', err.message)
  }
}

function windowSize(size) {
  // 宠物按 192:208 比例；留出气泡与拖拽余量
  const w = Math.round(size * (192 / 208)) + 96
  const h = size + 120
  return { width: Math.max(160, w), height: Math.max(200, h) }
}

function defaultPosition(size) {
  // 放到“鼠标所在的那块屏”的右下角，避免多屏时跑到主屏而用户看不到。
  const point = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(point)
  const area = display.workArea
  const { width, height } = windowSize(size)
  return { x: area.x + area.width - width - 24, y: area.y + area.height - height - 16 }
}

function createWindow() {
  const { width, height } = windowSize(config.size)
  let pos = { x: config.x, y: config.y }
  if (pos.x == null || pos.y == null) pos = defaultPosition(config.size)
  {
    // 位置兜底：确保窗口至少有一部分在可见工作区内。
    const area = screen.getDisplayNearestPoint({ x: pos.x, y: pos.y }).workArea
    if (pos.x < area.x - width + 40 || pos.x > area.x + area.width - 40) pos.x = area.x + area.width - width - 24
    if (pos.y < area.y - height + 40 || pos.y > area.y + area.height - 40) pos.y = area.y + area.height - height - 16
  }

  win = new BrowserWindow({
    width,
    height,
    x: pos.x,
    y: pos.y,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    fullscreenable: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on('context-menu', (event) => event.preventDefault())

  // 默认整窗点击穿透；渲染端 hover 到宠物区域时才切回可交互。
  win.setIgnoreMouseEvents(true, { forward: true })

  if (process.argv.includes('--dev')) {
    win.webContents.on('console-message', (_event, _level, message) => {
      console.log('[renderer]', message)
    })
    win.webContents.on('did-fail-load', (_event, code, description) => {
      console.error('[renderer] did-fail-load', code, description)
    })
  }

  win.loadFile(path.join(APP_DIR, 'renderer', 'index.html'))
  win.once('ready-to-show', () => {
    if (!config.visible) return
    // 首帧用 show() 保证窗口真的被 order front（showInactive 在部分 macOS 场景下不亮）。
    win.show()
    win.setAlwaysOnTop(true, 'screen-saver')
    log('[window] shown', JSON.stringify(win.getBounds()), 'visible=', win.isVisible(), 'top=', win.isAlwaysOnTop())
  })
  // 透明窗在个别平台上 ready-to-show 不稳定，兜底再 show 一次。
  setTimeout(() => {
    if (!win || win.isDestroyed()) return
    if (config.visible && !win.isVisible()) win.show()
  }, 1200)
  win.on('closed', () => {
    win = null
  })
}

/* ------------------------------------------------------------------ */
/* pet:// 静态资源协议：把 pack 目录里的素材安全地暴露给渲染端          */
/* ------------------------------------------------------------------ */

function registerPetProtocol() {
  protocol.handle('pet', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'pets') return new Response('unknown route', { status: 404 })
      const segments = url.pathname.split('/').filter(Boolean)
      const packId = decodeURIComponent(segments.shift() || '')
      const pack = findPack(packs, packId)
      if (!pack) return new Response('unknown pack', { status: 404 })
      const rel = segments.map((s) => decodeURIComponent(s)).join('/')
      const abs = path.resolve(pack.dir, rel)
      const root = path.resolve(pack.dir)
      if (abs !== root && !abs.startsWith(root + path.sep)) {
        return new Response('forbidden', { status: 403 })
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return new Response('not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(abs).toString())
    } catch (err) {
      return new Response(`bad request: ${err.message}`, { status: 400 })
    }
  })
}

/* ------------------------------------------------------------------ */
/* 托盘                                                               */
/* ------------------------------------------------------------------ */

function createTray() {
  const iconPath = path.join(APP_DIR, 'assets', 'trayTemplate.png')
  let image = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') image.setTemplateImage(true)
  tray = new Tray(image)
  tray.setToolTip('DSH 桌宠')
  const rebuild = () => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: config.visible ? '隐藏桌宠' : '显示桌宠',
          click: () => {
            config.visible = !config.visible
            saveConfig()
            if (config.visible) win && win.showInactive()
            else win && win.hide()
            rebuild()
          },
        },
        { label: '重载宠物包', click: () => reloadPacks() },
        { label: '打开 DSH', click: () => shell.openExternal(config.dshUrl) },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ])
    )
  }
  rebuild()
  tray.on('click', () => {
    if (!win) return
    if (config.visible) win.hide()
    else win.showInactive()
    config.visible = !config.visible
    saveConfig()
    rebuild()
  })
}

function activePackId() {
  return config ? config.packId : null
}

function reloadPacks() {
  packs = loadPacks(APP_DIR)
  if (win && !win.isDestroyed()) {
    win.webContents.send('pet:packs', packs.map(publicPack))
  }
  return packs.map(publicPack)
}

function publicPack(pack) {
  return { id: pack.id, dir: pack.dir, manifest: pack.manifest }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                */
/* ------------------------------------------------------------------ */

function setupIpc() {
  ipcMain.handle('pet:get-bootstrap', () => ({
    config,
    packs: packs.map(publicPack),
    state: lastState,
    isDev: process.argv.includes('--dev'),
  }))

  ipcMain.handle('pet:reload-packs', () => reloadPacks())

  ipcMain.on('pet:set-ignore-mouse', (event, ignore) => {
    if (!win || win.isDestroyed()) return
    win.setIgnoreMouseEvents(!!ignore, { forward: true })
  })

  ipcMain.on('pet:drag-start', (event, point) => {
    if (!win || win.isDestroyed()) return
    const [x, y] = win.getPosition()
    dragState = {
      offsetX: point.screenX - x,
      offsetY: point.screenY - y,
      lastX: x,
      lastY: y,
    }
  })

  ipcMain.on('pet:drag-move', (event, point) => {
    if (!win || win.isDestroyed() || !dragState) return
    const x = Math.round(point.screenX - dragState.offsetX)
    const y = Math.round(point.screenY - dragState.offsetY)
    dragState.lastX = x
    dragState.lastY = y
    win.setPosition(x, y)
  })

  ipcMain.on('pet:drag-end', () => {
    if (!win || win.isDestroyed() || !dragState) return
    const [x, y] = win.getPosition()
    config.x = x
    config.y = y
    saveConfig()
    dragState = null
  })

  ipcMain.on('pet:show-context-menu', () => {
    if (!win) return
    Menu.buildFromTemplate([
      {
        label: '点击反应（调试）',
        click: () => win.webContents.send('pet:reaction', { kind: 'click' }),
      },
      { label: '重载宠物包', click: () => reloadPacks() },
      {
        label: config.visible ? '隐藏' : '显示',
        click: () => {
          config.visible = !config.visible
          saveConfig()
          if (config.visible) win.showInactive()
          else win.hide()
        },
      },
      { label: '打开 DSH', click: () => shell.openExternal(config.dshUrl) },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]).popup({ window: win })
  })

  ipcMain.on('pet:open-dsh', () => shell.openExternal(config.dshUrl))
  ipcMain.on('pet:quit', () => app.quit())
  ipcMain.on('pet:hide', () => {
    if (!win) return
    config.visible = false
    saveConfig()
    win.hide()
  })
}

/* ------------------------------------------------------------------ */
/* 启动                                                               */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) win.showInactive()
  })

  app.whenReady().then(() => {
    app.setName('DSH 桌宠')
    log('[boot] ready, appPath=', app.getAppPath())

    config = readConfig()
    packs = loadPacks(APP_DIR)
    if (!findPack(packs, config.packId) && packs[0]) config.packId = packs[0].id
    registerPetProtocol()
    setupIpc()
    createWindow()
    createTray()

    if (process.argv.includes('--diagnose')) {
      setTimeout(() => {
        try {
          console.log('[diagnose]', JSON.stringify({
            visible: win.isVisible(),
            alwaysOnTop: win.isAlwaysOnTop(),
            bounds: win.getBounds(),
            workArea: screen.getPrimaryDisplay().workArea,
            pack: activePackId(),
            state: lastState.phase,
            stateSessions: (lastState.sessions || []).length,
          }))
        } catch (err) {
          console.error('[diagnose] failed', err.message)
        }
        app.quit()
      }, 2600)
    }

    const screenshotArg = process.argv.find((arg) => arg.startsWith('--screenshot='))
    if (screenshotArg) {
      const target = screenshotArg.slice('--screenshot='.length)
      setTimeout(async () => {
        try {
          const image = await win.webContents.capturePage()
          fs.writeFileSync(target, image.toPNG())
          console.log('[pet] screenshot written:', target)
        } catch (err) {
          console.error('[pet] screenshot failed:', err.message)
        }
        if (process.argv.includes('--screenshot-exit')) app.quit()
      }, 2200)
    }

    watcher = new DshStateWatcher({
      intervalMs: 1000,
      onChange: (state) => {
        log('[state]', state.phase, 'sessions=', (state.sessions || []).length)
        lastState = state
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send('pet:state', state)
        }
        if (tray) tray.setToolTip(`DSH 桌宠 · ${state.phase}${state.activeCount ? ` (${state.activeCount})` : ''}`)
      },
    })
    watcher.start()
  })

  app.on('window-all-closed', () => {
    // 桌宠是托盘应用：所有窗口关闭也不退出（macOS 惯例）。
    if (process.platform !== 'darwin') { /* 保持运行，由托盘退出 */ }
  })

  app.on('before-quit', () => {
    if (watcher) watcher.stop()
    if (tray) tray.destroy()
  })
}
