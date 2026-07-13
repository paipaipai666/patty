import { app } from 'electron'
import { join } from 'path'
import type { AppSettings } from '../shared/settingsTypes'
import { DEFAULT_SETTINGS } from '../shared/defaultSettings'
import { loadJsonSync, saveAtomicSync, migrateOldDataSync } from './jsonStore'

export { DEFAULT_SETTINGS }

const FILE = join(app.getPath('userData'), 'settings.json')

function mergeSettings(parsed: Record<string, unknown>, defaults: AppSettings): AppSettings {
  return {
    ...defaults,
    ...parsed,
    shortcuts: { ...defaults.shortcuts, ...(parsed.shortcuts as Record<string, unknown> || {}) },
    notifications: { ...defaults.notifications, ...(parsed.notifications as Record<string, unknown> || {}) }
  } as AppSettings
}

migrateOldDataSync(app.getPath('userData'), 'settings.json', 'terminal-sidebar')

// In-memory cache so repeated reads (every settings:get / settings:set) don't
// re-read and re-merge the JSON file. Invalidated whenever we persist.
let settingsCache: AppSettings | null = null

export function loadSettings(): AppSettings {
  if (settingsCache) return settingsCache
  settingsCache = loadJsonSync(FILE, DEFAULT_SETTINGS, mergeSettings)
  return settingsCache
}

export function saveSettings(settings: AppSettings): void {
  saveAtomicSync(FILE, settings)
  settingsCache = settings
}
