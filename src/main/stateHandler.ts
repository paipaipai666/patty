import { app } from 'electron'
import { join } from 'path'
import type { PersistedState } from '../shared/stateTypes'
import { loadJsonSync, saveAtomicSync, migrateOldDataSync } from './jsonStore'

const DEFAULT_STATE: PersistedState = {
  sessions: [],
  collections: [],
  activeSessionId: null,
  sidebarVisible: true,
  sidebarWidth: 220,
  workspaces: [],
  activeWorkspaceId: null,
  paneTree: null,
  focusedPaneId: null
}

const FILE = join(app.getPath('userData'), 'state.json')

function mergeState(parsed: Record<string, unknown>, defaults: PersistedState): PersistedState {
  return {
    ...defaults,
    ...parsed,
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    collections: Array.isArray(parsed.collections) ? parsed.collections : []
  } as PersistedState
}

migrateOldDataSync(app.getPath('userData'), 'state.json', 'terminal-sidebar')

export function loadState(): PersistedState {
  return loadJsonSync(FILE, DEFAULT_STATE, mergeState)
}

export function saveState(state: PersistedState): void {
  saveAtomicSync(FILE, state)
}

// Guard against a malformed/partial state payload (e.g. from a buggy renderer
// build or a corrupted IPC message) being written over good persisted state.
// Throws on anything that isn't a structurally valid PersistedState.
export function validatePersistedState(state: unknown): asserts state is PersistedState {
  if (!state || typeof state !== 'object') {
    throw new Error('Invalid state payload: not an object')
  }
  const s = state as Record<string, unknown>
  if (!Array.isArray(s.sessions)) throw new Error('Invalid state: sessions must be an array')
  if (!Array.isArray(s.collections)) throw new Error('Invalid state: collections must be an array')
  if (typeof s.sidebarWidth !== 'number') throw new Error('Invalid state: sidebarWidth must be a number')
  if (typeof s.sidebarVisible !== 'boolean') throw new Error('Invalid state: sidebarVisible must be a boolean')
}
