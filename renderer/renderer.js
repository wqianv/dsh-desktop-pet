'use strict'

/**
 * 渲染端：雪碧图逐帧动画 + 气泡 + 命中检测/拖拽 + 点击反应。
 * 只依赖 preload 暴露的 window.petAPI，不直接碰 Node/Electron。
 */

const ROW_NAMES = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
]

const DEFAULT_DURATIONS = {
  idle: [280, 110, 110, 140, 140, 320],
  'running-right': [120, 120, 120, 120, 120, 120, 120, 220],
  'running-left': [120, 120, 120, 120, 120, 120, 120, 220],
  waving: [140, 140, 140, 280],
  jumping: [140, 140, 140, 140, 280],
  failed: [140, 140, 140, 140, 140, 140, 140, 240],
  waiting: [150, 150, 150, 150, 150, 260],
  running: [120, 120, 120, 120, 120, 220],
  review: [150, 150, 150, 150, 150, 280],
}

const PHASE_FALLBACK_TRACK = {
  idle: 'idle',
  thinking: 'running',
  tool: 'running-right',
  waiting: 'waiting',
  review: 'review',
  done: 'jumping',
  failed: 'failed',
}

const TOOL_LABEL = {
  shell: '跑命令中…',
  edit: '改代码中…',
  web: '查资料中…',
  read: '读文件…',
  agent: '调度子代理…',
  mcp: '调工具中…',
}

const petEl = document.getElementById('pet')
const bubbleEl = document.getElementById('bubble')
const debugEl = document.getElementById('debug')

let bootstrap = null
let packs = []
let activePack = null
let state = { phase: 'idle', activeCount: 0, toolFamily: null }
let frameTimer = null
let bubbleTimer = null
let currentPhase = null
let interactive = false
const nativeDrag = !!(window.petAPI && window.petAPI.nativeDrag)
const managedHover = !!(window.petAPI && window.petAPI.managedHover)
let pointerDown = null
let pointerMoved = false
let dragging = false

/* ------------------------------------------------------------------ */
/* 工具函数                                                           */
/* ------------------------------------------------------------------ */

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

function rowFor(track) {
  return ROW_NAMES.indexOf(track)
}

function framesForTrack(track) {
  if (!activePack) return []
  const manifest = activePack.manifest
  const row = rowFor(track)
  if (row < 0) return []
  const count = Number(manifest.frames[row] || 0) || 6
  const trackConfig = (manifest.tracks && manifest.tracks[track]) || null
  const custom = trackConfig && Array.isArray(trackConfig.durations) ? trackConfig.durations : null
  const durations = custom && custom.length
    ? custom
    : DEFAULT_DURATIONS[track] || new Array(count).fill(150)
  return Array.from({ length: count }, (_, i) => ({
    row,
    column: i,
    duration: Number(durations[i % durations.length]) || 150,
  }))
}

function setFrame(row, column) {
  if (!activePack) return
  const { columns, atlasRows } = activePack.manifest
  const x = columns > 1 ? (column / (columns - 1)) * 100 : 0
  const y = atlasRows > 1 ? (row / (atlasRows - 1)) * 100 : 0
  petEl.style.backgroundSize = `${columns * 100}% ${atlasRows * 100}%`
  petEl.style.backgroundPosition = `${x}% ${y}%`
}

/* ------------------------------------------------------------------ */
/* 动画                                                               */
/* ------------------------------------------------------------------ */

function stopFrames() {
  if (frameTimer) clearTimeout(frameTimer)
  frameTimer = null
}

function playTrack(track, onDone) {
  const frames = framesForTrack(track)
  if (!frames.length) {
    if (onDone) onDone()
    return
  }
  let i = 0
  const tick = () => {
    if (i >= frames.length) {
      frameTimer = null
      if (onDone) onDone()
      return
    }
    const frame = frames[i]
    i += 1
    setFrame(frame.row, frame.column)
    frameTimer = setTimeout(tick, frame.duration)
  }
  tick()
}

function sequenceFor(phase) {
  const seq = activePack && activePack.manifest.sequences && activePack.manifest.sequences[phase]
  if (Array.isArray(seq) && seq.length) return seq
  return [PHASE_FALLBACK_TRACK[phase] || 'idle']
}

function isLoopingPhase(phase) {
  return phase === 'idle' || phase === 'thinking' || phase === 'waiting' || phase === 'review' || phase === 'tool'
}

function playPhase(phase) {
  if (!activePack) return
  stopFrames()
  currentPhase = phase
  const sequence = sequenceFor(phase)
  let index = 0
  const step = () => {
    if (index >= sequence.length) {
      if (isLoopingPhase(phase)) {
        index = 0
      } else {
        playPhase('idle')
        return
      }
    }
    const track = sequence[index]
    index += 1
    playTrack(track, step)
  }
  step()
}

/* ------------------------------------------------------------------ */
/* 气泡                                                               */
/* ------------------------------------------------------------------ */

function hideBubble() {
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = null
  bubbleEl.hidden = true
  bubbleEl.textContent = ''
}

function showBubble(text, ttlMs) {
  if (!text) {
    hideBubble()
    return
  }
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = null
  bubbleEl.hidden = false
  bubbleEl.textContent = text
  if (ttlMs > 0) bubbleTimer = setTimeout(hideBubble, ttlMs)
}

function bubbleTextForPhase(current) {
  const phase = current.phase || 'idle'
  const suffix = Number(current.activeCount) > 1 ? ` · ${current.activeCount} 会话` : ''
  if (phase === 'thinking') return `思考中…${suffix}`
  if (phase === 'tool') return `${TOOL_LABEL[current.toolFamily] || '干活中…'}${suffix}`
  if (phase === 'waiting') return `等你确认…${suffix}`
  if (phase === 'review') return `检查中…${suffix}`
  if (phase === 'done') return `搞定！${suffix}`
  if (phase === 'failed') return `出错了…${suffix}`
  return ''
}

function showBubbleForPhase(current) {
  const text = bubbleTextForPhase(current)
  if (!text) {
    hideBubble()
    return
  }
  const persistent = current.phase === 'waiting'
  showBubble(text, persistent ? 0 : 3800)
}

/* ------------------------------------------------------------------ */
/* 状态更新                                                           */
/* ------------------------------------------------------------------ */

function onState(next) {
  const prev = state
  state = next || { phase: 'idle', activeCount: 0 }
  updateDebug()
  const phaseChanged = !prev || prev.phase !== next.phase || (next.phase === 'tool' && prev.toolFamily !== next.toolFamily)
  if (phaseChanged) {
    playPhase(next.phase || 'idle')
    showBubbleForPhase(next)
  } else if (prev && prev.activeCount !== next.activeCount) {
    showBubbleForPhase(next)
  }
}

function updateDebug() {
  if (!debugEl || debugEl.hidden) return
  const current = state || {}
  debugEl.textContent = `${current.phase || 'idle'}${current.toolFamily ? `:${current.toolFamily}` : ''} · ${current.activeCount || 0} 会话`
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
  const back = state.phase || 'idle'
  showBubble('嗯哼～', 1600)
  stopFrames()
  playTrack('waving', () => playPhase(back))
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
    if (nativeDrag) window.petAPI.dragStart({ screenX: event.screenX, screenY: event.screenY })
  }
  if (pointerMoved && !nativeDrag) {
    window.petAPI.dragMove({ screenX: event.screenX, screenY: event.screenY })
  }
})

window.addEventListener('pointerup', (event) => {
  if (!pointerDown) return
  const moved = pointerMoved
  pointerDown = null
  pointerMoved = false
  dragging = false
  petEl.classList.remove('dragging')
  if (!nativeDrag) window.petAPI.dragEnd()
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
  setFrame(0, 0)
  stopFrames()
  currentPhase = null
  playPhase((state && state.phase) || 'idle')
}

async function boot() {
  bootstrap = await window.petAPI.getBootstrap()
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

  window.petAPI.onState(onState)
  window.petAPI.onPacks((nextPacks) => {
    packs = nextPacks
    const next = packById(activePack && activePack.id) || packs[0]
    if (next) applyPack(next)
  })
  window.petAPI.onReaction(() => reactToClick())
}

boot().catch((err) => {
  console.error('[pet] boot failed', err)
  if (bubbleEl) {
    bubbleEl.hidden = false
    bubbleEl.textContent = `启动失败: ${err.message}`
  }
})
