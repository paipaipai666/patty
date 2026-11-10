import { create } from 'zustand'
import type { HistoryScrollMetrics } from '../../shared/ompNavigationTypes'

interface OmpHistoryMetricsState {
  byPane: Record<string, HistoryScrollMetrics>
  record(paneId: string, metrics: HistoryScrollMetrics): void
}

export const useOmpHistoryMetricsStore = create<OmpHistoryMetricsState>(set => ({
  byPane: {},
  record(paneId, metrics) {
    set(state => {
      if (state.byPane[paneId]?.frameId === metrics.frameId) return state
      return { byPane: { ...state.byPane, [paneId]: metrics } }
    })
  }
}))