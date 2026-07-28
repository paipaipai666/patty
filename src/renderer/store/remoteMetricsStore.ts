import { create } from 'zustand'
import type { RawStats } from '../../shared/settingsTypes'
import { useSessionStore } from './sessionStore'

export const MAX_SAMPLES = 120

export interface MonitorSample {
  t: number
  cpuPct: number
  memPct: number
  swapPct: number
  rxKBps: number
  txKBps: number
  diskUsedPct: number
  diskUsedKB: number
  diskTotalKB: number
}

interface SessionMetrics {
  samples: MonitorSample[]
  lastRaw: RawStats | null
  running: boolean
  stale: boolean
}

interface RemoteMetricsStore {
  byId: Record<string, SessionMetrics>
  ingest: (id: string, raw: RawStats, now?: number) => void
  setRunning: (id: string, running: boolean) => void
  setStale: (id: string) => void
  clear: (id: string) => void
}

const emptyEntry = (): SessionMetrics => ({ samples: [], lastRaw: null, running: false, stale: false })

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

/**
 * Derive one display sample from a raw collection round. Rate fields need a
 * previous round: the first sample reports 0 for CPU%/network; a non-positive
 * dt drops the sample (returns null); counter regressions clamp to 0.
 */
function computeSample(
  prev: MonitorSample | null,
  prevRaw: RawStats | null,
  raw: RawStats,
  now: number
): MonitorSample | null {
  const memPct = raw.memTotalKb > 0 ? ((raw.memTotalKb - raw.memAvailKb) / raw.memTotalKb) * 100 : 0
  const swapPct = raw.swapTotalKb > 0 ? ((raw.swapTotalKb - raw.swapFreeKb) / raw.swapTotalKb) * 100 : 0
  const diskUsedPct = raw.diskTotalKb > 0 ? (raw.diskUsedKb / raw.diskTotalKb) * 100 : 0

  let cpuPct = 0
  let rxKBps = 0
  let txKBps = 0
  if (prev && prevRaw) {
    const dt = (now - prev.t) / 1000
    if (dt <= 0) return null
    const totalDelta = sum(raw.cpuJiffies) - sum(prevRaw.cpuJiffies)
    const idleDelta =
      raw.cpuJiffies[3] + raw.cpuJiffies[4] - (prevRaw.cpuJiffies[3] + prevRaw.cpuJiffies[4])
    cpuPct = totalDelta > 0 ? Math.max(0, (1 - idleDelta / totalDelta) * 100) : 0
    rxKBps = Math.max(0, raw.rxBytes - prevRaw.rxBytes) / 1024 / dt
    txKBps = Math.max(0, raw.txBytes - prevRaw.txBytes) / 1024 / dt
  }

  return {
    t: now,
    cpuPct,
    memPct,
    swapPct,
    rxKBps,
    txKBps,
    diskUsedPct,
    diskUsedKB: raw.diskUsedKb,
    diskTotalKB: raw.diskTotalKb
  }
}

export const useRemoteMetricsStore = create<RemoteMetricsStore>((set) => ({
  byId: {},

  ingest: (id, raw, now = Date.now()) =>
    set((s) => {
      const entry = s.byId[id] ?? emptyEntry()
      const prev = entry.samples[entry.samples.length - 1] ?? null
      const sample = computeSample(prev, entry.lastRaw, raw, now)
      // Dropped sample (dt<=0): keep the old base so the next delta stays sane.
      if (!sample) return s
      return {
        byId: {
          ...s.byId,
          [id]: {
            ...entry,
            samples: [...entry.samples, sample].slice(-MAX_SAMPLES),
            lastRaw: raw,
            stale: false
          }
        }
      }
    }),

  setRunning: (id, running) =>
    set((s) => {
      const entry = s.byId[id] ?? emptyEntry()
      return { byId: { ...s.byId, [id]: { ...entry, running, stale: running ? false : entry.stale } } }
    }),

  setStale: (id) =>
    set((s) => {
      const entry = s.byId[id] ?? emptyEntry()
      return { byId: { ...s.byId, [id]: { ...entry, stale: true, running: false } } }
    }),

  clear: (id) =>
    set((s) => {
      if (!(id in s.byId)) return s
      const byId = { ...s.byId }
      delete byId[id]
      return { byId }
    })
}))

// Sessions die independently of the monitor panel: drop their metrics state.
useSessionStore.subscribe((state) => {
  const alive = new Set(state.sessions.map((s) => s.id))
  const { byId, clear } = useRemoteMetricsStore.getState()
  for (const id of Object.keys(byId)) {
    if (!alive.has(id)) clear(id)
  }
})
