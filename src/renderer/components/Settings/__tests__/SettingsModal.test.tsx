import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

const { mockUpdateSetting, mockCloseSettings, settingsState } = vi.hoisted(() => {
  const mockUpdateSetting = vi.fn().mockResolvedValue(undefined)
  const mockCloseSettings = vi.fn()
  const settingsState = {
    settings: {
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
      notifications: { claudeCode: true, openCode: true, codex: true }
    },
    settingsOpen: true,
    closeSettings: mockCloseSettings,
    updateSetting: mockUpdateSetting,
    init: vi.fn().mockResolvedValue(undefined),
    openSettings: vi.fn(),
    loaded: true
  }
  return { mockUpdateSetting, mockCloseSettings, settingsState }
})

vi.mock('../../../store/settingsStore', () => {
  const useSettingsStore = (sel: (s: typeof settingsState) => unknown) => sel(settingsState)
  useSettingsStore.getState = () => settingsState
  return { useSettingsStore }
})

vi.mock('../../../hooks/useAnimatedMount', () => ({
  useAnimatedMount: (open: boolean) => ({ mounted: open, exiting: false })
}))

vi.mock('../../utils/themeRipple', () => ({
  themeRipple: vi.fn()
}))

vi.mock('../../../styles/themes', () => ({
  getThemeColors: () => ({ ui: { '--bg-app': '#0a0a0c' } }),
  createDefaultCustomTheme: (name: string) => ({ id: 'custom-1', name, ui: {}, terminal: {} }),
  UI_COLOR_LABELS: { '--bg-app': 'App Background' },
  XTERM_COLOR_LABELS: { '--black': 'Black' },
  BUILTIN_THEMES: { dark: { name: 'Dark' } }
}))

vi.mock('../../../store/toastStore', () => ({
  toast: vi.fn()
}))

import { SettingsModal } from '../SettingsModal'

beforeEach(() => {
  vi.clearAllMocks()
  settingsState.settingsOpen = true
  document.body.innerHTML = ''
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<SettingsModal />) })
  return { container, root }
}

describe('SettingsModal', () => {
  it('returns null when settingsOpen=false', () => {
    settingsState.settingsOpen = false
    const { container } = render()
    expect(container.innerHTML).toBe('')
  })

  it('renders modal with all 5 category nav items when open', () => {
    const { container } = render()
    expect(container.textContent).toContain('Appearance')
    expect(container.textContent).toContain('Terminal')
    expect(container.textContent).toContain('Shortcuts')
    expect(container.textContent).toContain('Layout')
    expect(container.textContent).toContain('Notifications')
  })

  it('category navigation switches sections', () => {
    const { container } = render()
    const navButtons = container.querySelectorAll('nav button')
    expect(navButtons.length).toBe(5)
    act(() => { (navButtons[1] as HTMLButtonElement).click() })
    expect(container.textContent).toContain('Cursor')
    act(() => { (navButtons[2] as HTMLButtonElement).click() })
    expect(container.textContent).toContain('Keyboard Shortcuts')
    act(() => { (navButtons[3] as HTMLButtonElement).click() })
    expect(container.textContent).toContain('Sidebar')
    act(() => { (navButtons[4] as HTMLButtonElement).click() })
    expect(container.textContent).toContain('Attention Notifications')
  })

  it('shortcut capture mode works', () => {
    const { container } = render()
    const navButtons = container.querySelectorAll('nav button')
    act(() => { (navButtons[2] as HTMLButtonElement).click() })
    const editBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Edit')
    expect(editBtn).toBeTruthy()
    act(() => { editBtn!.click() })
    expect(container.textContent).toContain('Press keys...')
    const cancelBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Cancel')
    expect(cancelBtn).toBeTruthy()
  })

  it('toggle switch click updates setting', () => {
    const { container } = render()
    const navButtons = container.querySelectorAll('nav button')
    act(() => { (navButtons[4] as HTMLButtonElement).click() })
    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement
    expect(toggle).toBeTruthy()
    act(() => { toggle.click() })
    expect(mockUpdateSetting).toHaveBeenCalled()
  })

  it('close button calls closeSettings', () => {
    const { container } = render()
    const headerTitle = container.querySelector('#settings-title')
    const closeBtn = headerTitle?.parentElement?.querySelector('button')
    expect(closeBtn).toBeTruthy()
    act(() => { closeBtn!.click() })
    expect(mockCloseSettings).toHaveBeenCalledTimes(1)
  })
})
