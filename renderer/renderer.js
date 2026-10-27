'use strict'

/**
 * 渲染端：行为配置驱动的雪碧图动画 + 气泡 + 命中检测/拖拽 + 点击/挂机互动。
 * 只依赖 preload 暴露的 window.petAPI，不直接碰 Node/Electron。
 *
 * 行为来自 pet pack 的 behavior.json（Rust 会合并到 manifest.behavior）；
 * 没有 behavior.json 的旧 pack 会回退到内置 DEFAULT_BEHAVIOR。
 */

const DEFAULT_BEHAVIOR = {
  animations: {
    idle: { row: 0 },
    'walk-right': { row: 1 },
    'walk-left': { row: 2 },
    wave: { row: 3 },
    jump: { row: 4 },
    sad: { row: 5 },
    wait: { row: 6 },
    work: { row: 7 },
    think: { row: 8 },
  },
  phases: {
    idle: { animation: 'idle' },
    thinking: { animation: 'think' },
    tool: { animation: 'work' },
    waiting: { animation: 'wait' },
    review: { animation: 'think' },
    done: { sequence: ['jump', 'wave', 'idle'] },
    failed: { sequence: ['sad', 'wait', 'idle'] },
  },
  bubbles: {
    thinking: ['思考中…'],
    waiting: ['等你确认…'],
    review: ['检查中…'],
    done: ['搞定！'],
    failed: ['出错了…'],
  },
  toolLabels: {
    shell: '跑命令中…',
    edit: '改代码中…',
    web: '查资料中…',
    read: '读文件…',
    agent: '调度子代理…',
    mcp: '调工具中…',
  },
  interactions: {
    click: { animations: ['wave'], bubbles: ['嗯哼～'] },
    drag: null,
    idleActions: [],
  },
  cost: null,
}

const LOOPING_PHASES = new Set(['idle', 'thinking', 'tool', 'waiting', 'review'])
const DEFAULT_FRAME_MS = 150

const petEl = document.getElementById('pet')
const bubbleEl = document.getElementById('bubble')
const debugEl = document.getElementById('debug')
const sessionsEl = document.getElementById('sessions')
const sessionListEl = document.getElementById('sessionList')
const sessionCountEl = document.getElementById('sessionCount')
const sessionsToggleBtn = document.getElementById('sessionsToggle')
const sessionBarEl = document.getElementById('sessionBar')
const sessionToastEl = document.getElementById('sessionToast')
const sessionsClearBtn = document.getElementById('sessionsClear')

let bootstrap = null
let packs = []
let activePack = null
let behavior = DEFAULT_BEHAVIOR
let state = { phase: 'idle', activeCount: 0, toolFamily: null }
let displaySettings = { showBalance: true, showPrioritySessions: true, showCost: true }
let frameTimer = null
let playToken = 0
let bubbleTimer = null
let currentPhase = null
let interactive = false
const nativeDrag = !!(window.petAPI && window.petAPI.nativeDrag)
const managedHover = !!(window.petAPI && window.petAPI.managedHover)
let pointerDown = null
let pointerMoved = false
let dragging = false
let interactionActive = false
let dragAnim = false
let idleTimers = []
const idlePlayed = new Set()
let lastCostAt = 0
let externalWalk = false
const SESSION_MODE_KEY = 'dsh-pet-session-panel-mode'
let sessionPanelMode = 'expanded'
try {
  const stored = localStorage.getItem(SESSION_MODE_KEY)
  if (stored === 'collapsed' || stored === 'expanded') sessionPanelMode = stored
  else if (stored === 'hidden') sessionPanelMode = 'collapsed'
} catch {}
const sessionAcks = new Map()
let lastOverlayLayout = ''

/* ------------------------------------------------------------------ */
/* 工具函数                                                           */
/* ------------------------------------------------------------------ */

function pick(list) {
  if (!Array.isArray(list) || list.length === 0) return null
  return list[Math.floor(Math.random() * list.length)]
}

function escapeForUrlPath(p) {
  return String(p)
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function packById(id) {
  return packs.find((p) => p.id === id) || null
}

function setPetSize(px) {
  const size = Math.max(80, Math.min(260, Number(px) || 190))
  document.documentElement.style.setProperty('--pet-size', `${size}px`)
}

function compactTokens(n) {
  const value = Number(n) || 0
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${Math.round(value / 100) / 10}K`
  return `${Math.round(value / 100_000) / 10}M`
}

function formatAmount(amount, currency) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—'
  const symbol = currency === 'USD' ? '$' : '¥'
  const digits = Math.abs(amount) < 0.01 ? 4 : Math.abs(amount) < 1 ? 3 : 2
  return symbol + amount.toFixed(digits)
}

function normalizeBehavior(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const merged = {
    ...DEFAULT_BEHAVIOR,
    ...source,
    animations: { ...DEFAULT_BEHAVIOR.animations, ...(source.animations || {}) },
    phases: { ...DEFAULT_BEHAVIOR.phases, ...(source.phases || {}) },
    bubbles: { ...DEFAULT_BEHAVIOR.bubbles, ...(source.bubbles || {}) },
    toolLabels: { ...DEFAULT_BEHAVIOR.toolLabels, ...(source.toolLabels || {}) },
    interactions: { ...DEFAULT_BEHAVIOR.interactions, ...(source.interactions || {}) },
  }
  return merged
}

/* ------------------------------------------------------------------ */
/* 动画                                                               */
/* ------------------------------------------------------------------ */

function setFrame(row, column) {
  if (!activePack) return
  const { columns, atlasRows } = activePack.manifest
  const x = columns > 1 ? (column / (columns - 1)) * 100 : 0
  const y = atlasRows > 1 ? (row / (atlasRows - 1)) * 100 : 0
  petEl.style.backgroundSize = `${columns * 100}% ${atlasRows * 100}%`
  petEl.style.backgroundPosition = `${x}% ${y}%`
}

function animationFrames(id) {
  const spec = behavior.animations[id]
  if (!activePack || !spec || typeof spec.row !== 'number') return []
  const manifest = activePack.manifest
  const count = Math.max(1, Number(spec.frames) || Number(manifest.frames && manifest.frames[spec.row]) || 6)
  const fromSpec = Array.isArray(spec.durations) && spec.durations.length ? spec.durations : null
  const fromManifest = manifest.tracks && manifest.tracks[id] && Array.isArray(manifest.tracks[id].durations)
    ? manifest.tracks[id].durations
    : null
  const durations = fromSpec || fromManifest || []
  return Array.from({ length: count }, (_, i) => ({
    row: spec.row,
    column: i,
    duration: Number(durations[i % Math.max(1, durations.length)]) || DEFAULT_FRAME_MS,
  }))
}

function stopFrames() {
  playToken += 1
  if (frameTimer) clearTimeout(frameTimer)
  frameTimer = null
}

function playAnimation(id, options) {
  const opts = options || {}
  const frames = animationFrames(id)
  if (!frames.length) {
    if (opts.onDone) opts.onDone()
    return
  }
  stopFrames()
  const token = playToken
  let index = 0
  const tick = () => {
    if (token !== playToken) return
    if (index >= frames.length) {
      if (opts.loop) {
        index = 0
      } else {
        frameTimer = null
        if (opts.onDone) opts.onDone()
        return
      }
    }
    const frame = frames[index]
    index += 1
    setFrame(frame.row, frame.column)
    frameTimer = setTimeout(tick, frame.duration)
  }
  tick()
}

function playSequence(ids, options) {
  const opts = options || {}
  if (!Array.isArray(ids) || ids.length === 0) {
    if (opts.onDone) opts.onDone()
    return
  }
  let index = 0
  const next = () => {
    if (index >= ids.length) {
      if (opts.loop) {
        index = 0
      } else {
        if (opts.onDone) opts.onDone()
        return
      }
    }
    const id = ids[index]
    index += 1
    playAnimation(id, { loop: false, onDone: next })
  }
  next()
}

function phaseSpec(phase) {
  return behavior.phases[phase] || DEFAULT_BEHAVIOR.phases[phase] || { animation: 'idle' }
}

function playPhase(phase) {
  if (!activePack) return
  stopFrames()
  currentPhase = phase
  const spec = phaseSpec(phase)
  const sequence = Array.isArray(spec.sequence) && spec.sequence.length
    ? spec.sequence
    : [spec.animation || 'idle']
  const looping = LOOPING_PHASES.has(phase)
  if (looping && sequence.length === 1) {
    playAnimation(sequence[0], { loop: true })
    return
  }
  playSequence(sequence, {
    loop: looping,
    onDone: () => {
      if (!looping) playPhase('idle')
    },
  })
}

/* ------------------------------------------------------------------ */
/* 气泡                                                               */
/* ------------------------------------------------------------------ */

function hideBubble() {
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = null
  bubbleEl.hidden = true
  bubbleEl.textContent = ''
  if (sessionToastEl) {
    sessionToastEl.hidden = true
    sessionToastEl.textContent = ''
    if (sessionsEl && !sessionsEl.hidden) scheduleOverlayHeight()
  }
}

function showBubble(text, ttlMs) {
  if (!text) {
    hideBubble()
    return
  }
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = null
  // 面板可见时，把气泡收纳进面板内部，避免和标题/状态行重叠。
  if (sessionsEl && !sessionsEl.hidden) {
    bubbleEl.hidden = true
    bubbleEl.textContent = ''
    if (sessionPanelMode === 'expanded' && sessionToastEl) {
      sessionToastEl.hidden = false
      sessionToastEl.textContent = text
      scheduleOverlayHeight()
    } else if (sessionToastEl) {
      sessionToastEl.hidden = true
      sessionToastEl.textContent = ''
    }
  } else {
    if (sessionToastEl) {
      sessionToastEl.hidden = true
      sessionToastEl.textContent = ''
    }
    bubbleEl.hidden = false
    bubbleEl.textContent = text
  }
  if (ttlMs > 0) bubbleTimer = setTimeout(hideBubble, ttlMs)
}

function prioritySessions() {
  const sessions = Array.isArray(state.sessions) ? state.sessions : []
  return sessions.filter((session) => session.phase === 'waiting' || session.phase === 'failed')
}

function balanceText() {
  const account = state && state.account
  if (!account || account.status !== 'ready') return ''
  let cny = 0
  let usd = 0
  for (const key of ['wallets', 'bonusWallets']) {
    const wallets = Array.isArray(account[key]) ? account[key] : []
    for (const wallet of wallets) {
      const amount = Number.parseFloat(wallet && wallet.balance)
      if (!Number.isFinite(amount)) continue
      if (wallet.currency === 'CNY') cny += amount
      if (wallet.currency === 'USD') usd += amount
    }
  }
  if (cny > 0 || usd === 0) return `余额 ¥${cny.toFixed(2)}`
  return `余额 $${usd.toFixed(2)}`
}

function displayExtras() {
  const parts = []
  if (displaySettings.showBalance) {
    const text = balanceText()
    if (text) parts.push(text)
  }
  if (displaySettings.showPrioritySessions) {
    const count = prioritySessions().length
    if (count > 0) parts.push(`高优 ${count}`)
  }
  return parts
}

function withExtras(text) {
  const extras = displayExtras()
  return extras.length ? `${text} · ${extras.join(' · ')}` : text
}

function bubbleTextForPhase(current) {
  const phase = current.phase || 'idle'
  if (phase === 'tool') {
    return behavior.toolLabels[current.toolFamily] || '干活中…'
  }
  const options = behavior.bubbles[phase]
  if (Array.isArray(options) && options.length) return pick(options)
  return ''
}

function showBubbleForPhase(current) {
  if (interactionActive || dragAnim) return
  const text = withExtras(bubbleTextForPhase(current))
  if (!text) {
    hideBubble()
    return
  }
  const suffix = Number(current.activeCount) > 1 ? ` · ${current.activeCount} 会话` : ''
  const persistent = current.phase === 'waiting'
  showBubble(text + suffix, persistent ? 0 : 3800)
}

function formatCost(cost) {
  const template = (behavior.cost && behavior.cost.template) || '本轮 {lastAmount} · 本会话 {sessionAmount}'
  const last = cost.lastTurn || {}
  const session = cost.session || {}
  return template
    .replaceAll('{lastAmount}', formatAmount(last.amount, cost.currency))
    .replaceAll('{sessionAmount}', formatAmount(session.amount, cost.currency))
    .replaceAll('{tokens}', compactTokens(last.totalTokens))
    .replaceAll('{sessionTokens}', compactTokens(session.totalTokens))
    .replaceAll('{model}', cost.model || '')
}

function maybeShowCost(prev, next) {
  const cfg = behavior.cost
  if (!displaySettings.showCost) return
  if (!cfg || cfg.enabled === false) return
  const cost = next && next.cost
  const at = cost && ((cost.lastTurn && cost.lastTurn.at) || cost.at)
  if (!at || at === lastCostAt) return
  lastCostAt = at
  const delay = Number(cfg.delayMs) || 700
  setTimeout(() => {
    if (interactionActive || dragAnim || !cost) return
    const text = withExtras(formatCost(cost))
    if (window.petAPI && window.petAPI.log) window.petAPI.log(`cost bubble ${text}`)
    showBubble(text, Number(cfg.ttlMs) || 9000)
  }, delay)
}

/* ------------------------------------------------------------------ */
/* 互动 / 挂机小动作                                                   */
/* ------------------------------------------------------------------ */

function clearIdleActions() {
  idleTimers.forEach((timer) => clearTimeout(timer))
  idleTimers = []
}

function scheduleIdleActions() {
  clearIdleActions()
  if (!activePack || state.phase !== 'idle' || interactionActive || dragAnim) return
  const actions = (behavior.interactions && behavior.interactions.idleActions) || []
  actions.forEach((action, index) => {
    if (!action || !action.animation) return
    if (action.once && idlePlayed.has(index)) return
    const afterMs = Math.max(1000, Number(action.afterMs) || 60000)
    const timer = setTimeout(() => {
      if (state.phase !== 'idle' || interactionActive || dragAnim) return
      const frames = animationFrames(action.animation)
      if (!frames.length) return
      idlePlayed.add(index)
      interactionActive = true
      stopFrames()
      if (action.bubble) showBubble(action.bubble, 3200)
      playAnimation(action.animation, {
        loop: false,
        onDone: () => {
          interactionActive = false
          playPhase('idle')
          scheduleIdleActions()
        },
      })
    }, afterMs)
    idleTimers.push(timer)
  })
}

function playInteraction(kind) {
  const spec = behavior.interactions && behavior.interactions[kind]
  if (!spec) return
  const animations = Array.isArray(spec.animations)
    ? spec.animations
    : spec.animation
      ? [spec.animation]
      : []
  const animation = pick(animations)
  if (!animation) return
  interactionActive = true
  clearIdleActions()
  stopFrames()
  const bubble = pick(spec.bubbles)
  if (bubble) showBubble(bubble, 1800)
  playAnimation(animation, {
    loop: false,
    onDone: () => {
      interactionActive = false
      playPhase(state.phase || 'idle')
      scheduleIdleActions()
    },
  })
}

function startDragReaction() {
  const spec = behavior.interactions && behavior.interactions.drag
  if (!spec || !spec.animation) return
  dragAnim = true
  clearIdleActions()
  stopFrames()
  if (spec.bubble) showBubble(spec.bubble, 1600)
  playAnimation(spec.animation, { loop: true })
}

function endDragReaction() {
  if (!dragAnim) return
  dragAnim = false
  playPhase(state.phase || 'idle')
  scheduleIdleActions()
}

/* ------------------------------------------------------------------ */
/* 会话状态面板（绿=完成 / 黄=等你回答 / 红=失败 / 蓝=运行中）         */
/* ------------------------------------------------------------------ */

function svgIcon(pathData, size) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('width', String(size || 12))
  svg.setAttribute('height', String(size || 12))
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', pathData)
  svg.appendChild(path)
  return svg
}

function sessionKind(entry) {
  if (!entry) return 'running'
  if (entry.phase === 'waiting' || entry.reminder === 'waiting') return 'waiting'
  if (entry.phase === 'failed' || entry.reminder === 'failed') return 'failed'
  if (entry.phase === 'done' || entry.reminder === 'done') return 'done'
  return 'running'
}

function sessionLabel(entry) {
  switch (sessionKind(entry)) {
    case 'done': return '完成'
    case 'waiting': return '等你回答'
    case 'failed': return '出错'
    default: return entry && entry.active ? '运行中' : '进行中'
  }
}

function sessionReminderKey(entry) {
  return entry && entry.reminder ? `${entry.sessionId}:${entry.attentionAt || 0}` : null
}

function panelEntries(current) {
  const sessions = Array.isArray(current.sessions) ? current.sessions : []
  return sessions.filter((entry) => {
    const acked = sessionAcks.get(entry.sessionId)
    if (entry.reminder && acked && acked >= Number(entry.attentionAt || 0)) return false
    return Boolean(entry && entry.sessionId)
  }).slice(0, 7)
}

function persistPanelMode() {
  try { localStorage.setItem(SESSION_MODE_KEY, sessionPanelMode) } catch {}
}

function applyOverlayLayout(totalHeight, panelTop, panelHeight) {
  if (!window.petAPI || !window.petAPI.setOverlayLayout) return
  const total = Math.max(0, Math.round(totalHeight))
  const top = Math.max(0, Math.round(panelTop))
  const height = Math.max(0, Math.round(panelHeight))
  const key = `${total}:${top}:${height}`
  if (key === lastOverlayLayout) return
  lastOverlayLayout = key
  window.petAPI.setOverlayLayout(total, top, height).catch(() => {})
}

function scheduleOverlayHeight() {
  requestAnimationFrame(() => {
    if (!sessionsEl || sessionsEl.hidden) {
      applyOverlayLayout(0, 0, 0)
      return
    }
    const rect = sessionsEl.getBoundingClientRect()
    const petHeight = petEl ? petEl.getBoundingClientRect().height : 216
    // 面板尽量贴着宠物：窗口总高 = 宠物元素高 + 面板高 + 一点留白。
    // 宠物图集顶部有一定透明边，所以视觉上仍留出小间距。
    applyOverlayLayout(Math.ceil(petHeight + rect.height + 4), rect.top, rect.height)
  })
}

async function clearSessionReminder(entry) {
  if (!entry || !entry.reminder || entry.phase === 'waiting') return
  sessionAcks.set(entry.sessionId, Date.now())
  renderSessionPanel(state)
  if (window.petAPI && window.petAPI.ackSession) {
    try { await window.petAPI.ackSession(entry.sessionId) } catch {}
  }
}

async function clearFinishedReminders() {
  const entries = panelEntries(state).filter((entry) => entry.reminder && entry.phase !== 'waiting')
  if (!entries.length) return
  const at = Date.now()
  for (const entry of entries) sessionAcks.set(entry.sessionId, at)
  renderSessionPanel(state)
  if (window.petAPI && window.petAPI.ackSession) {
    for (const entry of entries) {
      try { await window.petAPI.ackSession(entry.sessionId) } catch {}
    }
  }
}

function renderSessionPanel(current) {
  if (!sessionsEl || !sessionListEl) return
  const entries = panelEntries(current || {})

  if (!entries.length) {
    sessionsEl.hidden = true
    sessionsEl.classList.remove('collapsed')
    scheduleOverlayHeight()
    return
  }

  sessionsEl.hidden = false
  sessionsEl.classList.toggle('collapsed', sessionPanelMode === 'collapsed')
  if (!bubbleEl.hidden && bubbleEl.textContent) {
    if (sessionPanelMode === 'expanded' && sessionToastEl) {
      sessionToastEl.hidden = false
      sessionToastEl.textContent = bubbleEl.textContent
    }
    bubbleEl.hidden = true
    bubbleEl.textContent = ''
  }
  const clearable = entries.some((entry) => entry.reminder && entry.phase !== 'waiting')
  sessionsEl.classList.toggle('has-done', clearable)
  sessionCountEl.textContent = String(entries.length)

  // 收起后变成 codex 风格灯条：只显示每行一个状态圆点。
  if (sessionBarEl) {
    sessionBarEl.textContent = ''
    sessionBarEl.hidden = sessionPanelMode !== 'collapsed'
    for (const entry of entries) {
      const dot = document.createElement('span')
      dot.className = `session-bar-dot ${sessionKind(entry)}`
      dot.title = entry.title || entry.sessionId || ''
      sessionBarEl.appendChild(dot)
    }
    const count = document.createElement('span')
    count.className = 'session-bar-count'
    count.textContent = String(entries.length)
    sessionBarEl.appendChild(count)
  }

  sessionListEl.textContent = ''
  for (const entry of entries) {
    const kind = sessionKind(entry)
    const row = document.createElement('div')
    row.className = 'session-row'

    const dot = document.createElement('span')
    dot.className = `session-dot ${kind}`
    row.appendChild(dot)

    const title = document.createElement('span')
    title.className = 'session-title'
    title.textContent = entry.title || '未命名会话'
    title.title = entry.title || entry.sessionId || ''
    row.appendChild(title)

    const label = document.createElement('span')
    label.className = 'session-state'
    label.textContent = sessionLabel(entry)
    row.appendChild(label)

    if (entry.reminder && entry.phase !== 'waiting') {
      const clear = document.createElement('button')
      clear.className = 'session-clear'
      clear.type = 'button'
      clear.title = '清掉这条提醒'
      clear.appendChild(svgIcon('M18 6 6 18M6 6l12 12', 12))
      clear.addEventListener('click', (event) => {
        event.stopPropagation()
        clearSessionReminder(entry)
      })
      row.appendChild(clear)
    }
    sessionListEl.appendChild(row)
  }
  scheduleOverlayHeight()
}

if (sessionsToggleBtn) {
  sessionsToggleBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    sessionPanelMode = sessionPanelMode === 'collapsed' ? 'expanded' : 'collapsed'
    persistPanelMode()
    renderSessionPanel(state)
  })
}
if (sessionBarEl) {
  sessionBarEl.addEventListener('click', () => {
    sessionPanelMode = 'expanded'
    persistPanelMode()
    renderSessionPanel(state)
  })
}
if (sessionsClearBtn) {
  sessionsClearBtn.addEventListener('click', () => { clearFinishedReminders() })
}

/* ------------------------------------------------------------------ */
/* 桌面移动：快捷键标记 / 自动散步                                     */
/* ------------------------------------------------------------------ */

function onWalkEvent(event) {
  if (!event) return
  if (event.state === 'start') {
    externalWalk = true
    clearIdleActions()
    const id = event.dx < 0 ? 'walk-left' : 'walk-right'
    const hasWalk = behavior.animations && behavior.animations[id]
    if (hasWalk) playAnimation(id, { loop: true })
    else playAnimation('walk-right', { loop: true })
    if (event.reason === 'mark') showBubble('跑过去看看…', 1800)
    return
  }
  if (event.state === 'end') {
    externalWalk = false
    playPhase(state.phase || 'idle')
  }
}

/* ------------------------------------------------------------------ */
/* 状态更新                                                           */
/* ------------------------------------------------------------------ */

function onState(next) {
  const prev = state
  state = next || { phase: 'idle', activeCount: 0 }
  updateDebug()
  const phaseChanged = !prev || prev.phase !== state.phase
    || (state.phase === 'tool' && prev.toolFamily !== state.toolFamily)

  if (phaseChanged) {
    if (prev && prev.phase === 'idle' && state.phase !== 'idle') idlePlayed.clear()
    if (!externalWalk && !interactionActive && !dragAnim) {
      playPhase(state.phase || 'idle')
      showBubbleForPhase(state)
    }
    if (state.phase === 'idle') scheduleIdleActions()
    else clearIdleActions()
  } else if (prev && prev.activeCount !== state.activeCount && !externalWalk && !interactionActive && !dragAnim) {
    showBubbleForPhase(state)
  }
  maybeShowCost(prev, state)
  renderSessionPanel(state)
}

function updateDebug() {
  if (!debugEl || debugEl.hidden) return
  const current = state || {}
  const cost = current.cost && current.cost.session && current.cost.session.amount
  const extra = typeof cost === 'number' ? ` · ${formatAmount(cost, current.cost.currency)}` : ''
  debugEl.textContent = `${current.phase || 'idle'}${current.toolFamily ? `:${current.toolFamily}` : ''} · ${current.activeCount || 0} 会话${extra}`
}

/* ------------------------------------------------------------------ */
/* 交互：命中检测 / 穿透切换 / 拖拽 / 点击                              */
/* ------------------------------------------------------------------ */

function pointInsideRect(x, y, rect, pad) {
  return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad
}

function hitTest(x, y) {
  if (!petEl) return false
  const pad = 8
  if (pointInsideRect(x, y, petEl.getBoundingClientRect(), pad)) return true
  if (!bubbleEl.hidden && pointInsideRect(x, y, bubbleEl.getBoundingClientRect(), 6)) return true
  return false
}

let hoverRaf = 0
let lastMoveEvent = null

function updateHover() {
  hoverRaf = 0
  if (managedHover) return
  if (!lastMoveEvent || pointerDown) return
  const inside = hitTest(lastMoveEvent.clientX, lastMoveEvent.clientY)
  if (inside !== interactive) {
    interactive = inside
    petEl.classList.toggle('hover', inside)
    window.petAPI.setIgnoreMouse(!inside)
  }
}

window.addEventListener('mousemove', (event) => {
  lastMoveEvent = event
  if (!hoverRaf) hoverRaf = requestAnimationFrame(updateHover)
})

window.addEventListener('mouseleave', () => {
  if (managedHover) return
  if (interactive && !pointerDown) {
    interactive = false
    petEl.classList.remove('hover')
    window.petAPI.setIgnoreMouse(true)
  }
})

function reactToClick() {
  if (window.petAPI && window.petAPI.log) window.petAPI.log('click reaction')
  playInteraction('click')
}

petEl.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  pointerDown = { x: event.screenX, y: event.screenY }
  pointerMoved = false
  dragging = false
  petEl.setPointerCapture(event.pointerId)
  if (!nativeDrag) window.petAPI.dragStart({ screenX: event.screenX, screenY: event.screenY })
})

window.addEventListener('pointermove', (event) => {
  if (!pointerDown) return
  const dx = event.screenX - pointerDown.x
  const dy = event.screenY - pointerDown.y
  if (!pointerMoved && Math.hypot(dx, dy) > 4) {
    pointerMoved = true
    dragging = true
    petEl.classList.add('dragging')
    startDragReaction()
    if (nativeDrag) window.petAPI.dragStart({ screenX: event.screenX, screenY: event.screenY })
  }
  if (pointerMoved && !nativeDrag) {
    window.petAPI.dragMove({ screenX: event.screenX, screenY: event.screenY })
  }
})

window.addEventListener('pointerup', () => {
  if (!pointerDown) return
  const moved = pointerMoved
  pointerDown = null
  pointerMoved = false
  dragging = false
  petEl.classList.remove('dragging')
  if (!nativeDrag) window.petAPI.dragEnd()
  endDragReaction()
  if (!moved) reactToClick()
})

window.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  window.petAPI.showContextMenu()
})

/* ------------------------------------------------------------------ */
/* 启动                                                               */
/* ------------------------------------------------------------------ */

function applyPack(pack) {
  activePack = pack
  packs = packs.length ? packs : [pack]
  const manifest = pack.manifest
  behavior = normalizeBehavior(manifest.behavior)
  petEl.style.backgroundImage = manifest.spritesheetDataUrl
    ? `url("${manifest.spritesheetDataUrl}")`
    : `url("pet://pets/${encodeURIComponent(pack.id)}/${escapeForUrlPath(manifest.spritesheetPath)}")`
  petEl.title = `${manifest.displayName}${manifest.license && manifest.license !== 'UNKNOWN' ? ` · ${manifest.license}` : ''}`
  const spriteUrl = manifest.spritesheetDataUrl
    ? manifest.spritesheetDataUrl
    : `pet://pets/${encodeURIComponent(pack.id)}/${escapeForUrlPath(manifest.spritesheetPath)}`
  if (window.petAPI && window.petAPI.log) {
    const probe = new Image()
    probe.onload = () => window.petAPI.log(`sprite loaded ${pack.id} ${probe.naturalWidth}x${probe.naturalHeight}`)
    probe.onerror = () => window.petAPI.log(`sprite FAILED ${pack.id}`)
    probe.src = spriteUrl
  }
  if (window.petAPI && window.petAPI.log) {
    const ids = Object.keys(behavior.animations || {})
    window.petAPI.log(`behavior loaded ${pack.id} animations=${ids.length} phases=${Object.keys(behavior.phases || {}).length}`)
  }
  lastCostAt = 0
  idlePlayed.clear()
  clearIdleActions()
  interactionActive = false
  dragAnim = false
  setFrame(0, 0)
  stopFrames()
  currentPhase = null
  playPhase((state && state.phase) || 'idle')
  scheduleIdleActions()
}

async function boot() {
  bootstrap = await window.petAPI.getBootstrap()
  displaySettings = { ...displaySettings, ...(bootstrap.settings || {}) }
  packs = bootstrap.packs || []
  state = bootstrap.state || { phase: 'idle', activeCount: 0 }
  setPetSize(bootstrap.config.size)
  if (bootstrap.isDev) {
    debugEl.hidden = false
    updateDebug()
  }
  const pack = packById(bootstrap.config.packId) || packs[0]
  if (!pack) {
    showBubble('没有找到宠物包')
    return
  }
  applyPack(pack)
  showBubbleForPhase(state)
  renderSessionPanel(state)

  window.petAPI.onState(onState)
  if (window.petAPI.onWalk) window.petAPI.onWalk(onWalkEvent)
  if (window.petAPI.onPack) {
    window.petAPI.onPack((pack) => {
      if (pack && pack.id) applyPack(pack)
    })
  }
  window.petAPI.onPacks((nextPacks) => {
    packs = nextPacks
    const next = packById(activePack && activePack.id) || packs[0]
    if (next) applyPack(next)
  })
  if (window.petAPI.onSettings) {
    window.petAPI.onSettings((next) => {
      displaySettings = { ...displaySettings, ...(next || {}) }
      if (!interactionActive && !dragAnim) showBubbleForPhase(state)
    })
  }
  window.petAPI.onReaction(() => reactToClick())
}

boot().catch((err) => {
  console.error('[pet] boot failed', err)
  if (bubbleEl) {
    bubbleEl.hidden = false
    bubbleEl.textContent = `启动失败: ${err.message}`
  }
})
