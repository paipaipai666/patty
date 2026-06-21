import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs'
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
    settings: 'Ctrl+,'
  }
}

const SETTINGS_FILE = join(app.getPath('userData'), 'settings.json')

export function loadSettings(): AppSettings {
  if (!existsSync(SETTINGS_FILE)) {
    return { ...DEFAULT_SETTINGS, shortcuts: { ...DEFAULT_SETTINGS.shortcuts } }
  }
  try {
    const raw = readFileSync(SETTINGS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...parsed.shortcuts }
    }
  } catch {
    return { ...DEFAULT_SETTINGS, shortcuts: { ...DEFAULT_SETTINGS.shortcuts } }
  }
}

export function saveSettings(settings: AppSettings): void {
  const dir = join(SETTINGS_FILE, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = SETTINGS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8')
  renameSync(tmp, SETTINGS_FILE)
}
