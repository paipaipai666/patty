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
    void flushNow()
  }, FLUSH_DELAY_MS)
}

export async function flushNow(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!buildPersistedState) {
    dirty = false
    return
  }
  dirty = false
  const state = buildPersistedState()
  if (state) {
    await window.terminalAPI.stateSave(state)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    void flushNow()
  })
}
