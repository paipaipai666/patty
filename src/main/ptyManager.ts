import * as pty from 'node-pty'
import * as fs from 'fs'
import * as http from 'http'
import { execSync } from 'child_process'
import { BrowserWindow } from 'electron'

export interface PtySession {
  pty: pty.IPty
  id: string
}

const sessions = new Map<string, PtySession>()
let hookServer: http.Server | null = null
let hookPort = 0
let onHookRequest: ((paneId: string, event: string, source: string) => void) | null = null

const SHELL_PATHS: Record<string, string> = {
  powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  cmd: 'C:\\Windows\\System32\\cmd.exe',
  gitbash: 'C:\\Program Files\\Git\\bin\\bash.exe',
  wsl: 'C:\\Windows\\System32\\wsl.exe'
}

function findPwsh(): string | null {
  try {
    const result = execSync('where.exe pwsh', { encoding: 'utf-8', timeout: 5000 })
    const firstPath = result.split('\n')[0]?.trim()
    if (firstPath && fs.existsSync(firstPath)) return firstPath
  } catch {
    // where.exe failed — pwsh not in PATH
  }
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

export function createPty(id: string, cwd?: string, shell?: string, cols?: number, rows?: number): pty.IPty {
  const shellPath = getShellPath(shell)
  const workingDir = cwd || process.env.USERPROFILE || 'C:\\Users'

  const term = pty.spawn(shellPath, [], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: workingDir,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'TerminalSidebar',
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
  return term
}

export function writeToPty(id: string, data: string): void {
  const session = sessions.get(id)
  if (session) {
    session.pty.write(data)
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
  if (hookServer) {
    hookServer.close()
    hookServer = null
    hookPort = 0
    onHookRequest = null
  }
}

export function getHookPort(): number {
  return hookPort
}
