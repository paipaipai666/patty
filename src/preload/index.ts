import { contextBridge, ipcRenderer } from 'electron'

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
  detectShells: () => ipcRenderer.invoke('shell:detect')
}

contextBridge.exposeInMainWorld('terminalAPI', terminalAPI)

export type TerminalAPI = typeof terminalAPI
