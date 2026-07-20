import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

const hoisted = vi.hoisted(() => {
  const mockAddSession = vi.fn().mockReturnValue('sess-new')
  const mockRemoveSession = vi.fn()
  const mockSetActive = vi.fn()
  const mockToggleSidebar = vi.fn()
  const mockNavigateNext = vi.fn()
  const mockNavigatePrev = vi.fn()
  const mockNavigateToIndex = vi.fn()
  const mockLoadState = vi.fn().mockResolvedValue(null)
  const mockCreateWorkspace = vi.fn()
  const mockRemoveSessionEverywhere = vi.fn()
  const mockLoadFromPersisted = vi.fn()
  const mockSettingsInit = vi.fn().mockResolvedValue(undefined)
  const mockOpenSettings = vi.fn()

  const sessionState = {
    sessions: [],
    collections: [],
    activeSessionId: null,
    sidebarVisible: true,
    sidebarWidth: 220,
    addSession: mockAddSession,
    removeSession: mockRemoveSession,
    setActive: mockSetActive,
    renameSession: vi.fn(),
    setColor: vi.fn(),
    toggleSidebar: mockToggleSidebar,
    navigateNext: mockNavigateNext,
    navigatePrev: mockNavigatePrev,
    navigateToIndex: mockNavigateToIndex,
    loadState: mockLoadState,
    addCollection: vi.fn(),
    removeCollection: vi.fn(),
    renameCollection: vi.fn(),
    setAiType: vi.fn()
  }

  const wsState = {
    workspaces: [],
    activeWorkspaceId: null,
    createWorkspace: mockCreateWorkspace,
    removeSessionEverywhere: mockRemoveSessionEverywhere,
    loadFromPersisted: mockLoadFromPersisted,
    ensureVisible: vi.fn(),
    splitFocused: vi.fn(),
    closeFocused: vi.fn()
  }

  const settings = {
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
  }

  const settingsState = {
    settings,
    loaded: true,
    init: mockSettingsInit,
    openSettings: mockOpenSettings,
    closeSettings: vi.fn(),
    updateSetting: vi.fn(),
    settingsOpen: false
  }

  return {
    mockAddSession, mockRemoveSession, mockSetActive, mockToggleSidebar,
    mockNavigateNext, mockNavigatePrev, mockNavigateToIndex, mockLoadState,
    mockCreateWorkspace, mockRemoveSessionEverywhere, mockLoadFromPersisted,
    mockSettingsInit, mockOpenSettings,
    sessionState, wsState, settingsState
  }
})

vi.mock('../store/sessionStore', () => {
  const useSessionStore = (sel: (s: typeof hoisted.sessionState) => unknown) => sel(hoisted.sessionState)
  useSessionStore.getState = () => hoisted.sessionState
  return { useSessionStore, teardownSessionIPC: vi.fn(), buildSessionPersistedState: () => ({}), SESSION_COLORS: ['blue', 'green', 'amber', 'coral', 'purple', 'gray'] }
})

vi.mock('../store/workspaceStore', () => {
  const useWorkspaceStore = (sel: (s: typeof hoisted.wsState) => unknown) => sel(hoisted.wsState)
  useWorkspaceStore.getState = () => hoisted.wsState
  return { useWorkspaceStore, getFocusedSessionId: () => null }
})

vi.mock('../store/settingsStore', () => {
  const useSettingsStore = (sel: (s: typeof hoisted.settingsState) => unknown) => sel(hoisted.settingsState)
  useSettingsStore.getState = () => hoisted.settingsState
  return { useSettingsStore }
})

vi.mock('../store/dirtyScheduler', () => ({
  configureDirtyScheduler: vi.fn(),
  markDirty: vi.fn()
}))

vi.mock('../components/TitleBar/TitleBar', () => ({
  TitleBar: (props: any) => <div data-testid="titlebar" data-sidebar-visible={props.sidebarVisible} />
}))

vi.mock('../components/Sidebar/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />
}))

vi.mock('../components/Terminal/TerminalArea', () => ({
  TerminalArea: () => <div data-testid="terminal-area" />
}))

vi.mock('../components/StatusBar/StatusBar', () => ({
  StatusBar: (props: any) => <div data-testid="statusbar" data-metrics-open={props.metricsOpen} />
}))

vi.mock('../components/MetricsDashboard/MetricsDashboard', () => ({
  MetricsDashboard: () => <div data-testid="metrics-dashboard" />
}))

vi.mock('../components/common/ContextMenu', () => ({
  ContextMenu: (props: any) => <div data-testid="context-menu" data-show={props.show} />
}))

vi.mock('../components/common/PromptDialog', () => ({
  PromptDialog: () => <div data-testid="prompt-dialog" />
}))

vi.mock('../components/Settings/SettingsModal', () => ({
  SettingsModal: () => <div data-testid="settings-modal" />
}))

vi.mock('../components/common/Toasts', () => ({
  Toasts: () => <div data-testid="toasts" />
}))

import App from '../App'

let terminalAPI: Record<string, any>
const roots: ReturnType<typeof createRoot>[] = []

beforeEach(() => {
  terminalAPI = {
    metricsSetSampling: vi.fn(),
    kill: vi.fn(),
    stateLoad: vi.fn().mockResolvedValue(null),
    selectDirectory: vi.fn().mockResolvedValue({ canceled: true })
  }
  ;(window as any).terminalAPI = terminalAPI
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  roots.forEach(r => r.unmount())
  roots.length = 0
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

afterEach(() => {
  roots.forEach(r => r.unmount())
  roots.length = 0
  delete (window as any).terminalAPI
})

function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<App />) })
  return { container, root }
}

describe('App', () => {
  it('renders the app layout (TitleBar, Sidebar, TerminalArea, StatusBar, Toasts)', () => {
    const { container } = render()
    expect(container.querySelector('[data-testid="titlebar"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="sidebar"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="terminal-area"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="statusbar"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="toasts"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="settings-modal"]')).toBeTruthy()
  })

  it('calls settingsInit on mount', () => {
    render()
    expect(hoisted.mockSettingsInit).toHaveBeenCalledTimes(1)
  })

  it('calls loadState on mount', () => {
    render()
    expect(hoisted.mockLoadState).toHaveBeenCalled()
  })

  it('handleNewTerminal creates session and workspace via Ctrl+T', () => {
    render()
    hoisted.mockAddSession.mockClear()
    hoisted.mockCreateWorkspace.mockClear()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true }))
    })
    expect(hoisted.mockAddSession).toHaveBeenCalledWith({ cwd: undefined, shell: 'powershell' })
    expect(hoisted.mockCreateWorkspace).toHaveBeenCalledWith('sess-new')
  })

  it('Ctrl+W calls handleCloseSession when active session exists', () => {
    hoisted.sessionState.activeSessionId = 'sess-act'
    render()
    hoisted.mockRemoveSession.mockClear()
    hoisted.mockRemoveSessionEverywhere.mockClear()
    terminalAPI.kill.mockClear()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true }))
    })
    expect(terminalAPI.kill).toHaveBeenCalledWith('sess-act')
    expect(hoisted.mockRemoveSession).toHaveBeenCalledWith('sess-act')
    expect(hoisted.mockRemoveSessionEverywhere).toHaveBeenCalledWith('sess-act')
  })

  it('Ctrl+B toggles sidebar', () => {
    render()
    hoisted.mockToggleSidebar.mockClear()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }))
    })
    expect(hoisted.mockToggleSidebar).toHaveBeenCalledOnce()
  })

  it('Ctrl+, opens settings', () => {
    render()
    hoisted.mockOpenSettings.mockClear()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }))
    })
    expect(hoisted.mockOpenSettings).toHaveBeenCalledOnce()
  })

  it('Ctrl+] navigates next tab', () => {
    render()
    hoisted.mockNavigateNext.mockClear()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', ctrlKey: true, bubbles: true }))
    })
    expect(hoisted.mockNavigateNext).toHaveBeenCalledOnce()
  })

  it('Ctrl+[ navigates prev tab', () => {
    render()
    hoisted.mockNavigatePrev.mockClear()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', ctrlKey: true, bubbles: true }))
    })
    expect(hoisted.mockNavigatePrev).toHaveBeenCalledOnce()
  })

  it('Ctrl+1-9 navigates to index', () => {
    render()
    hoisted.mockNavigateToIndex.mockClear()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }))
    })
    expect(hoisted.mockNavigateToIndex).toHaveBeenCalledWith(2)
  })

  it('skips keyboard shortcuts when focus is inside input', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    render()
    hoisted.mockAddSession.mockClear()
    hoisted.mockCreateWorkspace.mockClear()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true }))
    })
    expect(hoisted.mockAddSession).not.toHaveBeenCalled()
  })

  it('renders splash dismiss element', () => {
    const splash = document.createElement('div')
    splash.id = 'patty-splash'
    document.body.appendChild(splash)
    render()
    expect(splash.classList.contains('patty-splash-hide')).toBe(true)
  })
})
