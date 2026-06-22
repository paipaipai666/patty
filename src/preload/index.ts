import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, CustomTheme } from '../shared/settingsTypes'
import type { PersistedState } from '../shared/stateTypes'

const terminalAPI = {
  // Session management
  createSession: (id: string, cwd?: string, shell?: string, cols?: number, rows?: number) =>
    ipcRenderer.invoke('pty:create', id, cwd, shell, cols, rows),

  write: (id: string, data: string) => {
    ipcRenderer.send('pty:write', id, data)
  },

  resize: (id: string, cols: number, rows: number) => {
    ipcRenderer.send('pty:resize', id, cols, rows)
  },

  kill: (id: string) => ipcRenderer.invoke('pty:kill', id),

  onData: (id: string, callback: (data: string) => void) => {
    const channel = `pty:data:${id}`
    const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },

  onExit: (id: string, callback: (exitCode: number) => void) => {
    const channel = `pty:exit:${id}`
    const handler = (_event: Electron.IpcRendererEvent, exitCode: number) => callback(exitCode)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },

  // Window controls
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),

  onMaximizeChange: (callback: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, val: boolean) => callback(val)
    ipcRenderer.on('window:maximized', handler)
    return () => {
      ipcRenderer.removeListener('window:maximized', handler)
    }
  },

  // Shell detection
  detectShells: () => ipcRenderer.invoke('shell:detect'),

  // System fonts
  getFonts: () => ipcRenderer.invoke('system:getFonts') as Promise<string[]>,

  // Theme import/export
  themeExport: (theme: CustomTheme) =>
    ipcRenderer.invoke('theme:export', theme) as Promise<{ success: boolean; error?: string }>,
  themeImport: () =>
    ipcRenderer.invoke('theme:import') as Promise<{ success: boolean; theme?: CustomTheme; error?: string }>,

  // Directory selection
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),

  // Settings
  settingsGetAll: () => ipcRenderer.invoke('settings:getAll') as Promise<AppSettings>,
  settingsSet: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    ipcRenderer.invoke('settings:set', key, value) as Promise<AppSettings>,

  // State persistence
  stateLoad: () => ipcRenderer.invoke('state:load') as Promise<PersistedState>,
  stateSave: (state: PersistedState) =>
    ipcRenderer.invoke('state:save', state) as Promise<{ success: boolean }>
}

contextBridge.exposeInMainWorld('terminalAPI', terminalAPI)

export type TerminalAPI = typeof terminalAPI
