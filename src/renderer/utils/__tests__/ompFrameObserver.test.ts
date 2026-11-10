import { describe, it, expect } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { registerOmpFrameObserver } from '../ompFrameObserver'

describe('OMP terminal frame observation', () => {
  it('observes same-stream frames after rendering and waits for hidden panes', async () => {
    const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
    const callbacks: (() => void)[] = []
    const observed: unknown[] = []
    let visible = false
    const observer = registerOmpFrameObserver(terminal, {
      visible: () => visible, observe: position => observed.push(position),
      schedule: callback => callbacks.push(callback), cancel: () => {}
    })
    const frame = { mode: 'browsing', sessionId: 'session-1', branchEpoch: 1, displayEpoch: 2,
      viewRevision: 3, frameId: 'frame-1', entryId: 'turn-1', anchor: { partId: 'question', scalarOffset: 0 } }
    const marker = `\x1b]777;patty-nav-v1;${Buffer.from(JSON.stringify(frame)).toString('base64url')}\x07`
    try {
      await new Promise<void>(resolve => terminal.write(`\x1b[?1049hfirst question${marker}`, resolve))
      while (callbacks.length) callbacks.shift()?.()
      expect(observed).toEqual([])
      visible = true
      observer.refresh()
      expect(observed).toEqual([])
      while (callbacks.length) callbacks.shift()?.()
      expect(observed).toEqual([frame])
      observer.refresh()
      while (callbacks.length) callbacks.shift()?.()
      expect(observed).toHaveLength(1)
      await new Promise<void>(resolve => terminal.write('\x1b[?1049l' + marker, resolve))
      while (callbacks.length) callbacks.shift()?.()
      expect(observed).toHaveLength(1)
    } finally { observer.dispose(); terminal.dispose() }
  })

  it('forwards transcript scroll metrics and rejects impossible ones', async () => {
    const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
    const metrics: unknown[] = []
    const observer = registerOmpFrameObserver(terminal, {
      visible: () => true, observe: () => {}, onScrollMetrics: value => metrics.push(value),
      schedule: () => 0, cancel: () => {}
    })
    const record = { sessionId: 'session-1', branchEpoch: 1, frameId: 'frame-1', entryId: 'turn-1', before: 750, total: 1000, visible: 100 }
    const marker = (value: unknown) => `\x1b]777;patty-nav-scroll-v1;${Buffer.from(JSON.stringify(value)).toString('base64url')}\x07`
    try {
      await new Promise<void>(resolve => terminal.write(marker(record), resolve))
      expect(metrics).toEqual([record])
      await new Promise<void>(resolve => terminal.write(marker({ ...record, before: 1001 }), resolve))
      await new Promise<void>(resolve => terminal.write(marker({ ...record, total: 0 }), resolve))
      expect(metrics).toHaveLength(1)
    } finally { observer.dispose(); terminal.dispose() }
  })
})
