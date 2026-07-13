import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '' }
}))

import { METRICS_SAMPLE_COST_MS, SAMPLE_INTERVAL_MS } from '../metricsCollector'

describe('metricsCollector sample interval (M8)', () => {
  it('derives the interval from measured captureSample cost with a safety margin', () => {
    // Empirical: captureSample is dominated by two parallel `Get-Counter`
    // powershell spawns measured at ~535ms wall on Windows. The interval must
    // stay above that so samples never overlap (the `running` guard is a
    // backstop). This locks the threshold to the measurement, not an arbitrary
    // constant.
    expect(METRICS_SAMPLE_COST_MS).toBeGreaterThan(0)
    expect(SAMPLE_INTERVAL_MS).toBeGreaterThan(METRICS_SAMPLE_COST_MS)
  })
})
