import type { Terminal } from '@xterm/xterm'

const encoder = new TextEncoder()
let queuedBytes = 0
let peakQueuedBytes = 0

export const panes = new Map<string, PaneProbe>()

export function resetPeak(): void {
  peakQueuedBytes = queuedBytes
}

export function queueSnapshot() {
  return { queuedBytes, peakQueuedBytes }
}

export class PaneProbe {
  readyAt = 0
  renderedAt = 0
  receivedBytes = 0
  parsedBytes = 0
  chunks = 0
  queuedBytes = 0
  peakQueuedBytes = 0
  marker: { text: string; receivedAt: number; parsedAt: number } | null = null
  private disposed = false
  private readonly subscription

  constructor(readonly terminal: Terminal) {
    this.subscription = terminal.onRender(() => {
      if (terminal.element?.getClientRects().length) this.renderedAt = performance.now()
    })
  }

  receive(data: string): () => void {
    const bytes = encoder.encode(data).byteLength
    this.receivedBytes += bytes
    this.chunks++
    this.queuedBytes += bytes
    queuedBytes += bytes
    this.peakQueuedBytes = Math.max(this.peakQueuedBytes, this.queuedBytes)
    peakQueuedBytes = Math.max(peakQueuedBytes, queuedBytes)
    const marker = this.marker
    if (marker && marker.receivedAt === 0 && data.includes(marker.text)) marker.receivedAt = performance.now()
    return () => {
      if (this.disposed) return
      this.parsedBytes += bytes
      this.queuedBytes -= bytes
      queuedBytes -= bytes
      if (!marker || marker.parsedAt !== 0) return
      const buffer = this.terminal.buffer.active
      const cursor = buffer.baseY + buffer.cursorY
      for (let row = Math.max(0, cursor - 3); row <= cursor; row++) {
        if (buffer.getLine(row)?.translateToString(true).trim() === marker.text) {
          marker.parsedAt = performance.now()
          break
        }
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.subscription.dispose()
    queuedBytes -= this.queuedBytes
    this.queuedBytes = 0
  }
}
