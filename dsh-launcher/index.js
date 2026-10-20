/**
 * DSH host 半侧：桌宠启动器 + 状态/费用桥。
 *
 * - DSH 启动加载本插件 → 拉起桌宠；DSH 退出/卸载 → 关掉桌宠。
 * - 订阅 `session/event`，把 phase/tool/usage 归一化后写 `~/.dsh-desktop-pet/state.json`，
 *   桌宠只读这个文件，不再每秒解压 DSH 的 session JSONL。
 * - 每轮 `turn/end` 时用 `sessionQuery.readSession()` 折叠整段会话日志，
 *   按模型/峰谷价算本轮 + 整段会话费用，一起写进 state.json。
 * - DSH 被强杀时桌宠带 DSH_PET_MANAGED=1 自己检测 DSH Helper 并退出。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-desktop-pet-launcher'
export const inject = ['webServer', 'connection']

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROJECT = path.resolve(HERE, '..')
const STATE_DIR = path.join(os.homedir(), '.dsh-desktop-pet')
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const SETTINGS_FILE = path.join(STATE_DIR, 'settings.json')
const ICON_DIR = path.join(STATE_DIR, 'icons')

const DEFAULT_PET_SETTINGS = {
  autoStart: true,
  showDockIcon: false,
  showTrayIcon: false,
  showBalance: true,
  showPrioritySessions: true,
  showCost: true,
  icons: { app: null, tray: null },
}

const APP_CANDIDATES = [
  process.env.DSH_PET_APP,
  path.join(PROJECT, 'src-tauri', 'target', 'release', 'bundle', 'macos', 'DSH Pet.app'),
  path.join(PROJECT, 'src-tauri', 'target', 'debug', 'bundle', 'macos', 'DSH Pet.app'),
  path.join(os.homedir(), 'Applications', 'DSH Pet.app'),
  '/Applications/DSH Pet.app',
].filter(Boolean)

/* ------------------------------------------------------------------ */
/* 启动器                                                             */
/* ------------------------------------------------------------------ */

function appBinary(appPath) {
  return path.join(appPath, 'Contents', 'MacOS', 'dsh-desktop-pet')
}

function findApp() {
  for (const candidate of APP_CANDIDATES) {
    try {
      if (existsSync(appBinary(candidate))) return candidate
    } catch {
      /* ignore */
    }
  }
  return null
}

function petRunning() {
  try {
    return spawnSync('/usr/bin/pgrep', ['-f', 'DSH Pet.app/Contents/MacOS/dsh-desktop-pet'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

function stopPet() {
  try {
    spawnSync('/usr/bin/pkill', ['-f', 'DSH Pet.app/Contents/MacOS/dsh-desktop-pet'], { stdio: 'ignore' })
  } catch {
    /* ignore */
  }
}

function readAutoStart() {
  if (process.env.DSH_PET_AUTOSTART === '0') return false
  if (process.env.DSH_PET_AUTOSTART === '1') return true
  try {
    const text = readFileSync(path.join(os.homedir(), '.dsh-desktop-pet', 'settings.json'), 'utf8')
    // 默认开启；只有显式 autoStart:false 才关闭。
    return JSON.parse(text).autoStart !== false
  } catch {
    return true
  }
}

function launchPet() {
  if (process.env.DSH_PET_SKIP_LAUNCH === '1') return false
  if (petRunning()) {
    console.log('[dsh-pet] pet already running')
    return false
  }
  const app = findApp()
  if (!app) {
    console.warn('[dsh-pet] 没找到 DSH Pet.app，设置 DSH_PET_APP 指向 .app 路径')
    return false
  }
  try {
    const env = { ...process.env, DSH_PET_MANAGED: '1' }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(appBinary(app), [], { env, stdio: 'ignore', detached: true })
    child.unref()
    console.log('[dsh-pet] launched', appBinary(app))
    return true
  } catch (err) {
    console.warn('[dsh-pet] launch failed:', err && err.message)
    return false
  }
}

/* ------------------------------------------------------------------ */
/* 峰谷 + 价目（元 / 百万 tokens；空闲价 = 高峰价 × 50%）                */
/* ------------------------------------------------------------------ */

const DEFAULT_PRICES = {
  'deepseek-flash': { cacheRead: 0.04, input: 2, output: 8 },
  'deepseek-v4-pro': { cacheRead: 0.3, input: 9, output: 27 },
  '*': { cacheRead: 0.04, input: 2, output: 8 },
}

/** 用户可在 ~/.dsh-desktop-pet/pricing.json 覆盖单价（元 / 百万 tokens，高峰价）。 */
const PRICE_TABLE = (() => {
  const merged = { ...DEFAULT_PRICES }
  try {
    const text = readFileSync(path.join(os.homedir(), '.dsh-desktop-pet', 'pricing.json'), 'utf8')
    const custom = JSON.parse(text)
    for (const [model, rate] of Object.entries(custom || {})) {
      if (!rate || typeof rate !== 'object') continue
      merged[model] = { ...(merged[model] || merged['*']), ...rate }
    }
  } catch {
    /* 没有自定义价目就用默认 */
  }
  return merged
})()

const HOLIDAY_RANGES_2026 = [
  ['2026-01-01', '2026-01-03'],
  ['2026-02-15', '2026-02-23'],
  ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'],
  ['2026-09-25', '2026-09-27'],
  ['2026-10-01', '2026-10-07'],
]

const HOLIDAYS = (() => {
  const set = new Set()
  const DAY = 86400000
  for (const [start, end] of HOLIDAY_RANGES_2026) {
    const from = Date.parse(start + 'T00:00:00Z')
    const to = Date.parse(end + 'T00:00:00Z')
    for (let t = from; t <= to; t += DAY) set.add(new Date(t).toISOString().slice(0, 10))
  }
  return set
})()

const BEIJING_OFFSET_MS = 8 * 3600 * 1000
const PEAK_WINDOWS = [[540, 720], [840, 1080]]

function bjParts(ms) {
  const d = new Date(ms + BEIJING_OFFSET_MS)
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hh: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    wd: d.getUTCDay(),
  }
}

/** 事件发生时刻是否高峰（北京时间 周一至周五 09:00–12:00 / 14:00–18:00，法定节假日除外）。 */
function isPeak(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return false
  const p = bjParts(ms)
  if (p.wd === 0 || p.wd === 6) return false
  const key = `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
  if (HOLIDAYS.has(key)) return false
  const minutes = p.hh * 60 + p.mi
  return PEAK_WINDOWS.some(([from, to]) => minutes >= from && minutes < to)
}

function rateOf(model) {
  return PRICE_TABLE[model] || PRICE_TABLE['*']
}

const zeroBuckets = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
const countOf = (v) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0)
const bucketsOf = (usage) => ({
  inputTokens: countOf(usage.inputTokens),
  outputTokens: countOf(usage.outputTokens),
  cacheReadTokens: countOf(usage.cacheReadTokens),
  cacheWriteTokens: countOf(usage.cacheWriteTokens),
})
const addBuckets = (a, b) => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
})
const subBuckets = (a, b) => ({
  inputTokens: Math.max(0, a.inputTokens - b.inputTokens),
  outputTokens: Math.max(0, a.outputTokens - b.outputTokens),
  cacheReadTokens: Math.max(0, a.cacheReadTokens - b.cacheReadTokens),
  cacheWriteTokens: Math.max(0, a.cacheWriteTokens - b.cacheWriteTokens),
})
const totalOf = (b) => b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens

function priceBuckets(buckets, model, peak) {
  const rate = rateOf(model)
  const factor = peak ? 1 : 0.5
  return (
    buckets.cacheReadTokens * rate.cacheRead +
    (buckets.inputTokens + buckets.cacheWriteTokens) * rate.input +
    buckets.outputTokens * rate.output
  ) * factor / 1000000
}

const roundYuan = (v) => Math.round(v * 10000) / 10000

function usageOf(event) {
  if (!event || !event.data) return undefined
  if (event.type === 'assistant/message') return event.data.usage
  if (event.type === 'assistant/attempt') return event.data.usage
  return undefined
}

/** 折叠一段会话事件，算本轮 + 整段会话费用。 */
function computeCostFromEvents(events, turn) {
  let provider = ''
  let model = ''
  let sessionCost = 0
  let sessionBuckets = zeroBuckets()
  let turnCost = 0
  let turnBuckets = zeroBuckets()
  let last = null
  let usageSteps = 0

  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    if (event.type === 'request/context') {
      if (typeof event.data?.provider === 'string') provider = event.data.provider
      if (typeof event.data?.model === 'string') model = event.data.model
      continue
    }
    if (event.type === 'request/header') {
      const config = event.data?.header?.config
      if (config && typeof config.provider === 'string') provider = config.provider
      if (config && typeof config.model === 'string') model = config.model
      continue
    }
    if (event.type === 'assistant/message' && typeof event.data?.message?.source?.model === 'string') {
      model = event.data.message.source.model
      if (typeof event.data.message.source.provider === 'string') provider = event.data.message.source.provider
    }
    const usage = usageOf(event)
    if (!usage) continue
    const eventTurn = typeof event.data.turn === 'number' ? event.data.turn : -1
    const step = typeof event.data.step === 'number' ? event.data.step : -1
    const peak = isPeak(event.time)
    const buckets = bucketsOf(usage)
    const cost = priceBuckets(buckets, model, peak)
    const isLastTurn = eventTurn === turn

    if (last !== null && last.turn === eventTurn && last.step === step) {
      sessionCost -= last.cost
      sessionBuckets = subBuckets(sessionBuckets, last.buckets)
      if (isLastTurn) {
        turnCost -= last.cost
        turnBuckets = subBuckets(turnBuckets, last.buckets)
      }
    } else {
      usageSteps += 1
    }
    last = { turn: eventTurn, step, buckets, cost, isLastTurn }
    sessionCost += cost
    sessionBuckets = addBuckets(sessionBuckets, buckets)
    if (isLastTurn) {
      turnCost += cost
      turnBuckets = addBuckets(turnBuckets, buckets)
    }
  }

  const pack = (cost, buckets, eventTurn) => ({
    turn: eventTurn,
    amount: roundYuan(cost),
    totalTokens: totalOf(buckets),
    inputTokens: buckets.inputTokens,
    outputTokens: buckets.outputTokens,
    cacheReadTokens: buckets.cacheReadTokens,
    cacheWriteTokens: buckets.cacheWriteTokens,
  })

  return {
    currency: 'CNY',
    provider,
    model,
    usageSteps,
    session: pack(sessionCost, sessionBuckets, null),
    lastTurn: pack(turnCost, turnBuckets, turn),
  }
}

/* ------------------------------------------------------------------ */
/* 状态桥                                                             */
/* ------------------------------------------------------------------ */

const PHASE_PRIORITY = {
  failed: 6,
  waiting: 5,
  tool: 4,
  thinking: 3,
  review: 2,
  done: 1,
  idle: 0,
}

function toolFamily(toolName) {
  const n = String(toolName || '').toLowerCase()
  if (n.startsWith('bash') || n.startsWith('shell') || n.startsWith('terminal') || n.startsWith('job_')) return 'shell'
  if (n.startsWith('write') || n.startsWith('edit') || n.startsWith('apply_patch')) return 'edit'
  if (n.startsWith('web_search') || n.startsWith('web_fetch') || n.startsWith('browser')) return 'web'
  if (n.startsWith('read') || n.startsWith('glob') || n.startsWith('grep')) return 'read'
  if (n.startsWith('spawn_teammate') || n.startsWith('team_task') || n.startsWith('todo_write')) return 'agent'
  return 'mcp'
}

function safeGet(ctx, name) {
  try {
    return ctx.get(name, false)
  } catch {
    return undefined
  }
}

function jsonResponse(res, code, value) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 8 * 1024 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function readPetSettings() {
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
    return {
      ...DEFAULT_PET_SETTINGS,
      ...parsed,
      icons: { ...DEFAULT_PET_SETTINGS.icons, ...(parsed.icons || {}) },
    }
  } catch {
    return structuredClone(DEFAULT_PET_SETTINGS)
  }
}

function writePetSettings(settings) {
  mkdirSync(STATE_DIR, { recursive: true })
  const temp = SETTINGS_FILE + '.tmp'
  writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n')
  renameSync(temp, SETTINGS_FILE)
}

function sanitizePetSettings(input) {
  const current = readPetSettings()
  const next = { ...current, icons: { ...current.icons } }
  for (const key of ['autoStart', 'showDockIcon', 'showTrayIcon', 'showBalance', 'showPrioritySessions', 'showCost']) {
    if (typeof input?.[key] === 'boolean') next[key] = input[key]
  }
  if (input?.icons && typeof input.icons === 'object') {
    for (const key of ['app', 'tray']) {
      const value = input.icons[key]
      if (value === null || typeof value === 'string') next.icons[key] = value
    }
  }
  return next
}

function petIconExists(kind) {
  return existsSync(path.join(ICON_DIR, `${kind}.png`))
}

function registerPetApi(ctx) {
  const web = safeGet(ctx, 'webServer')
  if (!web || typeof web.register !== 'function') {
    console.warn('[dsh-pet] webServer unavailable, settings section API disabled')
    return
  }
  const connection = safeGet(ctx, 'connection')
  const allow = (req) => {
    try {
      if (connection && typeof connection.requestRejection === 'function') {
        return !connection.requestRejection(req)
      }
      return true
    } catch {
      return false
    }
  }

  web.register({
    kind: 'exact',
    path: '/dsh-pet/api/settings',
    handler: async (req, res) => {
      if (!allow(req)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      if (req.method === 'GET') {
        return jsonResponse(res, 200, {
          ok: true,
          settings: readPetSettings(),
          icons: { app: petIconExists('app'), tray: petIconExists('tray') },
        })
      }
      if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false })
      try {
        const body = JSON.parse(await readBody(req))
        const next = sanitizePetSettings(body)
        writePetSettings(next)
        return jsonResponse(res, 200, { ok: true, settings: next })
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    },
  })

  web.register({
    kind: 'exact',
    path: '/dsh-pet/api/icon',
    handler: async (req, res) => {
      if (!allow(req)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false })
      try {
        const body = JSON.parse(await readBody(req))
        const kind = body?.kind
        if (kind !== 'app' && kind !== 'tray') return jsonResponse(res, 400, { ok: false, error: 'kind must be app or tray' })
        mkdirSync(ICON_DIR, { recursive: true })
        const target = path.join(ICON_DIR, `${kind}.png`)
        if (body.reset === true) {
          rmSync(target, { force: true })
          const settings = readPetSettings()
          settings.icons[kind] = null
          writePetSettings(settings)
          return jsonResponse(res, 200, { ok: true, icons: { app: petIconExists('app'), tray: petIconExists('tray') } })
        }
        const match = typeof body.dataUrl === 'string' && body.dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
        if (!match) return jsonResponse(res, 400, { ok: false, error: 'only PNG data URLs are accepted' })
        const bytes = Buffer.from(match[1], 'base64')
        if (bytes.length < 8 || bytes[0] !== 0x89 || bytes.toString('ascii', 1, 4) !== 'PNG') {
          return jsonResponse(res, 400, { ok: false, error: 'invalid PNG' })
        }
        if (bytes.length > 6 * 1024 * 1024) return jsonResponse(res, 413, { ok: false, error: 'icon too large (max 6MB)' })
        writeFileSync(target, bytes)
        const settings = readPetSettings()
        settings.icons[kind] = `icons/${kind}.png`
        writePetSettings(settings)
        return jsonResponse(res, 200, { ok: true, icons: { app: petIconExists('app'), tray: petIconExists('tray') } })
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    },
  })
}

export function apply(ctx) {
  let disposed = false
  let writeTimer = null
  let idleTimers = new Map()
  let costRequestToken = 0
  let account = { status: 'loading', updatedAt: Date.now() }
  let balancePromise = null
  let balanceTimer = null
  let balanceInitialTimer = null
  const sessions = new Map()

  function ensure(sessionId) {
    let session = sessions.get(sessionId)
    if (!session) {
      session = {
        id: sessionId,
        title: '',
        phase: 'idle',
        toolFamily: null,
        active: false,
        lastEventAt: 0,
        turn: 0,
        depth: 0,
        liveBuckets: zeroBuckets(),
        cost: null,
      }
      sessions.set(sessionId, session)
    }
    return session
  }

  function clearIdleTimer(session) {
    const timer = idleTimers.get(session.id)
    if (timer) clearTimeout(timer)
    idleTimers.delete(session.id)
  }

  function scheduleIdle(session, ms, expectedPhase) {
    clearIdleTimer(session)
    const timer = setTimeout(() => {
      idleTimers.delete(session.id)
      if (disposed) return
      if (session.phase === expectedPhase) {
        session.phase = 'idle'
        session.toolFamily = null
        scheduleWrite()
      }
    }, ms)
    timer.unref?.()
    idleTimers.set(session.id, timer)
  }

  async function refreshBalance() {
    if (balancePromise) return balancePromise
    balancePromise = (async () => {
      try {
        const service = safeGet(ctx, 'deepseekAccount')
        if (!service || typeof service.getBalance !== 'function') {
          account = { status: 'unavailable', updatedAt: Date.now() }
          return
        }
        const now = new Date()
        const result = await service.getBalance({
          version: '0.2.1-rc.2',
          locale: 'zh-CN',
          timezoneOffsetSeconds: -now.getTimezoneOffset() * 60,
        })
        if (!result) {
          account = { status: 'signed-out', updatedAt: Date.now() }
        } else if (result.status !== 'ready') {
          account = { status: 'failed', updatedAt: Date.now() }
        } else {
          account = {
            status: 'ready',
            wallets: result.value || [],
            bonusWallets: result.bonusWallets || [],
            updatedAt: Date.now(),
          }
        }
      } catch (err) {
        console.warn('[dsh-pet] balance failed:', err && err.message)
        account = { status: 'failed', updatedAt: Date.now() }
      } finally {
        balancePromise = null
        scheduleWrite()
      }
    })()
    return balancePromise
  }

  function snapshot(now) {
    const all = [...sessions.values()]
      .filter((session) => session.lastEventAt > 0)
      .map((session) => ({ ...session }))

    // 与 Rust 侧一致：非活跃终态按时间回落。
    for (const session of all) {
      const age = now - session.lastEventAt
      if (!session.active && session.phase === 'done' && age > 8000) session.phase = 'idle'
      if (!session.active && session.phase === 'failed' && age > 15000) session.phase = 'idle'
      if (!session.active && session.phase === 'thinking' && age > 15000) session.phase = 'idle'
    }

    all.sort((a, b) => {
      const p = (PHASE_PRIORITY[b.phase] ?? 0) - (PHASE_PRIORITY[a.phase] ?? 0)
      if (p !== 0) return p
      return b.lastEventAt - a.lastEventAt
    })

    const activeCount = all.filter((s) => s.active || s.phase === 'waiting' || s.phase === 'failed').length
    const display = all[0]
    const costs = all
      .map((s) => s.cost)
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))

    return {
      bridgeVersion: 1,
      phase: display ? display.phase : 'idle',
      toolFamily: display ? display.toolFamily : null,
      activeCount,
      sessions: all.slice(0, 8).map((s) => ({
        sessionId: s.id,
        title: s.title,
        phase: s.phase,
        toolFamily: s.toolFamily,
        active: s.active,
        lastEventAt: s.lastEventAt,
      })),
      ...(costs.length ? { cost: costs[0] } : {}),
      account,
      updatedAt: now,
    }
  }

  function writeNow() {
    if (disposed) return
    if (writeTimer) {
      clearTimeout(writeTimer)
      writeTimer = null
    }
    try {
      mkdirSync(STATE_DIR, { recursive: true })
      const target = snapshot(Date.now())
      const temp = STATE_FILE + '.tmp'
      writeFileSync(temp, JSON.stringify(target))
      renameSync(temp, STATE_FILE)
    } catch (err) {
      console.warn('[dsh-pet] write state failed:', err && err.message)
    }
  }

  function scheduleWrite() {
    if (disposed || writeTimer) return
    writeTimer = setTimeout(() => {
      writeTimer = null
      writeNow()
    }, 40)
    writeTimer.unref?.()
  }

  async function computeCost(session, turn, at) {
    // 子代理是独立会话/独立计费，不覆盖主会话的费用气泡。
    if (session.depth > 0) return
    const token = ++costRequestToken
    let result = null
    const query = safeGet(ctx, 'sessionQuery')
    if (query && typeof query.readSession === 'function') {
      try {
        const log = await query.readSession(session.id)
        const events = log && Array.isArray(log.events) ? log.events : []
        if (events.length) result = computeCostFromEvents(events, turn)
      } catch (err) {
        console.warn('[dsh-pet] readSession failed:', err && err.message)
      }
    }
    if (!result) {
      // 读不到日志时用插件启动后实时累计的用量兜底（金额来自当前模型/时段）。
      const buckets = session.liveBuckets || zeroBuckets()
      const model = session.lastModel || ''
      const peak = isPeak(at)
      const amount = roundYuan(priceBuckets(buckets, model, peak))
      result = {
        currency: 'CNY',
        provider: '',
        model,
        usageSteps: 1,
        session: { turn: null, amount, totalTokens: totalOf(buckets), ...buckets },
        lastTurn: { turn, amount, totalTokens: totalOf(buckets), ...buckets },
      }
    }
    if (disposed || token !== costRequestToken) return
    session.cost = {
      ...result,
      sessionId: session.id,
      at: at || Date.now(),
      updatedAt: Date.now(),
    }
    scheduleWrite()
  }

  function onSessionEvent(session, event) {
    if (disposed || !session || typeof session.id !== 'string' || !event) return
    const data = event.data || {}
    const at = typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : Date.now()
    const view = ensure(session.id)
    try {
      const titleService = safeGet(ctx, 'sessionTitle')
      const snapshot = titleService && typeof titleService.get === 'function' ? titleService.get(session) : undefined
      if (snapshot && typeof snapshot.title === 'string' && snapshot.title) view.title = snapshot.title
    } catch {
      /* title 服务不可用时忽略 */
    }
    const depth = session.header?.delegationDepth
    if (typeof depth === 'number' && Number.isFinite(depth)) view.depth = depth
    view.lastEventAt = at

    switch (event.type) {
      case 'session/title':
        if (typeof data.title === 'string') view.title = data.title
        break
      case 'turn/start':
        view.active = true
        view.turn = typeof data.turn === 'number' ? data.turn : view.turn
        view.phase = 'thinking'
        view.toolFamily = null
        view.liveBuckets = zeroBuckets()
        clearIdleTimer(view)
        break
      case 'assistant/message': {
        const usage = data.usage
        if (usage && typeof usage === 'object') {
          view.liveBuckets = addBuckets(view.liveBuckets || zeroBuckets(), bucketsOf(usage))
          if (typeof data.message?.source?.model === 'string') view.lastModel = data.message.source.model
        }
        view.phase = view.active ? 'thinking' : 'idle'
        view.toolFamily = null
        break
      }
      case 'tool/call': {
        const toolName = typeof data.name === 'string' ? data.name : 'tool'
        view.active = true
        view.phase = toolName === 'ask_user_question' ? 'waiting' : 'tool'
        view.toolFamily = toolFamily(toolName)
        break
      }
      case 'tool/result':
      case 'step/end':
        if (view.active) {
          view.phase = 'thinking'
          view.toolFamily = null
        }
        break
      case 'approval/asked':
        view.phase = 'waiting'
        view.toolFamily = null
        break
      case 'approval/decided':
        view.phase = view.active ? 'thinking' : 'idle'
        view.toolFamily = null
        break
      case 'turn/end': {
        const kind = data.reason && data.reason.kind
        view.active = false
        view.toolFamily = null
        view.phase = kind === 'completed' ? 'done' : 'failed'
        const turn = typeof data.turn === 'number' ? data.turn : view.turn
        scheduleIdle(view, view.phase === 'done' ? 8000 : 15000, view.phase)
        computeCost(view, turn, at)
        refreshBalance()
        break
      }
      default:
        break
    }
    scheduleWrite()
  }

  // —— 启动桌宠 + 注册桥 ——
  try {
    const autoStart = readAutoStart()
    if (autoStart) {
      launchPet()
    } else {
      console.log('[dsh-pet] autoStart=false, bridge only（右键桌宠或托盘里打开「随 DSH 启动」后下次 DSH 生效）')
    }

    const stopListening = ctx.on('session/event', onSessionEvent)
    writeNow()
    try {
      registerPetApi(ctx)
    } catch (err) {
      console.warn('[dsh-pet] settings api disabled:', err && err.message)
    }
    // 心跳：state.json 保持新鲜，桌宠据此判断 bridge 是否还活着。
    const heartbeat = setInterval(() => scheduleWrite(), 10000)
    heartbeat.unref?.()
    balanceInitialTimer = setTimeout(() => refreshBalance(), 1200)
    balanceInitialTimer.unref?.()
    balanceTimer = setInterval(() => refreshBalance(), 60000)
    balanceTimer.unref?.()
    console.log('[dsh-pet] bridge ready:', STATE_FILE)
    ctx.effect(() => () => {
      disposed = true
      costRequestToken += 1
      try {
        if (typeof stopListening === 'function') stopListening()
      } catch {
        /* ignore */
      }
      clearInterval(heartbeat)
      if (balanceTimer) clearInterval(balanceTimer)
      if (balanceInitialTimer) clearTimeout(balanceInitialTimer)
      for (const timer of idleTimers.values()) clearTimeout(timer)
      idleTimers.clear()
      if (writeTimer) clearTimeout(writeTimer)
      writeTimer = null
      try {
        rmSync(STATE_FILE, { force: true })
      } catch {
        /* ignore */
      }
      if (autoStart) stopPet()
    })
  } catch (err) {
    console.warn('[dsh-pet] bridge disabled:', err && err.message)
  }
}
