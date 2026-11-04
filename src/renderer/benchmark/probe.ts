import type { Terminal } from '@xterm/xterm'
import { observeParsing } from './parseTiming'

const encoder = new TextEncoder()
const receipts = new Map<number, { bytes: number; events: number }>()
let queuedBytes = 0
let peakQueuedBytes = 0

export const panes = new Map<string, PaneProbe>()

export function receiptBuckets() {
  return [...receipts].map(([at, { bytes, events }]) => [at, bytes, events])
}

export function resetPeak(): void {
  peakQueuedBytes = queuedBytes
}

export function queueSnapshot() {
  return { queuedBytes, peakQueuedBytes }
}

export class PaneProbe {
  readonly parsing = {
    visible: { calls: 0, elapsedMs: 0 },
    hidden: { calls: 0, elapsedMs: 0 }
  }
  readyAt = 0
  renderedAt = 0
  receivedBytes = 0
  parsedBytes = 0
  chunks = 0
  queuedBytes = 0
  peakQueuedBytes = 0
  marker: { text: string; tail: string; receivedAt: number; parsedAt: number } | null = null
  private disposed = false
  private readonly subscription
  private readonly restoreParsing

  constructor(readonly terminal: Terminal, isVisible: () => boolean = () => true) {
    this.restoreParsing = observeParsing(terminal, (elapsedMs) => {
      const group = isVisible() ? this.parsing.visible : this.parsing.hidden
      group.calls++
      group.elapsedMs += elapsedMs
    })
    this.subscription = terminal.onRender(() => {
      if (terminal.element?.getClientRects().length) this.renderedAt = performance.now()
    })
  }

  receive(data: string): () => void {
    const now = performance.now()
    const bytes = encoder.encode(data).byteLength
    const bucketStart = Math.floor((performance.timeOrigin + now) / 20) * 20
    let bucket = receipts.get(bucketStart)
    if (!bucket) {
      bucket = { bytes: 0, events: 0 }
      receipts.set(bucketStart, bucket)
    }
    bucket.bytes += bytes
    bucket.events++
    this.receivedBytes += bytes
    this.chunks++
    this.queuedBytes += bytes
    queuedBytes += bytes
    this.peakQueuedBytes = Math.max(this.peakQueuedBytes, this.queuedBytes)
    peakQueuedBytes = Math.max(peakQueuedBytes, queuedBytes)
    const marker = this.marker
    if (marker && marker.receivedAt === 0) {
      const carryLength = marker.text.length - 1
      if (data.includes(marker.text) || (marker.tail + data.slice(0, carryLength)).includes(marker.text)) {
        marker.receivedAt = now
        marker.tail = ''
      } else {
        marker.tail = (marker.tail + data.slice(-carryLength)).slice(-carryLength)
      }
    }
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
    this.restoreParsing()
    queuedBytes -= this.queuedBytes
    this.queuedBytes = 0
  }
}
