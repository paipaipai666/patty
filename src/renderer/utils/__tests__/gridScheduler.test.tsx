import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerGrid, unregisterGrid } from '../gridScheduler'


let rafCbs: FrameRequestCallback[] = []
let nowVal = 0

beforeEach(() => {
  rafCbs = []
  nowVal = 0
  vi.spyOn(performance, 'now').mockImplementation(() => nowVal)
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCbs.push(cb)
    return rafCbs.length
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  unregisterGrid({ tick: () => {} })
})

function frame(ts: number) {
  nowVal = ts
  const cbs = rafCbs
  rafCbs = []
  cbs.forEach((cb) => cb(ts))
}

describe('gridScheduler visibility pause (M5)', () => {
  it('skips grid ticks while the document is hidden', () => {
    const grid = { tick: vi.fn() }
    registerGrid(grid)


    frame(100)
    frame(200)
    frame(300)
    expect(grid.tick).toHaveBeenCalledTimes(1)


    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    frame(400)
    frame(500)
    frame(600)
    frame(700)

    expect(grid.tick).toHaveBeenCalledTimes(1)
  })
})
