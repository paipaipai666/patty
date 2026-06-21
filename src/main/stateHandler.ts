import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import { join } from 'path'
import type { PersistedState } from '../shared/stateTypes'

const DEFAULT_STATE: PersistedState = {
  sessions: [],
  collections: [],
  activeSessionId: null,
  sidebarVisible: true,
  sidebarWidth: 220
}

const STATE_FILE = join(app.getPath('userData'), 'state.json')
const OLD_APP_NAME = 'terminal-sidebar'

function migrateFromOldApp(): void {
  if (existsSync(STATE_FILE)) return

  const oldUserData = app.getPath('userData').replace(/[/\\]patty$/, `/${OLD_APP_NAME}`)
  const oldStateFile = join(oldUserData, 'state.json')

  if (existsSync(oldStateFile)) {
    try {
      const dir = join(STATE_FILE, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      copyFileSync(oldStateFile, STATE_FILE)
      console.log('Migrated state from', oldStateFile, 'to', STATE_FILE)
    } catch (err) {
      console.error('Failed to migrate state:', err)
    }
  }
}

migrateFromOldApp()

export function loadState(): PersistedState {
  if (!existsSync(STATE_FILE)) {
    return { ...DEFAULT_STATE }
  }
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_STATE,
      ...parsed,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      collections: Array.isArray(parsed.collections) ? parsed.collections : []
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function saveState(state: PersistedState): void {
  const dir = join(STATE_FILE, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = STATE_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(tmp, STATE_FILE)
}
