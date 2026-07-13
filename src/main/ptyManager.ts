import * as pty from 'node-pty'
import * as fs from 'fs'
import * as path from 'path'
import * as http from 'http'
import * as crypto from 'crypto'
import type { Socket } from 'net'
import { execSync } from 'child_process'
import { BrowserWindow, app } from 'electron'
import { perfTimerStart, perfTimerEnd } from '../shared/perf'
import { removePane } from './heartbeat'

export interface PtySession {
  pty: pty.IPty
  id: string
}

const sessions = new Map<string, PtySession>()
let hookServer: http.Server | null = null
let hookPort = 0
// Random per-process secret. Injected into every PTY's environment so the shell
// integration (patty-hook.ps1) can prove it is the legitimate local caller. A
// remote/external process can't reach the loopback-only server, and a spoofing
// local process can't guess the secret, so it gets 401.
let hookSecret = ''
let onHookRequest: ((paneId: string, event: string, source: string) => void) | null = null
const activeSockets = new Set<Socket>()

export function isIgnorableNetworkError(error: unknown): boolean {
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

function detectDefaultShell(): string {
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
      // Shared secret for the loopback hook server (see startHookServer). Empty
      // until the hook server is up; the shell integration sends it back on POST.
      PATTY_HOOK_SECRET: hookSecret,
      // OpenCode 插件目录 — only set if the user hasn't already configured one,
      // so we never clobber a real XDG_CONFIG_HOME.
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || process.env.USERPROFILE + '\\.config'
    },
    useConpty: true,
    conptyInheritCursor: false
  })

  // Handle PTY exit - cleanup session and notify renderer. Guard on the
  // active session so a replaced pty (same id, recreated) can't delete its
  // successor when the old process finally exits.
  term.onExit(({ exitCode }) => {
    if (sessions.get(id)?.pty !== term) return
    removePane(id)
    sessions.delete(id)
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Single exit source: notify the renderer on the per-pane channel its
      // TerminalPane subscribes to (pty:exit:<id>).
      mainWindow.webContents.send(`pty:exit:${id}`, exitCode)
    }
  })

  // A reused id must not leak the previous shell process or deliver duplicate
  // output. Kill and evict any prior session before registering the new one.
  const prior = sessions.get(id)
  if (prior) {
    try {
      prior.pty.kill()
    } catch {
      // Already exited; nothing to kill.
    }
    sessions.delete(id)
  }

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
    removePane(id)
    sessions.delete(id)
  }
}

export function startHookServer(handler: (paneId: string, event: string, source: string) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    if (hookServer) {
      resolve(hookPort)
      return
    }

    onHookRequest = handler

    // Generate the shared secret once, before the server starts accepting
    // connections. It is exposed to PTYs via PATTY_HOOK_SECRET so the shell
    // integration can present it on POST.
    hookSecret = crypto.randomBytes(32).toString('hex')

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
          const { paneId, event, source, secret } = data

          // Authenticate: reject any caller that can't present the per-process
          // secret (a local spoofing process, or anything without PATTY_HOOK_SECRET).
          if (secret !== hookSecret) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'unauthorized' }))
            return
          }

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
