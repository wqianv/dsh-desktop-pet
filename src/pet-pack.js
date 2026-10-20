'use strict'

/**
 * 宠物包加载器（pet-manifest-v2 的 sprite2d 子集）。
 *
 * 搜索顺序（后者覆盖前者同 id）：
 *   1. <app>/pets/<id>/pet.json                 —— 随应用分发
 *   2. $DSH_HOME/pets/<id>/pet.json             —— 与 DSH 桌宠生态共用
 *   3. ~/.dsh-desktop-pet/pets/<id>/pet.json    —— 本应用的用户目录
 *
 * 支持的最小字段（v2）：
 *   petManifestVersion, id, displayName, license, renderer:'sprite2d',
 *   sprite2d { spritesheetPath, cell, columns, atlasRows, frames, tracks },
 *   sequences, remarks
 * 未知字段忽略（避免社区包被本原型直接拒绝）。
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const DEFAULT_FRAMES = [6, 8, 8, 4, 5, 8, 6, 6, 6]
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

function petRoots(appDir) {
  const home = os.homedir()
  const dshHome = process.env.DSH_HOME || path.join(home, '.dsh')
  return [
    path.join(appDir, 'pets'),
    path.join(dshHome, 'pets'),
    path.join(home, '.dsh-desktop-pet', 'pets'),
  ]
}

function readManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function normalizePack(dir, manifest) {
  if (!manifest || typeof manifest !== 'object') return null
  const id = typeof manifest.id === 'string' ? manifest.id : path.basename(dir)
  const renderer = manifest.renderer || 'sprite2d'
  if (renderer !== 'sprite2d') return null // 原型只支持精灵图，Live2D/frames2d 后续加
  const sprite = manifest.sprite2d
  if (!sprite || typeof sprite.spritesheetPath !== 'string') return null
  const spritesheetPath = sprite.spritesheetPath
  const abs = path.resolve(dir, spritesheetPath)
  if (!abs.startsWith(path.resolve(dir) + path.sep)) return null
  if (!fs.existsSync(abs)) return null

  const cell = {
    width: Number((sprite.cell && sprite.cell.width) || 192),
    height: Number((sprite.cell && sprite.cell.height) || 208),
  }
  const columns = Number(sprite.columns || 8)
  const atlasRows = Number(sprite.atlasRows || (Number(manifest.spriteVersionNumber) === 2 ? 11 : 9))
  const frames = Array.isArray(sprite.frames) && sprite.frames.length
    ? sprite.frames
    : DEFAULT_FRAMES
  const tracks = sprite.tracks && typeof sprite.tracks === 'object' ? sprite.tracks : {}

  return {
    id,
    dir: path.resolve(dir),
    manifest: {
      petManifestVersion: manifest.petManifestVersion || 1,
      id,
      displayName: manifest.displayName || id,
      description: manifest.description || '',
      license: manifest.license || 'UNKNOWN',
      renderer: 'sprite2d',
      cell,
      columns,
      atlasRows,
      frames,
      tracks,
      sequences: manifest.sequences && typeof manifest.sequences === 'object' ? manifest.sequences : {},
      remarks: manifest.remarks && typeof manifest.remarks === 'object' ? manifest.remarks : {},
      spritesheetPath,
    },
  }
}

function loadPacks(appDir) {
  const byId = new Map()
  for (const root of petRoots(appDir).reverse()) {
    // reverse：越靠后的来源优先级越高（覆盖前面的）
    let entries = []
    try {
      entries = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
    } catch {
      continue
    }
    for (const entry of entries) {
      const dir = path.join(root, entry.name)
      const manifest = readManifest(path.join(dir, 'pet.json'))
      const pack = normalizePack(dir, manifest)
      if (pack) byId.set(pack.id, pack)
    }
  }
  return [...byId.values()].sort((a, b) => a.manifest.displayName.localeCompare(b.manifest.displayName))
}

function findPack(packs, id) {
  return packs.find((p) => p.id === id) || null
}

module.exports = {
  loadPacks,
  findPack,
  petRoots,
  DEFAULT_FRAMES,
  ROW_NAMES,
}
