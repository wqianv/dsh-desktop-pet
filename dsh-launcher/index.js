/**
 * DSH launcher for dsh-desktop-pet.
 *
 * DSH 启动并加载本插件时，拉起桌宠 .app；DSH 退出/插件卸载时把桌宠关掉。
 * 桌宠进程本身是独立 Tauri app（不依赖 DSH 的 UI），这里只做生命周期绑定。
 * 如果 DSH 被强杀导致 dispose 没跑，桌宠的 --managed 模式会自己发现 DSH 不在并退出。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-desktop-pet-launcher'
export const inject = []

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROJECT = path.resolve(HERE, '..')

const CANDIDATES = [
  process.env.DSH_PET_APP,
  path.join(PROJECT, 'src-tauri', 'target', 'debug', 'bundle', 'macos', 'DSH Pet.app'),
  path.join(PROJECT, 'src-tauri', 'target', 'release', 'bundle', 'macos', 'DSH Pet.app'),
  path.join(os.homedir(), 'Applications', 'DSH Pet.app'),
  '/Applications/DSH Pet.app',
].filter(Boolean)

function appBinary(appPath) {
  return path.join(appPath, 'Contents', 'MacOS', 'dsh-desktop-pet')
}

function findApp() {
  for (const candidate of CANDIDATES) {
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

export function apply(ctx) {
  try {
    const app = findApp()
    if (!app) {
      console.warn('[dsh-pet-launcher] 没找到 DSH Pet.app，设置 DSH_PET_APP 指向 .app 路径')
      return
    }

    ctx.effect(() => {
      let spawned = false
      try {
        if (!petRunning()) {
          // 直接 spawn .app 里的可执行文件：环境变量能可靠传给桌宠（open --args/--env 在
          // macOS LaunchServices 下会被丢掉）。桌宠带 DSH_PET_MANAGED=1 时会在 DSH
          // 消失后自己退出，作为 dispose 没跑时的兜底。
          const binary = appBinary(app)
          const env = { ...process.env, DSH_PET_MANAGED: '1' }
          delete env.ELECTRON_RUN_AS_NODE
          const child = spawn(binary, [], {
            env,
            stdio: 'ignore',
            detached: true,
          })
          child.unref()
          spawned = true
          console.log('[dsh-pet-launcher] launched', binary)
        } else {
          console.log('[dsh-pet-launcher] pet already running')
        }
      } catch (err) {
        console.warn('[dsh-pet-launcher] launch failed:', err && err.message)
      }

      return () => {
        // DSH 退出/重载插件时统一关掉桌宠（包括安装插件前就在跑的那只），
        // 保证下一次 DSH 启动后由 managed 实例接管生命周期。
        stopPet()
      }
    })
  } catch (err) {
    // 绝不能让桌宠插件把 DSH 启动搞挂
    console.warn('[dsh-pet-launcher] disabled:', err && err.message)
  }
}
