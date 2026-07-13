import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerGrid, unregisterGrid } from '../gridScheduler'

// Drive RAF manually so the tick cadence is deterministic.
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

    // Visible window: ticks happen (~every 180ms).
    frame(100)
    frame(200) // >= 180 since last → tick #1
    frame(300)
    expect(grid.tick).toHaveBeenCalledTimes(1)

    // Hide the tab and advance several frames — ticks must NOT happen.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    frame(400)
    frame(500)
    frame(600)
    frame(700)
    // DESIRED: still 1. Currently the loop ignores document.hidden and ticks
    // again (gets 2) — this fails.
    expect(grid.tick).toHaveBeenCalledTimes(1)
  })
})
