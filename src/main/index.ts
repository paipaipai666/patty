import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipcHandlers'
import { startHookServer, stopHookServer } from './ptyManager'
import { ensureClaudeCodeHook, ensureOpenCodePlugin } from './hookInstaller'
import { loadSettings } from './settingsHandler'

let mainWindow: BrowserWindow | null = null

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

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.patty.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers(() => mainWindow)

  // Start hook server for notifications
  const hookPort = await startHookServer((paneId, event, source) => {
    // 检查对应工具是否启用
    const settings = loadSettings()
    if (source === 'claude-code' && !settings.notifications.claudeCode) return
    if (source === 'opencode' && !settings.notifications.openCode) return

    const attentionType = mapEventToAttentionType(event)
    if (attentionType && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:attn', paneId, attentionType)
    }
  })
  console.log(`Hook server listening on port ${hookPort}`)

  // 只在启用时安装配置
  const settings = loadSettings()
  if (settings.notifications.claudeCode) {
    await ensureClaudeCodeHook(hookPort)
  }
  if (settings.notifications.openCode) {
    await ensureOpenCodePlugin()
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  stopHookServer()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
