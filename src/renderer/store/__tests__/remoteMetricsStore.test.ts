import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.stubGlobal('window', { terminalAPI: {} })

import { useRemoteMetricsStore, MAX_SAMPLES } from '../remoteMetricsStore'
import { useSessionStore } from '../sessionStore'
import type { RawStats } from '../../../shared/settingsTypes'

function raw(overrides: Partial<RawStats> = {}): RawStats {
  return {
    cpuJiffies: [100, 0, 50, 800, 10, 5, 5, 30],
    memTotalKb: 1000,
    memAvailKb: 250,
    swapTotalKb: 500,
    swapFreeKb: 250,
    rxBytes: 1024 * 1024,
    txBytes: 1024 * 512,
    diskTotalKb: 2000,
    diskUsedKb: 1500,
    ...overrides
  }
}

const ID = 'sess-metrics-test'

describe('remoteMetricsStore', () => {
  beforeEach(() => {
    useRemoteMetricsStore.setState({ byId: {} })
  })

  it('first sample reports zero for rate fields, absolute fields computed', () => {
    useRemoteMetricsStore.getState().ingest(ID, raw(), 10_000)
    const entry = useRemoteMetricsStore.getState().byId[ID]
    expect(entry.samples).toHaveLength(1)
    const s = entry.samples[0]
    expect(s.cpuPct).toBe(0)
    expect(s.rxKBps).toBe(0)
    expect(s.txKBps).toBe(0)
    expect(s.memPct).toBeCloseTo(75)
    expect(s.swapPct).toBeCloseTo(50)
    expect(s.diskUsedPct).toBeCloseTo(75)
    expect(s.diskUsedKB).toBe(1500)
    expect(s.diskTotalKB).toBe(2000)
  })

  it('second sample computes cpuPct and network rates from deltas', () => {
    const { ingest } = useRemoteMetricsStore.getState()
    ingest(ID, raw(), 10_000)
    // +100 total jiffies (Σ 1000 → 1100), +60 idle+iowait (810 → 870),
    // +204800 bytes rx over 2s = 100 KB/s, tx unchanged.
    ingest(
      ID,
      raw({ cpuJiffies: [140, 0, 60, 850, 20, 5, 5, 20], rxBytes: 1024 * 1024 + 204800 }),
      12_000
    )
    const s = useRemoteMetricsStore.getState().byId[ID].samples[1]
    expect(s.cpuPct).toBeCloseTo((1 - 60 / 100) * 100)
    expect(s.rxKBps).toBeCloseTo(100)
    expect(s.txKBps).toBe(0)
  })

  it('drops samples with non-positive dt', () => {
    const { ingest } = useRemoteMetricsStore.getState()
    ingest(ID, raw(), 10_000)
    ingest(ID, raw({ rxBytes: 9999999 }), 10_000) // same timestamp
    const entry = useRemoteMetricsStore.getState().byId[ID]
    expect(entry.samples).toHaveLength(1)
    // Base preserved: next delta still measured against the first round.
    expect(entry.lastRaw?.rxBytes).toBe(1024 * 1024)
  })

  it('clamps counter regressions to zero', () => {
    const { ingest } = useRemoteMetricsStore.getState()
    ingest(ID, raw(), 10_000)
    ingest(ID, raw({ rxBytes: 100, txBytes: 50 }), 12_000)
    const s = useRemoteMetricsStore.getState().byId[ID].samples[1]
    expect(s.rxKBps).toBe(0)
    expect(s.txKBps).toBe(0)
  })

  it('cpuPct is zero when total jiffies delta is zero', () => {
    const { ingest } = useRemoteMetricsStore.getState()
    ingest(ID, raw(), 10_000)
    ingest(ID, raw(), 12_000)
    expect(useRemoteMetricsStore.getState().byId[ID].samples[1].cpuPct).toBe(0)
  })

  it('swapPct is zero when there is no swap', () => {
    useRemoteMetricsStore.getState().ingest(ID, raw({ swapTotalKb: 0, swapFreeKb: 0 }), 10_000)
    expect(useRemoteMetricsStore.getState().byId[ID].samples[0].swapPct).toBe(0)
  })

  it(`caps history at ${MAX_SAMPLES} samples`, () => {
    const { ingest } = useRemoteMetricsStore.getState()
    for (let i = 0; i < MAX_SAMPLES + 1; i++) {
      ingest(ID, raw({ rxBytes: 1024 * 1024 + i * 1024 }), 10_000 + i * 2000)
    }
    const samples = useRemoteMetricsStore.getState().byId[ID].samples
    expect(samples).toHaveLength(MAX_SAMPLES)
    expect(samples[samples.length - 1].t).toBe(10_000 + MAX_SAMPLES * 2000)
  })

  it('setRunning and setStale toggle lifecycle flags', () => {
    const store = useRemoteMetricsStore.getState()
    store.setRunning(ID, true)
    expect(useRemoteMetricsStore.getState().byId[ID].running).toBe(true)
    store.setStale(ID)
    const entry = useRemoteMetricsStore.getState().byId[ID]
    expect(entry.stale).toBe(true)
    expect(entry.running).toBe(false)
  })

  it('drops metrics state when the session is removed', () => {
    const sessionId = useSessionStore.getState().addSession({ cwd: 'C:\\', shell: 'powershell' })
    useRemoteMetricsStore.getState().ingest(sessionId, raw(), 10_000)
    expect(useRemoteMetricsStore.getState().byId[sessionId]).toBeDefined()
    useSessionStore.getState().removeSession(sessionId)
    expect(useRemoteMetricsStore.getState().byId[sessionId]).toBeUndefined()
  })
})
