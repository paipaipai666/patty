import type { Terminal } from '@xterm/xterm'
import { markShellReady } from './shellReadiness'

export interface Osc7HandlerDisposable {
  dispose(): void
}

export function registerOsc7Handler(
  term: Terminal,
  sessionId: string,
  onCwd: (sessionId: string, cwd: string) => void
): Osc7HandlerDisposable {
  const disposable = term.parser.registerOscHandler(7, (data) => {
    const cwd = normalizeCwdFromOsc(data)
    if (cwd) {
      onCwd(sessionId, cwd)
    }
    markShellReady(sessionId)
    return true
  })

  return {
    dispose: () => disposable.dispose()
  }
}


   
function normalizeCwdFromOsc(data: string): string | null {
  const raw = data.replace(/^file:\/\/[^/\\]*[/\\]?/, '')
  if (!raw) return null
  try {
    const decoded = decodeURIComponent(raw).replace(/\//g, '\\')
    return decoded || null
  } catch {
    const fallback = raw.replace(/\//g, '\\')
    return fallback || null
  }
}
