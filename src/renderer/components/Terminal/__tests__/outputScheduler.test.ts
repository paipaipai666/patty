import { describe, expect, it, vi } from 'vitest'
import { createOutputScheduler } from '../outputScheduler'
import { Terminal } from '@xterm/xterm'

function fixture(batchSize = 1) {
  const tasks: Array<() => void> = []
  const scheduler = createOutputScheduler((task) => tasks.push(task), batchSize)
  return { scheduler, run: () => tasks.shift()?.() }
}

describe('shared terminal output scheduling', () => {
  it('lets other terminals progress when an asynchronous parser is still waiting', () => {
    vi.useFakeTimers()
    try {
      const { scheduler, run } = fixture(8)
      const output: string[] = []
      const waiting = scheduler.open(false)
      const healthy = scheduler.open(false)
      let finishWaiting = () => {}
      waiting.push((done) => { output.push('waiting'); finishWaiting = done })
      for (let index = 1; index < 8; index++) waiting.push((done) => done())
      waiting.push(() => output.push('still ordered'))
      healthy.push((done) => { output.push('healthy'); done() })
      run()
      vi.advanceTimersByTime(8)
      run()
      expect(output).toEqual(['waiting', 'healthy'])
      finishWaiting()
      run()
      expect(output).toEqual(['waiting', 'healthy', 'still ordered'])
      waiting.dispose()
      healthy.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
  it('caps a hidden turn and yields to another terminal before continuing a flood', () => {
    const { scheduler, run } = fixture(8)
    const output: number[] = []
    const busy = scheduler.open(false)
    const other = scheduler.open(false)
    for (let index = 0; index < 10; index++) busy.push((done) => { output.push(index); done() })
    other.push((done) => { output.push(99); done() })
    run()
    expect(output).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    run()
    expect(output).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 99])
    run()
    expect(output).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 99, 8, 9])
  })
  it('keeps visible output responsive while hidden terminals take turns', () => {
    const { scheduler, run } = fixture()
    const output: string[] = []
    const completed: Array<() => void> = []
    const a = scheduler.open(false)
    const b = scheduler.open(false)
    const foreground = scheduler.open(true)
    for (const [lane, text] of [[a, 'a1'], [a, 'a2'], [b, 'b1']] as const) {
      lane.push((done) => { output.push(text); completed.push(done) })
    }
    run()
    foreground.push((done) => { output.push('foreground'); done() })
    expect(output).toEqual(['a1', 'foreground'])
    run()
    expect(output).toEqual(['a1', 'foreground'])
    completed.shift()?.()
    run()
    expect(output).toEqual(['a1', 'foreground', 'b1'])
    completed.shift()?.()
    run()
    expect(output).toEqual(['a1', 'foreground', 'b1', 'a2'])
  })

  it('promotes pending output in order without replaying an active batch', () => {
    const { scheduler, run } = fixture()
    const output: string[] = []
    const completed: Array<() => void> = []
    const lane = scheduler.open(false)
    lane.push((done) => { output.push('first'); completed.push(done) })
    lane.push((done) => { output.push('second'); completed.push(done) })
    run()
    lane.setVisible(true)
    expect(output).toEqual(['first'])
    completed.shift()?.()
    expect(output).toEqual(['first', 'second'])
    completed.shift()?.()
    run()
    expect(output).toEqual(['first', 'second'])
  })

  it('releases a failed terminal without acknowledging or running its queued work', () => {
    const { scheduler, run } = fixture(8)
    const output: string[] = []
    const failed = scheduler.open(false)
    const other = scheduler.open(false)
    failed.push(() => { throw new Error('write failed') })
    failed.push(() => output.push('invalid continuation'))
    other.push((done) => { output.push('healthy terminal'); done() })
    expect(run).toThrow('write failed')
    run()
    expect(output).toEqual(['healthy terminal'])
  })

  it('closing a lane cancels queued work and releases the shared slot', () => {
    const { scheduler, run } = fixture()
    const output: string[] = []
    const closed = scheduler.open(false)
    const other = scheduler.open(false)
    let oldDone = () => {}
    closed.push((done) => { output.push('old'); oldDone = done })
    closed.push(() => output.push('cancelled'))
    other.push((done) => { output.push('other'); done() })
    run()
    closed.dispose()
    run()
    oldDone()
    expect(output).toEqual(['old', 'other'])
  })

  it('continues hidden terminal queries and split control sequences through real xterm', async () => {
    const { scheduler, run } = fixture()
    const terminal = new Terminal({ cols: 20, rows: 4, allowProposedApi: true })
    const lane = scheduler.open(false)
    const replies: string[] = []
    const directories: string[] = []
    terminal.onData((data) => replies.push(data))
    terminal.parser.registerOscHandler(7, (data) => { directories.push(data); return true })
    try {
      const first = new Promise<void>((resolve) => lane.push((done) =>
        terminal.write('\x1b]7;file:///work', () => { done(); resolve() })))
      const last = new Promise<void>((resolve) => lane.push((done) =>
        terminal.write('/project\x07A中\r\nB\x1b[6n', () => { done(); resolve() })))
      run()
      await first
      run()
      await last
      expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('A中')
      expect(terminal.buffer.active.getLine(1)?.translateToString(true)).toBe('B')
      expect(directories).toEqual(['file:///work/project'])
      expect(replies).toEqual(['\x1b[2;2R'])
    } finally {
      lane.dispose()
      terminal.dispose()
    }
  })
})
