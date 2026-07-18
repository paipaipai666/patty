import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AppSettings } from '../../../shared/settingsTypes'

const mockSettingsGetAll = vi.fn()
const mockSettingsSet = vi.fn()

vi.stubGlobal('window', {
  terminalAPI: {
    settingsGetAll: mockSettingsGetAll,
    settingsSet: mockSettingsSet
  },
  addEventListener: vi.fn()
})

vi.stubGlobal('sessionStorage', {
  setItem: vi.fn()
})

const styleMap = new Map<string, string>()
const mockSetProperty = vi.fn((key: string, value: string) => { styleMap.set(key, value) })
const mockRemoveProperty = vi.fn((key: string) => { styleMap.delete(key) })

vi.stubGlobal('document', {
  documentElement: {
    style: {
      setProperty: mockSetProperty,
      removeProperty: mockRemoveProperty
    },
    dataset: {}
  }
})

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fontFamily: 'Cascadia Code',
  fontSize: 14,
  cursorStyle: 'bar',
  cursorBlink: true,
  opacity: 1.0,
  scrollback: 5000,
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
    openCode: true,
    codex: true
  }
}

import { useSettingsStore } from '../settingsStore'

beforeEach(() => {
  vi.clearAllMocks()
  styleMap.clear()
  useSettingsStore.setState({
    settings: DEFAULT_SETTINGS,
    loaded: false,
    settingsOpen: false
  })
})

describe('init', () => {
  it('loads settings from terminalAPI and applies theme', async () => {
    mockSettingsGetAll.mockResolvedValue(DEFAULT_SETTINGS)
    await useSettingsStore.getState().init()
    const state = useSettingsStore.getState()
    expect(state.loaded).toBe(true)
    expect(state.settings.theme).toBe('dark')
    expect(sessionStorage.setItem).toHaveBeenCalledWith('patty-theme', 'dark')
    expect(mockSetProperty).toHaveBeenCalled()
  })

  it('handles load failure gracefully', async () => {
    mockSettingsGetAll.mockRejectedValue(new Error('fail'))
    await useSettingsStore.getState().init()
    expect(useSettingsStore.getState().loaded).toBe(true)
  })
})

describe('updateSetting', () => {
  it('updates a setting optimistically', async () => {
    mockSettingsSet.mockResolvedValue(undefined)
    await useSettingsStore.getState().updateSetting('fontSize', 18)
    expect(useSettingsStore.getState().settings.fontSize).toBe(18)
    expect(mockSettingsSet).toHaveBeenCalledWith('fontSize', 18)
  })

  it('applies theme when theme setting changes', async () => {
    mockSettingsSet.mockResolvedValue(undefined)
    await useSettingsStore.getState().updateSetting('theme', 'light')
    expect(mockSetProperty).toHaveBeenCalled()
  })

  it('applies theme when customThemes changes', async () => {
    mockSettingsSet.mockResolvedValue(undefined)
    await useSettingsStore.getState().updateSetting('customThemes', [])
    expect(mockSetProperty).toHaveBeenCalled()
  })

  it('applies font when fontFamily changes', async () => {
    mockSettingsSet.mockResolvedValue(undefined)
    await useSettingsStore.getState().updateSetting('fontFamily', 'Fira Code')
    expect(mockSetProperty).toHaveBeenCalledWith(
      '--font-mono',
      "'Fira Code', Consolas, 'Courier New', monospace"
    )
  })

  it('rolls back on IPC failure', async () => {
    mockSettingsSet.mockRejectedValue(new Error('save failed'))
    await useSettingsStore.getState().updateSetting('fontSize', 100)
    // Should roll back to the original value
    expect(useSettingsStore.getState().settings.fontSize).toBe(14)
  })
})

describe('openSettings / closeSettings', () => {
  it('toggles settingsOpen', () => {
    useSettingsStore.getState().openSettings()
    expect(useSettingsStore.getState().settingsOpen).toBe(true)
    useSettingsStore.getState().closeSettings()
    expect(useSettingsStore.getState().settingsOpen).toBe(false)
  })
})
