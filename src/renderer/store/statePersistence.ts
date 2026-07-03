import type { PersistedState } from '../../shared/stateTypes'

const SAVE_DELAY_MS = 500

let saveTimer: ReturnType<typeof setTimeout> | null = null
let buildPersistedState: (() => PersistedState | null) | null = null

/**
 * Register the app-level state builder.
 *
 * sessionStore owns sessions/sidebar/collections; workspaceStore owns
 * workspaces and the active workspace id. This coordinator lets both stores
 * request persistence without importing each other. App wires the builder
 * once both stores are available.
 */
export function configureStatePersistence(builder: () => PersistedState | null): void {
  buildPersistedState = builder
}

/** Debounced save request used by both sessionStore and workspaceStore mutations. */
export function requestStateSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveStateNow()
  }, SAVE_DELAY_MS)
}

/** Flush state immediately. Used by explicit saveState calls and tests/manual checks. */
export function saveStateNow(): void {
  if (!buildPersistedState) return
  const state = buildPersistedState()
  if (state) {
    window.terminalAPI.stateSave(state)
  }
}

/** Register flush-on-close handler so pending writes aren't lost. */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      saveStateNow()
    }
  })
}
