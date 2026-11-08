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

  it('observes browsing frames on the normal buffer when history uses a normal overlay', async () => {
    const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
    const callbacks: (() => void)[] = []
    const observed: unknown[] = []
    const observer = registerOmpFrameObserver(terminal, {
      visible: () => true, observe: position => observed.push(position),
      schedule: callback => callbacks.push(callback), cancel: () => {}
    })
    const frame = { mode: 'browsing', sessionId: 'session-1', branchEpoch: 1, displayEpoch: 2,
      viewRevision: 3, frameId: 'frame-normal', entryId: 'turn-1', anchor: { partId: 'question', scalarOffset: 0 } }
    const marker = `\x1b]777;patty-nav-v1;${Buffer.from(JSON.stringify(frame)).toString('base64url')}\x07`
    try {
      await new Promise<void>(resolve => terminal.write(`Conversation history\n${marker}`, resolve))
      observer.refresh()
      while (callbacks.length) callbacks.shift()?.()
      expect(observed).toEqual([frame])
    } finally { observer.dispose(); terminal.dispose() }
  })
})
