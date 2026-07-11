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
