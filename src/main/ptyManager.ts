import * as pty from 'node-pty'
import * as fs from 'fs'

export interface PtySession {
  pty: pty.IPty
  id: string
}

const sessions = new Map<string, PtySession>()

const SHELL_PATHS: Record<string, string> = {
  pwsh: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  cmd: 'C:\\Windows\\System32\\cmd.exe',
  gitbash: 'C:\\Program Files\\Git\\bin\\bash.exe',
  wsl: 'C:\\Windows\\System32\\wsl.exe'
}

export function detectDefaultShell(): string {
  if (fs.existsSync(SHELL_PATHS.pwsh)) return SHELL_PATHS.pwsh
  return SHELL_PATHS.powershell
}

export function detectAvailableShells(): Array<{ name: string; path: string; available: boolean }> {
  return Object.entries(SHELL_PATHS).map(([name, shellPath]) => ({
    name,
    path: shellPath,
    available: fs.existsSync(shellPath)
  }))
}

export function getShellPath(shellName?: string): string {
  if (!shellName) return detectDefaultShell()
  const key = shellName.toLowerCase()
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
      TERM_PROGRAM: 'TerminalSidebar'
    },
    useConpty: true,
    conptyInheritCursor: false
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
