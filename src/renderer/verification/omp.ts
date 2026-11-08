import type { Terminal } from '@xterm/xterm'

const terminals = new Map<string, Terminal>()

export function attachNavigationTerminal(paneId: string, terminal: Terminal): () => void {
  terminals.set(paneId, terminal)
  return () => { if (terminals.get(paneId) === terminal) terminals.delete(paneId) }
}

const verification = {
  snapshot(paneId: string) {
    const terminal = terminals.get(paneId)
    if (!terminal) return null
    const buffer = terminal.buffer.active
    return { type: buffer.type, cols: terminal.cols, rows: terminal.rows, viewportY: buffer.viewportY,
      baseY: buffer.baseY, length: buffer.length,
      lines: Array.from({ length: terminal.rows }, (_, offset) => buffer.getLine(buffer.viewportY + offset)?.translateToString(true) ?? '') }
  },
  contains(paneId: string, text: string) {
    const terminal = terminals.get(paneId)
    if (!terminal) return false
    const buffer = terminal.buffer.active
    for (let index = 0; index < buffer.length; index++) {
      if (buffer.getLine(index)?.translateToString(true).includes(text)) return true
    }
    return false
  }
}

declare global {
  interface Window { __PATTY_OMP_VERIFY__?: typeof verification }
}

window.__PATTY_OMP_VERIFY__ = verification
