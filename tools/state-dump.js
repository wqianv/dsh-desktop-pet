#!/usr/bin/env node
'use strict'

/**
 * 调试用：不启动 Electron，直接打印 DSH 会话归一化状态。
 *   node tools/state-dump.js            # 打印一次
 *   node tools/state-dump.js --watch    # 每秒打印变化
 */

const { DshStateWatcher } = require('../src/dsh-state')

const watch = process.argv.includes('--watch')

const watcher = new DshStateWatcher({
  intervalMs: 1000,
  onChange: (state) => {
    console.log(JSON.stringify(state, null, 2))
    if (!watch) watcher.stop()
  },
})

watcher.start()

if (watch) {
  console.log('[state-dump] watching DSH sessions… Ctrl+C to stop')
}

if (!watch) {
  // onChange 在首次 tick 时同步触发；若没有会话，1.2s 后兜底退出。
  setTimeout(() => {
    watcher.stop()
    if (!watcher.lastSerialized) {
      console.log(JSON.stringify({ phase: 'idle', activeCount: 0, sessions: [] }, null, 2))
    }
  }, 1200)
  setTimeout(() => process.exit(0), 1500)
}
