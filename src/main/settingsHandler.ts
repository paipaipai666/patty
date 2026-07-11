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

export function loadSettings(): AppSettings {
  return loadJsonSync(FILE, DEFAULT_SETTINGS, mergeSettings)
}

export function saveSettings(settings: AppSettings): void {
  saveAtomicSync(FILE, settings)
}
