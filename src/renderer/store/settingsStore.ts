import { create } from 'zustand'
import type { AppSettings } from '../../shared/settingsTypes'
import { DEFAULT_SETTINGS } from '../../shared/defaultSettings'
import { applyTheme, applyFontSettings } from '../styles/themes'

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
      // Cache theme for synchronous boot on next launch (prevents dark flash)
      try {
        sessionStorage.setItem('patty-theme', settings.theme)
        document.documentElement.dataset.theme = settings.theme
      } catch {
        // ignore sessionStorage failures
      }
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
