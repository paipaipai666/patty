import { ipcMain, BrowserWindow, dialog } from 'electron'
import { createPty, writeToPty, resizePty, killPty, detectAvailableShells } from './ptyManager'
import { loadSettings, saveSettings } from './settingsHandler'

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
