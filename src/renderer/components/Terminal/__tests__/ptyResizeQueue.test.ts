import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPtyResizeQueue } from '../ptyResizeQueue'

afterEach(() => vi.useRealTimers())

describe('PTY resize acknowledgements', () => {
  it('retries a rejected resize even if the measured dimensions remain unchanged', async () => {
    vi.useFakeTimers()
    const send = vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValue(undefined)
    const error = vi.fn()
    const queue = createPtyResizeQueue(send, error)
    queue.reset({ cols: 80, rows: 24 })
    queue.request({ cols: 132, rows: 40 })
    await vi.advanceTimersByTimeAsync(100)
    expect(send.mock.calls).toEqual([[{ cols: 132, rows: 40 }], [{ cols: 132, rows: 40 }]])
    queue.request({ cols: 132, rows: 40 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(error).not.toHaveBeenCalled()
    queue.dispose()
  })

  it('coalesces intermediate sizes while an earlier request is in flight', async () => {
    let finish: () => void = () => {}
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const queue = createPtyResizeQueue(send, vi.fn())
    queue.reset({ cols: 80, rows: 24 })
    queue.request({ cols: 100, rows: 30 })
    queue.request({ cols: 120, rows: 35 })
    queue.request({ cols: 132, rows: 40 })
    finish()
    await Promise.resolve()
    expect(send.mock.calls).toEqual([[{ cols: 100, rows: 30 }], [{ cols: 132, rows: 40 }]])
    queue.dispose()
  })

  it('cancels retries when the process exits or the pane is disposed', async () => {
    vi.useFakeTimers()
    const send = vi.fn().mockRejectedValue(new Error('gone'))
    const queue = createPtyResizeQueue(send, vi.fn())
    queue.reset({ cols: 80, rows: 24 })
    queue.request({ cols: 132, rows: 40 })
    await vi.advanceTimersByTimeAsync(0)
    queue.reset(null)
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenCalledTimes(1)
    queue.dispose()
  })
})
