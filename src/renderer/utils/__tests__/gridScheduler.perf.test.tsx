import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerGrid, unregisterGrid, MAX_ACTIVE_GRIDS } from '../gridScheduler'


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

describe('gridScheduler concurrency cap (M5)', () => {
  it('ticks at most MAX_ACTIVE_GRIDS grids in one cycle regardless of N', () => {
    const N = 40
    const grids = Array.from({ length: N }, () => ({ tick: vi.fn() }))
    grids.forEach((g) => registerGrid(g))


    frame(200)

    const tickedCount = grids.filter((g) => g.tick.mock.calls.length > 0).length
    expect(tickedCount).toBeLessThanOrEqual(MAX_ACTIVE_GRIDS)
    expect(tickedCount).toBe(MAX_ACTIVE_GRIDS)

    grids.forEach((g) => unregisterGrid(g))
  })

  it('rotates which grids tick across cycles so none stay frozen', () => {
    const N = 40
    const grids = Array.from({ length: N }, () => ({ tick: vi.fn() }))
    grids.forEach((g) => registerGrid(g))


    for (let i = 0; i < 5; i++) {
      frame(200 + i * 200)
    }


    const tickedAtLeastOnce = grids.filter((g) => g.tick.mock.calls.length > 0).length
    expect(tickedAtLeastOnce).toBe(N)

    grids.forEach((g) => unregisterGrid(g))
  })
})

describe('gridScheduler M5 empirical threshold', () => {
  it('measures per-grid redraw cost and a jank-budget crossover N*', () => {

    vi.spyOn(performance, 'now').mockRestore()


    const ROWS = 5
    const COLS = 60
    function representativeTick(): number {
      const heat = new Float32Array(ROWS * COLS)
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          heat[r * COLS + c] = heat[r * COLS + c] * 0.9 + Math.random() * 0.1
        }
      }
      let acc = 0
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          acc += heat[r * COLS + c]
        }
      }
      return acc
    }

    const JANK_BUDGET_MS = 50
    const SAMPLES = 200
    const t0 = performance.now()
    for (let i = 0; i < SAMPLES; i++) representativeTick()
    const t1 = performance.now()
    const C = (t1 - t0) / SAMPLES
    const Nstar = Math.floor(JANK_BUDGET_MS / C)

    // eslint-disable-next-line no-console
    console.log(`[M5] per-grid redraw C=${C.toFixed(4)}ms, jank-budget crossover N*=${Nstar}`)
    expect(C).toBeGreaterThan(0)

    expect(MAX_ACTIVE_GRIDS).toBeLessThan(Nstar)
  })
})
