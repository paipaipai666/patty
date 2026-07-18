import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipcHandlers'
import { startHookServer, stopHookServer, ensurePwshCached, warmFirstPty } from './ptyManager'
import { ensureClaudeCodeHook, ensureOpenCodePlugin, ensureCodexHook } from './hookInstaller'
import { loadSettings } from './settingsHandler'
import { loadState } from './stateHandler'
import type { PersistedPaneTree } from '../shared/paneTypes'
import { perfMark, perfMeasure, perfMemoryMain, perfReport, perfDump, perfEnabled } from '../shared/perf'
import { MetricsCollector } from './metricsCollector'
import { noteEvent, startHeartbeatWatchdog } from './heartbeat'
import { onUncaughtException, onUnhandledRejection } from './errorPolicy'

let mainWindow: BrowserWindow | null = null
let metricsCollector: MetricsCollector | null = null

process.on('uncaughtException', onUncaughtException)
process.on('unhandledRejection', onUnhandledRejection)

  // 映射原始事件到注意力类型
  function mapEventToAttentionType(event: string): string | null {
    // 权限请求/询问问题 → 蓝色
    if (event === 'permission_prompt' || event === 'elicitation_dialog' ||
        event.includes('permission') || event.includes('question')) {
      return 'permission'
    }
    // 回答完毕 → 绿色
    if (event === 'idle' || event === 'stop') {
      return 'complete'
    }
    // 执行出错 → 红色
    if (event === 'error' || event.startsWith('error_')) {
      return 'error'
    }
    // 未知事件，不处理
    return null
  }

  function mapSourceToAiType(source: string): 'claude' | 'opencode' | 'codex' | null {
    if (source === 'claude-code') return 'claude'
    if (source === 'opencode') return 'opencode'
    if (source === 'codex') return 'codex'
    return null
  }

  function sendClear(paneId: string): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send('pty:attn', paneId, null, null)
      }
    }
  }

function leafSessionIds(tree: PersistedPaneTree): string[] {
  if (tree.type === 'leaf') return [tree.sessionId]
  return [...leafSessionIds(tree.first), ...leafSessionIds(tree.second)]
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    backgroundColor: '#0f0f12',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    roundedCorners: true,
    icon: is.dev
      ? join(__dirname, '../../resources/icon.ico')
      : join(process.resourcesPath, 'resources/icon.ico')
  })

  mainWindow.on('ready-to-show', () => {
    perfMeasure('app:create-window-to-show', 'app:create-window-start')
    perfMeasure('app:init-to-show', 'app:init-start')
    perfMeasure('app:total-startup', 'app:ready-start')
    perfMark('app:shown')
    mainWindow?.show()
  })

  // Notify renderer of maximize/unmaximize
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized', false)
  })

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Forward renderer console logs to main process when perf instrumentation is active
  if (perfEnabled) {
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
      console.log(message)
    })
  }

  // Load renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

perfMark('app:ready-start')

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    perfMeasure('app:whenReady', 'app:ready-start')
    perfMark('app:init-start')
    electronApp.setAppUserModelId('com.patty.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  metricsCollector = new MetricsCollector(() => mainWindow)
  registerIpcHandlers(() => mainWindow, metricsCollector)

  // Start hook server for notifications
  perfMark('app:hook-server-start')
  const hookPortPromise = startHookServer((paneId, event, source) => {
    // 心跳租约：所有来源事件都刷新该 pane 的 keepalive
    noteEvent(paneId, event, source)

    // 检查对应工具是否启用
    const settings = loadSettings()
    if (source === 'claude-code' && !settings.notifications.claudeCode) return
    if (source === 'opencode' && !settings.notifications.openCode) return
    if (source === 'codex' && !settings.notifications.codex) return

    const aiType = mapSourceToAiType(source)

    // 会话开始 → 设置 aiType
    if (event === 'session_start' || event === 'session_created') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pty:attn', paneId, null, aiType)
      }
      return
    }

    // 会话结束 → 清除 aiType
    if (event === 'session_end' || event === 'session_deleted') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pty:attn', paneId, null, null)
      }
      return
    }

    const attentionType = mapEventToAttentionType(event)
    if (attentionType && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:attn', paneId, attentionType, aiType)
    }
  })
  // Warm the pwsh path cache while the hook server binds (~130ms overlap).
  ensurePwshCached()
  const hookPort = await hookPortPromise
  perfMeasure('app:hook-server', 'app:hook-server-start')
  console.log(`Hook server listening on port ${hookPort}`)

  // 只在启用时安装配置
  perfMark('app:hooks-install-start')
  const settings = loadSettings()
  if (settings.notifications.claudeCode) {
    perfMark('app:hook-claude-code-start')
    await ensureClaudeCodeHook(hookPort)
    perfMeasure('app:hook-claude-code', 'app:hook-claude-code-start')
  }
  if (settings.notifications.openCode) {
    perfMark('app:hook-opencode-start')
    await ensureOpenCodePlugin()
    perfMeasure('app:hook-opencode', 'app:hook-opencode-start')
  }
  if (settings.notifications.codex) {
    perfMark('app:hook-codex-start')
    await ensureCodexHook()
    perfMeasure('app:hook-codex', 'app:hook-codex-start')
  }
  perfMeasure('app:hooks-install', 'app:hooks-install-start')

  // Heartbeat watchdog: clears flame when a source stops sending keepalives.
  startHeartbeatWatchdog(sendClear)

  perfMark('app:create-window-start')
  createWindow()
  // Metrics sampling stays off until the renderer opens the dashboard
  // (metrics:setSampling) — each sample spawns a powershell.exe, so running
  // it unconditionally costs a constant stream of short-lived processes.

  // Preheat the active workspace's PTYs so their shell boot overlaps renderer
  // load instead of blocking first-terminal-ready. Runs after createWindow so
  // the ~100ms spawn doesn't delay first paint.
  perfMark('app:pty-warm-start')
  try {
    const persisted = loadState()
    const activeWs = persisted.workspaces?.find((w) => w.id === persisted.activeWorkspaceId)
    if (activeWs?.paneTree) {
      for (const sessionId of leafSessionIds(activeWs.paneTree)) {
        const s = persisted.sessions.find((sess) => sess.id === sessionId)
        if (s) warmFirstPty(sessionId, s.cwd, s.shell)
      }
    }
  } catch (err) {
    console.error('Failed to warm first PTY:', err)
  }
  perfMeasure('app:pty-warm', 'app:pty-warm-start')

  // Periodic memory snapshot in perf mode
  if (perfEnabled) {
    perfMemoryMain('startup')
    setInterval(() => perfMemoryMain('periodic'), 30_000)
    setInterval(() => perfReport(), 60_000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
  })
}

app.on('before-quit', () => {
  perfDump()
  metricsCollector?.stop()
  stopHookServer()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
