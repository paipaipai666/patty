import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipcHandlers'
import { startHookServer, stopHookServer } from './ptyManager'
import { ensureClaudeCodeHook, ensureOpenCodePlugin, ensureCodexHook } from './hookInstaller'
import { loadSettings } from './settingsHandler'
import { perfMark, perfMeasure, perfMemoryMain, perfReport, perfDump, perfEnabled } from '../shared/perf'
import { noteEvent, startHeartbeatWatchdog, flushStats, setStatsPath } from './heartbeat'

let mainWindow: BrowserWindow | null = null

function isIgnorableMainError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: string }).code
  // Network/pipe aborts from hook clients (e.g. OpenCode exiting) should not
  // crash the app with a system error dialog.
  return code === 'EPIPE' || code === 'ECONNRESET' || code === 'ECONNABORTED'
}

process.on('uncaughtException', (error) => {
  if (isIgnorableMainError(error)) {
    console.error('[main] ignored uncaught network abort:', error.message)
    return
  }
  console.error('[main] fatal uncaught exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error && isIgnorableMainError(reason)) {
    console.error('[main] ignored unhandled network abort:', reason.message)
    return
  }
  console.error('[main] fatal unhandled rejection:', reason)
  process.exit(1)
})

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

  // Load renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

perfMark('app:ready-start')

app.whenReady().then(async () => {
  perfMeasure('app:whenReady', 'app:ready-start')
  perfMark('app:init-start')
  electronApp.setAppUserModelId('com.patty.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers(() => mainWindow)

  // Start hook server for notifications
  perfMark('app:hook-server-start')
  const hookPort = await startHookServer((paneId, event, source) => {
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
  perfMeasure('app:hook-server', 'app:hook-server-start')
  console.log(`Hook server listening on port ${hookPort}`)

  // 只在启用时安装配置
  perfMark('app:hooks-install-start')
  const settings = loadSettings()
  if (settings.notifications.claudeCode) {
    await ensureClaudeCodeHook(hookPort)
  }
  if (settings.notifications.openCode) {
    await ensureOpenCodePlugin()
  }
  if (settings.notifications.codex) {
    await ensureCodexHook()
  }
  perfMeasure('app:hooks-install', 'app:hooks-install-start')

  // Heartbeat watchdog: clears flame when a source stops sending keepalives.
  setStatsPath(join(app.getPath('appData'), 'Patty', 'heartbeat-stats.json'))
  startHeartbeatWatchdog(sendClear)

  perfMark('app:create-window-start')
  createWindow()

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

app.on('before-quit', () => {
  flushStats()
  perfDump()
  stopHookServer()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
