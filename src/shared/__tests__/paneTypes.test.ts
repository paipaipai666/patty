import { describe, it, expect } from 'vitest'
import { clampRatioToPixels, MIN_PANE_PX, clampRatio } from '../paneTypes'

describe('clampRatio', () => {
  it('keeps a ratio inside the ratio-only bounds', () => {
    expect(clampRatio(0.5)).toBe(0.5)
    expect(clampRatio(0)).toBe(0.1)
    expect(clampRatio(1)).toBe(0.9)
  })
})

describe('clampRatioToPixels', () => {
  it('leaves a ratio that keeps both panes above the pixel floor alone', () => {
    expect(clampRatioToPixels(0.5, 1000)).toBe(0.5)
  })

  it('raises the floor to the minimum pixel pane when the container is small', () => {
    expect(clampRatioToPixels(0.01, 300)).toBe(MIN_PANE_PX / 300)
  })

  it('caps the ceiling so the second pane keeps the minimum pixel width', () => {
    expect(clampRatioToPixels(0.99, 300)).toBe(1 - MIN_PANE_PX / 300)
  })

  it('never lets a floor or a ceiling cross each other', () => {
    const floor = MIN_PANE_PX / 300
    const ceiling = 1 - MIN_PANE_PX / 300
    expect(floor).toBeLessThan(ceiling)
    expect(clampRatioToPixels(0.5, 300)).toBeGreaterThanOrEqual(floor)
    expect(clampRatioToPixels(0.5, 300)).toBeLessThanOrEqual(ceiling)
  })

  it('falls back to the ratio-only bounds when the container size is unknown', () => {
    expect(clampRatioToPixels(0.5, 0)).toBe(0.5)
    expect(clampRatioToPixels(0, 0)).toBe(0.1)
    expect(clampRatioToPixels(1, 0)).toBe(0.9)
  })

  it('degenerates to half and half when the container cannot hold two minimum panes', () => {
    expect(clampRatioToPixels(0.2, MIN_PANE_PX)).toBe(0.5)
  })
})
