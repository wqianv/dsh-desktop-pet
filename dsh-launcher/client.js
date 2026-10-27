/**
 * DSH 设置页 · 桌宠 section
 *
 * 与 host 半边通过同源路由通信：
 *   GET  /dsh-pet/api/settings
 *   POST /dsh-pet/api/settings
 *   POST /dsh-pet/api/icon
 *
 * 改完设置后，桌宠会在 1s 内监听到 settings.json / icons/*.png 变化并应用。
 */
// DSH 的 client-modules 对同一 id 重复执行 bundle 会直接抛 duplicate factory。
// immediate entry 在某些 boot 路径里会被载入两次，这里做一次幂等保护；
// 正常页面只执行一次，HMR 重新执行时保留已注册的 factory。
if (window.__DSH_DESKTOP_PET_CLIENT_BOOTED__) {
  // already registered
} else {
  window.__DSH_DESKTOP_PET_CLIENT_BOOTED__ = true
  window.__ModuleLoader__.load({
  id: 'dsh-desktop-pet-launcher',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createElement: h, useCallback, useEffect, useRef, useState } = React
    const API = '/dsh-pet/api'
    const CSS_TAG = 'dsh-desktop-pet/settings.css'
    const CSS = [
      '.pet-settings{max-width:720px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:6px}',
      '.pet-settings h3{margin:0;font-size:16px;font-weight:500;line-height:24px}',
      '.pet-settings .pet-intro{color:var(--dsw-alias-label-tertiary);margin:0 0 4px;font-size:13px;line-height:20px}',
      '.pet-settings .pet-group{margin-top:16px;font-size:13px;font-weight:600;line-height:20px}',
      '.pet-settings .pet-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px 20px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}',
      '.pet-settings .pet-row:last-child{border-bottom:none}',
      '.pet-settings .pet-row>div:first-child{flex:1;min-width:190px}',
      '.pet-settings .pet-label{font-size:13px;line-height:19px}',
      '.pet-settings .pet-hint{color:var(--dsw-alias-label-tertiary);margin-top:3px;font-size:11.5px;line-height:17px}',
      '.pet-settings input[type=checkbox]{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary);margin-top:2px}',
      '.pet-settings .pet-icon-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.pet-settings .pet-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:12px;height:28px;padding:0 10px;cursor:pointer}',
      '.pet-settings .pet-btn:hover{background:rgba(127,127,127,.08)}',
      '.pet-settings .pet-btn.pet-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}',
      '.pet-settings .pet-select{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;height:30px;padding:0 8px;min-width:220px;outline:none}',
      '.pet-settings .pet-select:focus-visible{border-color:var(--dsw-alias-brand-primary)}',
      '.pet-settings .pet-pack-desc{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px;margin-top:6px;max-width:420px}',
      '.pet-settings .pet-status{font-size:12px;line-height:18px;margin-top:10px;color:var(--dsw-alias-label-tertiary);min-height:18px}',
      '.pet-settings .pet-err{color:var(--dsw-alias-state-error-primary)}',
      '.pet-settings .pet-badge{display:inline-block;font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary);margin-left:6px}',
    ].join('')

    function useStyleOnce() {
      useEffect(() => {
        if (typeof document === 'undefined') return
        if (!document.getElementById(CSS_TAG)) {
          const style = document.createElement('style')
          style.id = CSS_TAG
          style.textContent = CSS
          document.head.appendChild(style)
        }
      }, [])
    }

    const TOGGLES = [
      ['autoStart', '随 DSH 启动', 'DSH 启动时自动拉起桌宠；改动在下次启动 DSH 生效。'],
      ['showBalance', '显示余额', '桌宠气泡/右键菜单显示 DeepSeek 账户余额。'],
      ['showPrioritySessions', '显示高优会话', '列出等待确认 / 出错的会话，气泡显示高优数量。'],
      ['showCost', '显示费用气泡', '每轮结束显示本轮和本会话的 token 费用估算。'],
      ['showDockIcon', '显示 Dock 图标', '在程序坞显示桌宠图标。'],
      ['showTrayIcon', '显示菜单栏图标', '在右上角菜单栏显示托盘图标。'],
    ]
    const LEISURE_TOGGLES = [
      ['autoWander', '自动散步', 'DSH 空闲时，桌宠会在桌面范围内随机走动。'],
      ['idleActions', '挂机小动作', '发呆、睡觉、伸懒腰等无操作时的随机动作。'],
      ['markShortcut', '快捷键召唤', 'Option+Shift+P 标记鼠标位置，桌宠跑过去；关闭后快捷键不生效。'],
    ]

    function IconRow({ kind, title, hint, exists, busy, onPick, onReset }) {
      const inputRef = useRef(null)
      return h('div', { className: 'pet-row' },
        h('div', null,
          h('div', { className: 'pet-label' }, title,
            exists ? h('span', { className: 'pet-badge' }, '已自定义') : h('span', { className: 'pet-badge' }, '默认图标')),
          h('div', { className: 'pet-hint' }, hint)),
        h('div', { className: 'pet-icon-actions' },
          h('input', {
            ref: inputRef,
            type: 'file',
            accept: 'image/png',
            style: { display: 'none' },
            onChange: (event) => {
              const file = event.target.files && event.target.files[0]
              event.target.value = ''
              if (file) onPick(kind, file)
            },
          }),
          h('button', {
            className: 'pet-btn',
            disabled: busy,
            onClick: () => inputRef.current && inputRef.current.click(),
            type: 'button',
          }, '选择 PNG…'),
          exists ? h('button', {
            className: 'pet-btn',
            disabled: busy,
            onClick: () => onReset(kind),
            type: 'button',
          }, '恢复默认') : null))
    }

    function PetSettingsSection() {
      useStyleOnce()
      const [settings, setSettings] = useState(null)
      const [packs, setPacks] = useState([])
      const [activePack, setActivePack] = useState(null)
      const [icons, setIcons] = useState({ app: false, tray: false })
      const [message, setMessage] = useState('')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        setError('')
        try {
          const [settingsResponse, packsResponse] = await Promise.all([
            fetch(`${API}/settings`, { headers: { accept: 'application/json' } }),
            fetch(`${API}/packs`, { headers: { accept: 'application/json' } }),
          ])
          const json = await settingsResponse.json().catch(() => ({}))
          if (!settingsResponse.ok || !json.ok) throw new Error(json.error || `HTTP ${settingsResponse.status}`)
          const packJson = await packsResponse.json().catch(() => ({}))
          if (!packsResponse.ok || !packJson.ok) throw new Error(packJson.error || `HTTP ${packsResponse.status}`)
          setSettings(json.settings)
          setPacks(packJson.packs || [])
          setActivePack(packJson.active || null)
          setIcons(json.icons || { app: false, tray: false })
        } catch (err) {
          setError(`读取桌宠设置失败：${err.message}`)
        }
      }, [])

      useEffect(() => { load() }, [load])

      const postSettings = useCallback(async (next) => {
        const response = await fetch(`${API}/settings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(next),
        })
        const json = await response.json().catch(() => ({}))
        if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`)
        setSettings(json.settings)
      }, [])

      const update = useCallback(async (key, value) => {
        if (!settings) return
        const next = { ...settings, [key]: value }
        setSettings(next)
        setBusy(true)
        setMessage('')
        setError('')
        try {
          await postSettings(next)
          if (key === 'packId') {
            setMessage('已切换形象；桌宠热加载中，约 1 秒完成。')
            fetch(`${API}/packs`, { headers: { accept: 'application/json' } })
              .then((r) => r.json())
              .then((j) => { if (j.ok) { setPacks(j.packs || []); setActivePack(j.active || null) } })
              .catch(() => {})
          } else {
            setMessage('已保存；桌宠会在 1 秒内应用。')
          }
        } catch (err) {
          setError(`保存失败：${err.message}`)
          await load()
        } finally {
          setBusy(false)
        }
      }, [settings, postSettings, load])

      const pickIcon = useCallback(async (kind, file) => {
        setBusy(true)
        setMessage('')
        setError('')
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.onerror = () => reject(new Error('读取文件失败'))
            reader.readAsDataURL(file)
          })
          const response = await fetch(`${API}/icon`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ kind, dataUrl }),
          })
          const json = await response.json().catch(() => ({}))
          if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`)
          setIcons(json.icons || { app: false, tray: false })
          setMessage(kind === 'app' ? 'Dock 图标已保存到本地。' : '菜单栏图标已保存到本地。')
        } catch (err) {
          setError(`图标保存失败：${err.message}`)
        } finally {
          setBusy(false)
        }
      }, [])

      const resetIcon = useCallback(async (kind) => {
        setBusy(true)
        setMessage('')
        setError('')
        try {
          const response = await fetch(`${API}/icon`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ kind, reset: true }),
          })
          const json = await response.json().catch(() => ({}))
          if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`)
          setIcons(json.icons || { app: false, tray: false })
          setMessage('已恢复默认图标。')
        } catch (err) {
          setError(`恢复失败：${err.message}`)
        } finally {
          setBusy(false)
        }
      }, [])

      const refreshPacks = useCallback(async () => {
        setError('')
        try {
          const response = await fetch(`${API}/packs`, { headers: { accept: 'application/json' } })
          const json = await response.json().catch(() => ({}))
          if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`)
          setPacks(json.packs || [])
          setActivePack(json.active || null)
          setMessage(`已重新扫描，共 ${json.packs?.length || 0} 个形象。`)
        } catch (err) {
          setError(`扫描形象失败：${err.message}`)
        }
      }, [])

      if (!settings) {
        return h('div', { className: 'pet-settings' },
          h('h3', null, '桌宠'),
          error ? h('div', { className: 'pet-status pet-err' }, error) : h('div', { className: 'pet-status' }, '读取中…'))
      }

      return h('div', { className: 'pet-settings' },
        h('h3', null, '桌宠'),
        h('p', { className: 'pet-intro' },
          '透明置顶的独立桌宠；这里控制它显示什么、是否随 DSH 启动，以及 Dock / 菜单栏图标。',
          '设置保存在 ', h('code', null, '~/.dsh-desktop-pet/settings.json'), '。'),
        h('div', { className: 'pet-group' }, '形象'),
        h('div', { className: 'pet-row' },
          h('div', null,
            h('div', { className: 'pet-label' }, '当前桌宠形象'),
            h('div', { className: 'pet-hint' }, '选中后热切换，不需要重启 DSH 或桌宠。把新的 pet pack 目录放到 ~/.dsh-desktop-pet/pets/<id>/ 或项目 pets/ 后点「刷新」。'),
            (() => {
              const selected = packs.find((pack) => pack.id === (settings.packId || activePack))
              return selected ? h('div', { className: 'pet-pack-desc' },
                selected.description || '',
                selected.license ? ` · ${selected.license}` : '') : null
            })()),
          h('div', { className: 'pet-icon-actions' },
            h('select', {
              className: 'pet-select',
              value: settings.packId || activePack || '',
              disabled: busy || packs.length === 0,
              onChange: (event) => update('packId', event.target.value),
            }, packs.map((pack) => h('option', { key: pack.id, value: pack.id }, pack.displayName || pack.id))),
            h('button', {
              className: 'pet-btn',
              type: 'button',
              disabled: busy,
              onClick: refreshPacks,
            }, '刷新'))),
        h('div', { className: 'pet-group' }, '显示'),
        h('div', null, TOGGLES.map(([key, label, hint]) => h('div', { className: 'pet-row', key },
          h('div', null,
            h('div', { className: 'pet-label' }, label),
            h('div', { className: 'pet-hint' }, hint)),
          h('input', {
            type: 'checkbox',
            checked: settings[key] === true,
            disabled: busy,
            onChange: (event) => update(key, event.target.checked),
          })))),
        h('div', { className: 'pet-group' }, '休闲功能'),
        h('div', null, LEISURE_TOGGLES.map(([key, label, hint]) => h('div', { className: 'pet-row', key },
          h('div', null,
            h('div', { className: 'pet-label' }, label),
            h('div', { className: 'pet-hint' }, hint)),
          h('input', {
            type: 'checkbox',
            checked: settings[key] === true,
            disabled: busy,
            onChange: (event) => update(key, event.target.checked),
          })))),
        h('div', { className: 'pet-group' }, '图标'),
        h('div', { className: 'pet-hint' }, '选择本地 PNG 后会复制到 ~/.dsh-desktop-pet/icons/，不会上传到网络。'),
        h(IconRow, {
          kind: 'app',
          title: 'Dock 图标',
          hint: '建议 512×512 或 1024×1024 PNG；运行时替换 Dock，Finder/启动台 bundle 图标不变。',
          exists: icons.app,
          busy,
          onPick: pickIcon,
          onReset: resetIcon,
        }),
        h(IconRow, {
          kind: 'tray',
          title: '菜单栏图标',
          hint: '建议 22×22 / 44×44 PNG；黑色+透明更贴近菜单栏 template 风格。',
          exists: icons.tray,
          busy,
          onPick: pickIcon,
          onReset: resetIcon,
        }),
        h('div', { className: `pet-status${error ? ' pet-err' : ''}` }, error || message))
    }

    const inject = ['slots']
    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'dsh-desktop-pet', order: 7, label: () => '桌宠' },
            PetSettingsSection,
          ), 'dsh-desktop-pet: settings section'),
        'dsh-desktop-pet: settings section',
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.PetSettingsSection = PetSettingsSection
    return module.exports
  },
  })
}
