import { create } from 'zustand'
import type { AppSettings } from '../../shared/settingsTypes'
import { DEFAULT_SETTINGS } from '../../shared/defaultSettings'
import { applyTheme, applyFontSettings, getThemeColors } from '../styles/themes'


function cacheBootTheme(theme: string, customThemes: AppSettings['customThemes']) {
  try {
    const colors = getThemeColors(theme, customThemes)
    localStorage.setItem('patty-theme', theme)
    localStorage.setItem('patty-boot-bg', colors.ui['--bg-app'])

    localStorage.setItem('patty-boot-ui', JSON.stringify(colors.ui))
    document.documentElement.dataset.theme = theme
  } catch {

  }
}

interface SettingsStore {
  settings: AppSettings
  loaded: boolean
  settingsOpen: boolean
                                                                             
  settingsCategory: string | null

  init: () => Promise<void>
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  openSettings: (category?: string) => void
  closeSettings: () => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  settingsOpen: false,
  settingsCategory: null,

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

      applyTheme(prev.theme, prev.customThemes)
      cacheBootTheme(prev.theme, prev.customThemes)
      applyFontSettings(prev.fontFamily, prev.fontSize)
    }
  },

  openSettings: (category) => set({ settingsOpen: true, settingsCategory: category ?? null }),
  closeSettings: () => set({ settingsOpen: false, settingsCategory: null })
}))
