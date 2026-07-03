import * as pty from 'node-pty'
import * as fs from 'fs'
import * as path from 'path'
import * as http from 'http'
import type { Socket } from 'net'
import { execSync } from 'child_process'
import { BrowserWindow, app } from 'electron'
import { perfTimerStart, perfTimerEnd, perfCounter } from '../shared/perf'

export interface PtySession {
  pty: pty.IPty
  id: string
}

const sessions = new Map<string, PtySession>()
let hookServer: http.Server | null = null
let hookPort = 0
let onHookRequest: ((paneId: string, event: string, source: string) => void) | null = null
const activeSockets = new Set<Socket>()

function isIgnorableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: string }).code
  return code === 'EPIPE' || code === 'ECONNRESET' || code === 'ECONNABORTED'
}

const SHELL_PATHS: Record<string, string> = {
  powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  cmd: 'C:\\Windows\\System32\\cmd.exe',
  gitbash: 'C:\\Program Files\\Git\\bin\\bash.exe',
  wsl: 'C:\\Windows\\System32\\wsl.exe'
}

let pwshCache: string | null | undefined // undefined = not checked, null = not found

function findPwsh(): string | null {
  // Return cache if valid
  if (pwshCache !== undefined) {
    if (pwshCache === null) return null
    if (fs.existsSync(pwshCache)) return pwshCache
    // Cached path no longer exists — fall through to re-detect
  }

  perfTimerStart('shell:findPwsh')
  try {
    const result = execSync('where.exe pwsh', { encoding: 'utf-8', timeout: 5000 })
    const firstPath = result.split('\n')[0]?.trim()
    if (firstPath && fs.existsSync(firstPath)) {
      pwshCache = firstPath
      perfTimerEnd('shell:findPwsh')
      return firstPath
    }
  } catch {
    // where.exe failed — pwsh not in PATH
  }
  pwshCache = null
  perfTimerEnd('shell:findPwsh')
  return null
}

export function detectDefaultShell(): string {
  return findPwsh() ?? SHELL_PATHS.powershell
}

export function detectAvailableShells(): Array<{ name: string; path: string; available: boolean }> {
  const pwshPath = findPwsh()
  const shells = [{ name: 'pwsh', path: pwshPath ?? 'pwsh (not found)', available: !!pwshPath }]
  for (const [name, shellPath] of Object.entries(SHELL_PATHS)) {
    shells.push({ name, path: shellPath, available: fs.existsSync(shellPath) })
  }
  return shells
}

export function getShellPath(shellName?: string): string {
  if (!shellName) return detectDefaultShell()
  const key = shellName.toLowerCase()
  if (key === 'pwsh') return findPwsh() ?? detectDefaultShell()
  if (SHELL_PATHS[key] && fs.existsSync(SHELL_PATHS[key])) {
    return SHELL_PATHS[key]
  }
  return detectDefaultShell()
}

function getScriptPath(filename: string): string {
  const base = app.isPackaged
    ? process.resourcesPath
    : app.getAppPath()
  return path.join(base, 'scripts', 'shell-integration', filename)
}

function getShellSpawnArgs(shellPath: string): string[] {
  const name = path.basename(shellPath, '.exe').toLowerCase()

  // pwsh / powershell (含 pwsh-preview)
  // Shell integration loaded via -Command so it runs after $PROFILE.
  // -ExecutionPolicy Bypass only affects this pwsh instance.
  if (name.startsWith('pwsh') || name.startsWith('powershell')) {
    const scriptPath = getScriptPath('pwsh.ps1')
    return ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', `. '${scriptPath}'`]
  }

  // cmd.exe
  if (name === 'cmd') {
    const cmdFile = getScriptPath('cmd-prompt.cmd')
    return ['/k', cmdFile]
  }

  // gitbash / wsl / other — 不注入，维持现状
  return []
}

export function createPty(id: string, cwd?: string, shell?: string, cols?: number, rows?: number): pty.IPty {
  perfTimerStart('pty:create')
  const shellPath = getShellPath(shell)
  const workingDir = cwd || process.env.USERPROFILE || 'C:\\Users'
  const shellArgs = getShellSpawnArgs(shellPath)

  const term = pty.spawn(shellPath, shellArgs, {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: workingDir,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'vscode',
      PATTY_PANE_ID: id,
      PATTY_PORT: hookPort.toString(),
      PATTY_PIPE: 'patty-attention',
      // OpenCode 插件目录
      XDG_CONFIG_HOME: process.env.USERPROFILE + '\\.config'
    },
    useConpty: true,
    conptyInheritCursor: false
  })

  // Handle PTY exit - cleanup session and notify renderer
  term.onExit(({ exitCode }) => {
    sessions.delete(id)
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:exit', id, exitCode)
    }
  })

  sessions.set(id, { pty: term, id })
  perfTimerEnd('pty:create')
  return term
}

export function writeToPty(id: string, data: string): void {
  const session = sessions.get(id)
  if (session) {
    try {
      session.pty.write(data)
    } catch {
      // PTY may have exited; ignore write errors (EPIPE)
    }
  }
}

export function resizePty(id: string, cols: number, rows: number): void {
  const session = sessions.get(id)
  if (session) {
    try {
      session.pty.resize(cols, rows)
    } catch {
      // PTY may have exited; ignore resize errors
    }
  }
}

export function killPty(id: string): void {
  const session = sessions.get(id)
  if (session) {
    session.pty.kill()
    sessions.delete(id)
  }
}

export function getPtySession(id: string): PtySession | undefined {
  return sessions.get(id)
}

export function startHookServer(handler: (paneId: string, event: string, source: string) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    if (hookServer) {
      resolve(hookPort)
      return
    }

    onHookRequest = handler

    hookServer = http.createServer((req, res) => {
      // Catch EPIPE / ECONNRESET on broken connections so they don't bubble up
      // as uncaught exceptions in the main process.
      const socket = req.socket
      const onRequestError = (err: Error) => {
        if (!isIgnorableNetworkError(err)) {
          console.error('[hook-server] request error:', err)
        }
      }
      req.on('error', onRequestError)
      res.on('error', onRequestError)
      socket.on('error', onRequestError)

      const detachRequestErrorHandlers = () => {
        req.off('error', onRequestError)
        res.off('error', onRequestError)
        socket.off('error', onRequestError)
      }
      req.on('close', detachRequestErrorHandlers)
      res.on('finish', detachRequestErrorHandlers)

      if (req.method !== 'POST' || req.url !== '/hook') {
        res.writeHead(404)
        res.end()
        return
      }

      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          const { paneId, event, source } = data

          // Validate session exists
          if (!sessions.has(paneId)) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, ignored: true }))
            return
          }

          // Notify renderer with source
          if (onHookRequest) {
            onHookRequest(paneId, event, source || 'unknown')
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch {
          res.writeHead(400)
          res.end()
        }
      })
    })

    hookServer.on('connection', (socket) => {
      activeSockets.add(socket)
      socket.once('close', () => activeSockets.delete(socket))
    })

    hookServer.listen(0, '127.0.0.1', () => {
      const address = hookServer!.address()
      if (address && typeof address === 'object') {
        hookPort = address.port
        resolve(hookPort)
      } else {
        reject(new Error('Failed to get hook server port'))
      }
    })

    hookServer.on('error', reject)
  })
}

export function stopHookServer(): void {
  if (!hookServer) return

  // Stop accepting new connections and destroy any active sockets so the
  // process can shut down promptly even if a client (e.g. OpenCode) has
  // already closed its end of the connection.
  try {
    hookServer.close()
  } catch (err) {
    console.error('[hook-server] close error:', err)
  }

  for (const socket of activeSockets) {
    if (!socket.destroyed) {
      socket.destroy()
    }
  }
  activeSockets.clear()

  hookServer = null
  hookPort = 0
  onHookRequest = null
}

export function getHookPort(): number {
  return hookPort
}
