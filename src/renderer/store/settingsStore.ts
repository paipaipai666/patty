import { create } from 'zustand'
import type { AppSettings } from '../../shared/settingsTypes'
import { DEFAULT_SETTINGS } from '../../shared/defaultSettings'
import { applyTheme, applyFontSettings, getThemeColors } from '../styles/themes'

// Persist the resolved theme background so the next launch can paint the
// window (Rust) and the boot splash (inline script in index.html) in the
// right color before any JS/settings load. localStorage, not sessionStorage:
// WebView2 clears sessionStorage on app exit, so the cache would always miss
// exactly when it's needed — at cold start.
function cacheBootTheme(theme: string, customThemes: AppSettings['customThemes']) {
  try {
    localStorage.setItem('patty-theme', theme)
    localStorage.setItem('patty-boot-bg', getThemeColors(theme, customThemes).ui['--bg-app'])
    document.documentElement.dataset.theme = theme
  } catch {
    // ignore localStorage failures
  }
}

interface SettingsStore {
  settings: AppSettings
  loaded: boolean
  settingsOpen: boolean

  init: () => Promise<void>
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  openSettings: () => void
  closeSettings: () => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  settingsOpen: false,

  init: async () => {
    try {
      const settings = await window.terminalAPI.settingsGetAll()
      set({ settings, loaded: true })
      cacheBootTheme(settings.theme, settings.customThemes)
      applyTheme(settings.theme, settings.customThemes)
      applyFontSettings(settings.fontFamily, settings.fontSize)
    } catch (err) {
      console.error('Failed to load settings:', err)
      set({ loaded: true })
    }
  },

  updateSetting: async (key, value) => {
    const prev = get().settings
    const next = { ...prev, [key]: value }
    set({ settings: next })

    if (key === 'theme' || key === 'customThemes') {
      const theme = key === 'theme' ? (value as string) : prev.theme
      const customs = key === 'customThemes' ? (value as AppSettings['customThemes']) : prev.customThemes
      applyTheme(theme, customs)
      cacheBootTheme(theme, customs)
    }
    if (key === 'fontFamily' || key === 'fontSize') {
      applyFontSettings(
        key === 'fontFamily' ? (value as string) : prev.fontFamily,
        key === 'fontSize' ? (value as number) : prev.fontSize
      )
    }

    try {
      await window.terminalAPI.settingsSet(key, value)
    } catch (err) {
      console.error('Failed to save setting:', err)
      set({ settings: prev })
    }
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false })
}))
