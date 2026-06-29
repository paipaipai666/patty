import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import { join } from 'path'
import type { AppSettings } from '../shared/settingsTypes'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fontFamily: 'Cascadia Code',
  fontSize: 14,
  cursorStyle: 'bar',
  cursorBlink: true,
  opacity: 1.0,
  defaultShell: 'powershell',
  sidebarPosition: 'left',
  shortcuts: {
    newTerminal: 'Ctrl+T',
    closeTerminal: 'Ctrl+W',
    nextTab: 'Ctrl+]',
    prevTab: 'Ctrl+[',
    toggleSidebar: 'Ctrl+B',
    settings: 'Ctrl+,',
    splitHorizontal: 'Ctrl+Shift+D',
    splitVertical: 'Ctrl+Shift+E',
    closePane: 'Ctrl+Shift+W'
  },
  customThemes: [],
  notifications: {
    claudeCode: true,
    openCode: true
  }
}

const SETTINGS_FILE = join(app.getPath('userData'), 'settings.json')
const OLD_APP_NAME = 'terminal-sidebar'

function migrateFromOldApp(): void {
  if (existsSync(SETTINGS_FILE)) return

  const oldUserData = app.getPath('userData').replace(/[/\\]patty$/, `/${OLD_APP_NAME}`)
  const oldSettingsFile = join(oldUserData, 'settings.json')

  if (existsSync(oldSettingsFile)) {
    try {
      const dir = join(SETTINGS_FILE, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      copyFileSync(oldSettingsFile, SETTINGS_FILE)
      console.log('Migrated settings from', oldSettingsFile, 'to', SETTINGS_FILE)
    } catch (err) {
      console.error('Failed to migrate settings:', err)
    }
  }
}

migrateFromOldApp()

export function loadSettings(): AppSettings {
  if (!existsSync(SETTINGS_FILE)) {
    return {
      ...DEFAULT_SETTINGS,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts },
      notifications: { ...DEFAULT_SETTINGS.notifications }
    }
  }
  try {
    const raw = readFileSync(SETTINGS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...parsed.shortcuts },
      notifications: { ...DEFAULT_SETTINGS.notifications, ...parsed.notifications }
    }
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts },
      notifications: { ...DEFAULT_SETTINGS.notifications }
    }
  }
}

export function saveSettings(settings: AppSettings): void {
  const dir = join(SETTINGS_FILE, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = SETTINGS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8')
  renameSync(tmp, SETTINGS_FILE)
}
