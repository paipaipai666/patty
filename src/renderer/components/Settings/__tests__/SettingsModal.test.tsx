import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

import { SettingsModal, formatShortcut } from '../SettingsModal'

describe('formatShortcut', () => {
  it('Ctrl+letter', () => {
    expect(formatShortcut(new KeyboardEvent('keydown', { key: 't', ctrlKey: true }))).toBe('Ctrl+T')
  })

  it('Ctrl+Shift+letter', () => {
    expect(formatShortcut(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+D')
  })

  it('Ctrl+Alt+key', () => {
    expect(formatShortcut(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+,')
  })

  it('Meta+key uses Meta prefix', () => {
    expect(formatShortcut(new KeyboardEvent('keydown', { key: 'b', metaKey: true }))).toBe('Meta+B')
  })

  it('modifier-only key returns just the modifier', () => {
    expect(formatShortcut(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))).toBe('Ctrl')
  })

  it('keeps special key names as-is', () => {
    expect(formatShortcut(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe('Escape')
  })

  it('Enter key', () => {
    expect(formatShortcut(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe('Enter')
  })

  it('Shift+F1', () => {
    expect(formatShortcut(new KeyboardEvent('keydown', { key: 'F1', shiftKey: true }))).toBe('Shift+F1')
  })

  it('single letter uppercases', () => {
    expect(formatShortcut(new KeyboardEvent('keydown', { key: 'a' }))).toBe('A')
  })
})

const roots: ReturnType<typeof createRoot>[] = []

beforeEach(() => {
  vi.clearAllMocks()
  settingsState.settings.customThemes = []
  settingsState.settings.theme = 'dark'
  settingsState.settingsOpen = true
  document.body.innerHTML = ''
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  roots.forEach(r => r.unmount())
  roots.length = 0
})

function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
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

  it('Escape while not capturing closes settings', () => {
    render()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(mockCloseSettings).toHaveBeenCalledTimes(1)
  })

  it('Escape during shortcut capture cancels capture without closing', () => {
    const { container } = render()
    const navButtons = container.querySelectorAll('nav button')
    act(() => { (navButtons[2] as HTMLButtonElement).click() })
    const editBtns = Array.from(container.querySelectorAll('button'))
    const editBtn = editBtns.find(b => b.textContent === 'Edit')
    act(() => { editBtn!.click() })
    expect(container.textContent).toContain('Press keys...')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(container.textContent).not.toContain('Press keys...')
    expect(mockCloseSettings).toHaveBeenCalledTimes(0)
  })

  it('shortcut capture completes on key combo', () => {
    const { container } = render()
    const navButtons = container.querySelectorAll('nav button')
    act(() => { (navButtons[2] as HTMLButtonElement).click() })
    const editBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Edit')
    act(() => { editBtn!.click() })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }))
    })
    expect(mockUpdateSetting).toHaveBeenCalledWith('shortcuts', expect.objectContaining({ newTerminal: 'Ctrl+Y' }))
  })

  it('terminal section cursor style buttons work', () => {
    const { container } = render()
    const navButtons = container.querySelectorAll('nav button')
    act(() => { (navButtons[1] as HTMLButtonElement).click() })
    const cursorBtns = Array.from(container.querySelectorAll('button')).filter(b =>
      ['Block', 'Underline', 'Bar'].includes(b.textContent!)
    )
    expect(cursorBtns.length).toBe(3)
    act(() => { cursorBtns[0].click() })
    expect(mockUpdateSetting).toHaveBeenCalledWith('cursorStyle', 'block')
  })

  it('layout section sidebar position buttons work', () => {
    const { container } = render()
    const navButtons = container.querySelectorAll('nav button')
    act(() => { (navButtons[3] as HTMLButtonElement).click() })
    const posBtns = Array.from(container.querySelectorAll('button')).filter(b =>
      ['Left', 'Right'].includes(b.textContent!)
    )
    expect(posBtns.length).toBe(2)
    act(() => { posBtns[1].click() })
    expect(mockUpdateSetting).toHaveBeenCalledWith('sidebarPosition', 'right')
  })

  it('ThemeEditor appears with custom themes', () => {
    settingsState.settings.customThemes = [{ id: 't1', name: 'My Theme', ui: { '--bg-app': '#000' }, terminal: { '--black': '#000' } }]
    settingsState.settings.theme = 't1'
    const { container } = render()
    expect(container.textContent).toContain('My Theme')
    const themeItem = container.querySelector('[class*="themeItem"]') as HTMLElement
    expect(themeItem).toBeTruthy()
    act(() => { themeItem.click() })
    expect(container.textContent).toContain('App Background')
  })

  it('ThemeEditor delete removes theme and reverts to builtin', () => {
    settingsState.settings.customThemes = [{ id: 't1', name: 'My Theme', ui: { '--bg-app': '#000' }, terminal: { '--black': '#000' } }]
    settingsState.settings.theme = 't1'
    const { container } = render()
    const deleteBtns = Array.from(container.querySelectorAll('button')).filter(b => b.getAttribute('aria-label') === 'Delete theme')
    expect(deleteBtns.length).toBe(1)
    act(() => { deleteBtns[0].click() })
    expect(mockUpdateSetting).toHaveBeenCalledWith('customThemes', [])
    expect(mockUpdateSetting).toHaveBeenCalledWith('theme', 'dark')
  })
})
