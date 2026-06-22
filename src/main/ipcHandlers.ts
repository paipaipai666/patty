import { ipcMain, BrowserWindow, dialog } from 'electron'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import {
  createPty,
  writeToPty,
  resizePty,
  killPty,
  detectAvailableShells,
  getHookPort
} from './ptyManager'
import { loadSettings, saveSettings } from './settingsHandler'
import { loadState, saveState } from './stateHandler'
import type { PersistedState } from '../shared/stateTypes'
import type { CustomTheme } from '../shared/settingsTypes'

function getInstalledFonts(): string[] {
  const fonts = new Set<string>()
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'
  ]
  for (const key of keys) {
    try {
      const result = execSync(`reg query "${key}" /s`, { encoding: 'utf-8', timeout: 10000 })
      for (const line of result.split(/\r?\n/)) {
        const match = line.match(/^\s+(.+?)\s+REG_(SZ|EXPAND_SZ)\s+(.+)$/)
        if (match) {
          const name = match[1].trim()
          const clean = name.replace(/\s*\((?:TrueType|OpenType|All res)\)\s*$/i, '').trim()
          if (clean) fonts.add(clean)
        }
      }
    } catch {
      // registry key not found or access denied — skip
    }
  }
  return [...fonts].sort()
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  // Settings handlers
  ipcMain.handle('settings:getAll', () => {
    return loadSettings()
  })

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    const settings = loadSettings()
    ;(settings as unknown as Record<string, unknown>)[key] = value
    saveSettings(settings)
    return settings
  })

  // State handlers
  ipcMain.handle('state:load', () => {
    return loadState()
  })

  ipcMain.handle('state:save', (_event, state: PersistedState) => {
    saveState(state)
    return { success: true }
  })

  // Directory picker
  ipcMain.handle('dialog:selectDirectory', async () => {
    try {
      const win = getWindow()
      if (!win) return { canceled: true, directory: null }
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select project directory'
      })
      return { canceled: result.canceled, directory: result.filePaths[0] || null }
    } catch (err) {
      console.error('Directory selection failed:', err)
      return { canceled: true, directory: null }
    }
  })

  // PTY handlers
  ipcMain.handle('pty:create', (event, id: string, cwd?: string, shell?: string, cols?: number, rows?: number) => {
    try {
      const term = createPty(id, cwd, shell, cols, rows)
      const win = getWindow()

      // Forward PTY data to renderer
      term.onData((data) => {
        win?.webContents.send(`pty:data:${id}`, data)
      })

      // Forward PTY exit to renderer
      term.onExit(({ exitCode }) => {
        win?.webContents.send(`pty:exit:${id}`, exitCode)
      })

      return { pid: term.pid, success: true }
    } catch (error) {
      console.error('Failed to create PTY:', error)
      return { pid: 0, success: false, error: String(error) }
    }
  })

  ipcMain.on('pty:write', (_event, id: string, data: string) => {
    writeToPty(id, data)
  })

  ipcMain.on('pty:resize', (_event, id: string, cols: number, rows: number) => {
    resizePty(id, cols, rows)
  })

  ipcMain.handle('pty:kill', (_event, id: string) => {
    try {
      killPty(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Shell detection
  ipcMain.handle('shell:detect', () => {
    return detectAvailableShells()
  })

  // System fonts
  ipcMain.handle('system:getFonts', () => {
    return getInstalledFonts()
  })

  // Hook port
  ipcMain.handle('system:getHookPort', () => {
    return getHookPort()
  })

  // Reset attention for a pane
  ipcMain.on('pty:resetAttention', (_event, id: string) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('pty:attn', id, null)
    }
  })

  // Theme export
  ipcMain.handle('theme:export', async (_event, theme: CustomTheme) => {
    try {
      const win = getWindow()
      if (!win) return { success: false }
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Theme',
        defaultPath: `${theme.name}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { success: false }
      writeFileSync(result.filePath, JSON.stringify(theme, null, 2), 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Theme import
  ipcMain.handle('theme:import', async () => {
    try {
      const win = getWindow()
      if (!win) return { success: false }
      const result = await dialog.showOpenDialog(win, {
        title: 'Import Theme',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return { success: false }
      const raw = readFileSync(result.filePaths[0], 'utf-8')
      const theme = JSON.parse(raw) as CustomTheme
      if (!theme.name || !theme.ui || !theme.terminal) {
        return { success: false, error: 'Invalid theme file' }
      }
      theme.id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      return { success: true, theme }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Window controls
  ipcMain.on('window:minimize', () => {
    getWindow()?.minimize()
  })

  ipcMain.on('window:maximize', () => {
    const win = getWindow()
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.on('window:close', () => {
    getWindow()?.close()
  })
}
