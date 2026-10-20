'use strict'

/**
 * DSH 会话状态只读观察器（原型阶段，零侵入）。
 *
 * DSH 把每个会话的事件写成 append-only 的 zstd 压缩 JSONL：
 *   $DSH_HOME/sessions/<workspace>/<session>/session.v4.jsonl.zstd
 * 我们用 `zstd -dc`（macOS/Linux 自带或可安装）或纯 JS 的 fzstd 解压，
 * 读取其中 turn/step/tool 等事件，归一化成桌宠可以消费的 phase。
 *
 * 优点：不需要装 DSH 插件、不改任何配置，DSH 桌面/Web 都适用。
 * 局限：轮询（1s）、只能看到已落盘事件、拿不到“审批弹窗”这类纯 UI 状态；
 *       后续产品版应改为 host 插件（ctx.on('session/event') + 本地 WS/SSE）。
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

const PHASE_PRIORITY = {
  idle: 0,
  done: 1,
  review: 2,
  thinking: 3,
  tool: 4,
  waiting: 5,
  failed: 6,
}

const FAMILY = [
  [/^(bash|shell|terminal|job_|subprocess)/i, 'shell'],
  [/^(write|edit|apply_patch|file_|fs_)/i, 'edit'],
  [/^(web_search|web_fetch|browser)/i, 'web'],
  [/^(read|glob|grep|list_|find_)/i, 'read'],
  [/^(spawn_teammate|team_task|send_message|interrupt_agent|wait_agent|todo_write)/i, 'agent'],
]

function toolFamily(name) {
  for (const [re, family] of FAMILY) if (re.test(String(name || ''))) return family
  return 'mcp'
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function decodeZstd(file) {
  // 1) 优先用系统 zstd：能正确处理 append-only 的“多 frame 串联”文件
  if (!process.env.DSH_PET_NO_SYSTEM_ZSTD) {
    try {
      return execFileSync('zstd', ['-dc', file], { maxBuffer: 256 * 1024 * 1024 })
    } catch {
      /* fall through */
    }
  }
  // 2) 纯 JS 兜底（fzstd 可解析 concatenated frames）
  try {
    const { decompress } = require('fzstd')
    return Buffer.from(decompress(fs.readFileSync(file)))
  } catch {
    return null
  }
}

function listSessionFiles(root) {
  const out = []
  let workspaces = []
  try {
    workspaces = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return out
  }
  for (const ws of workspaces) {
    const wsDir = path.join(root, ws.name)
    let sessions = []
    try {
      sessions = fs.readdirSync(wsDir, { withFileTypes: true }).filter((d) => d.isDirectory())
    } catch {
      continue
    }
    for (const s of sessions) {
      const file = path.join(wsDir, s.name, 'session.v4.jsonl.zstd')
      try {
        const st = fs.statSync(file)
        out.push({ file, sessionId: s.name, workspace: ws.name, mtimeMs: st.mtimeMs, size: st.size })
      } catch {
        /* no session file in this dir */
      }
    }
  }
  return out
}

function readEvents(file) {
  const buf = decodeZstd(file)
  if (!buf || buf.length === 0) return []
  const events = []
  for (const line of buf.toString('utf8').split('\n')) {
    const text = line.trim()
    if (!text) continue
    try {
      events.push(JSON.parse(text))
    } catch {
      /* 正在追加的半行 */
    }
  }
  return events
}

function reduceSession(sessionId, events, now = Date.now()) {
  let active = false
  let phase = 'idle'
  let tool = null
  let lastEventAt = 0
  let title = ''

  for (const ev of events) {
    const type = ev && ev.type
    const data = (ev && ev.data) || {}
    const ts = Number(ev && ev.time) || lastEventAt
    if (!type) continue

    if (type === 'session/title' && typeof data.title === 'string') {
      title = data.title
    } else if (type === 'turn/start') {
      active = true
      phase = 'thinking'
      tool = null
      lastEventAt = ts
    } else if (type === 'step/start') {
      if (active) phase = 'thinking'
      lastEventAt = ts
    } else if (type === 'tool/call') {
      if (active) {
        tool = data.name || null
        phase = data.name === 'ask_user_question' ? 'waiting' : 'tool'
      }
      lastEventAt = ts
    } else if (type === 'tool/result') {
      if (active) {
        phase = 'thinking'
        tool = null
      }
      lastEventAt = ts
    } else if (type === 'step/end') {
      if (active) phase = 'thinking'
      lastEventAt = ts
    } else if (type === 'turn/end') {
      const kind = data.reason && data.reason.kind
      active = false
      tool = null
      phase = kind === 'completed' ? 'done' : kind === 'blocked' ? 'waiting' : 'failed'
      lastEventAt = ts
    } else if (typeof type === 'string' && type.startsWith('approval/')) {
      phase = 'waiting'
      lastEventAt = ts
    } else if (type === 'user/message') {
      if (!active) phase = 'idle'
      lastEventAt = ts
    }
  }

  // 终态是瞬时的：success/error 展示几秒后回到 idle。
  if (!active && phase === 'done' && now - lastEventAt > 8000) phase = 'idle'
  if (!active && phase === 'failed' && now - lastEventAt > 15000) phase = 'idle'
  // 长时间没有新事件的“活动”会话视为 idle，避免桌宠永远卡在思考态。
  if (active && lastEventAt > 0 && now - lastEventAt > 120000) {
    active = false
    phase = 'idle'
    tool = null
  }
  if (!active && phase === 'thinking' && now - lastEventAt > 15000) phase = 'idle'

  return {
    sessionId,
    title,
    phase,
    tool,
    toolFamily: tool ? toolFamily(tool) : null,
    active,
    lastEventAt,
  }
}

class DshStateWatcher {
  constructor({ intervalMs = 1000, onChange = null, maxSessions = 8 } = {}) {
    this.intervalMs = intervalMs
    this.onChange = onChange
    this.maxSessions = maxSessions
    this.timer = null
    this.cache = new Map() // file -> { mtimeMs, size, state }
    this.lastSerialized = ''
    this.last = { phase: 'idle', sessions: [], activeCount: 0, updatedAt: 0 }
  }

  start() {
    if (this.timer) return
    this.tick()
    this.timer = setInterval(() => this.tick(), this.intervalMs)
    if (this.timer.unref) this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  tick() {
    const root = path.join(dshHome(), 'sessions')
    const files = listSessionFiles(root)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, this.maxSessions)

    const now = Date.now()
    const sessions = []
    for (const meta of files) {
      // 太旧的会话不参与（避免历史会话把状态拉回 done/failed）
      if (now - meta.mtimeMs > 30 * 60 * 1000) continue
      const cached = this.cache.get(meta.file)
      let state
      if (cached && cached.mtimeMs === meta.mtimeMs && cached.size === meta.size) {
        state = { ...cached.state }
      } else {
        const events = readEvents(meta.file)
        state = events.length ? reduceSession(meta.sessionId, events, now) : null
        if (state) this.cache.set(meta.file, { mtimeMs: meta.mtimeMs, size: meta.size, state })
      }
      if (!state) continue
      // 让“刚结束”的终态在缓存命中时也能按时回落
      if (!state.active && state.phase === 'done' && now - state.lastEventAt > 8000) state = { ...state, phase: 'idle' }
      if (!state.active && state.phase === 'failed' && now - state.lastEventAt > 15000) state = { ...state, phase: 'idle' }
      sessions.push({ ...state, mtimeMs: meta.mtimeMs, workspace: meta.workspace })
    }

    sessions.sort((a, b) => {
      const p = (PHASE_PRIORITY[b.phase] || 0) - (PHASE_PRIORITY[a.phase] || 0)
      if (p !== 0) return p
      return b.lastEventAt - a.lastEventAt
    })

    const display = sessions[0] || null
    const activeCount = sessions.filter((s) => s.active || s.phase === 'waiting' || s.phase === 'failed').length
    const next = {
      phase: display ? display.phase : 'idle',
      tool: display ? display.tool : null,
      toolFamily: display ? display.toolFamily : null,
      displaySessionId: display ? display.sessionId : null,
      displayTitle: display ? display.title : '',
      activeCount,
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        phase: s.phase,
        active: s.active,
        toolFamily: s.toolFamily,
        lastEventAt: s.lastEventAt,
      })),
      updatedAt: now,
    }

    // updatedAt 每个 tick 都会变，不能参与“状态是否变化”的判断，否则会每秒刷一次。
    const fingerprint = JSON.stringify({ ...next, updatedAt: 0 })
    this.last = next
    if (fingerprint !== this.lastSerialized) {
      this.lastSerialized = fingerprint
      if (this.onChange) this.onChange(next)
    }
  }
}

module.exports = { DshStateWatcher, toolFamily, reduceSession, decodeZstd, readEvents, listSessionFiles }
