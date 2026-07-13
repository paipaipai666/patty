import type { PersistedState } from '../../shared/stateTypes'

const FLUSH_DELAY_MS = 1000

let dirty = false
let flushTimer: ReturnType<typeof setTimeout> | null = null
let buildPersistedState: (() => PersistedState | null) | null = null

export function configureDirtyScheduler(builder: () => PersistedState | null): void {
  buildPersistedState = builder
}

export function markDirty(): void {
  if (dirty) return
  dirty = true
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushNow()
  }, FLUSH_DELAY_MS)
}

export function flushNow(): void {
  if (!buildPersistedState) {
    // No builder yet (e.g. a flush fired before configureDirtyScheduler).
    // Still clear the dirty flag, or the next markDirty becomes a no-op and
    // state is never persisted again until beforeunload.
    dirty = false
    return
  }
  dirty = false
  const state = buildPersistedState()
  if (state) {
    window.terminalAPI.stateSave(state)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    flushNow()
  })
}
