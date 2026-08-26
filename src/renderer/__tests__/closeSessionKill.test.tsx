import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// REVIEW.md P1-6 — closing a session kills its PTY more than once:
// App.handleCloseSession calls window.terminalAPI.kill(id) explicitly, then
// sessionStore.removeSession(id) kills the same PTY again internally (and a
// mounted TerminalPane would kill it a third time on unmount — not exercised
// here, TerminalArea is mocked out). kill is idempotent today so nothing
// visibly breaks, but the layered kill paths make ownership unclear and turn
// any future non-idempotent kill (accounting, logging, close handshake) into
// a bug.
//
// This test drives the REAL session/workspace stores through App's Ctrl+W
// handler and counts kill invocations for a single close.

vi.mock('../store/dirtyScheduler', () => ({
  configureDirtyScheduler: vi.fn(),
  markDirty: vi.fn(),
  flushNow: vi.fn()
}))

vi.mock('../store/settingsStore', () => {
  const state = {
    settings: {
      theme: 'dark',
      fontFamily: 'Cascadia Code',
      fontSize: 14,
      cursorStyle: 'bar',
      cursorBlink: true,
      opacity: 1,
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
      notifications: { claudeCode: true, openCode: true, codex: true, ohMyPi: true },
      sshProfiles: []
    },
    loaded: true,
    settingsOpen: false,
    settingsCategory: null,
    init: vi.fn().mockResolvedValue(undefined),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    updateSetting: vi.fn()
  }
  const useSettingsStore = (sel: (s: typeof state) => unknown) => sel(state)
  useSettingsStore.getState = () => state
  return { useSettingsStore }
})

vi.mock('../components/TitleBar/TitleBar', () => ({ TitleBar: () => null }))
vi.mock('../components/Sidebar/Sidebar', () => ({ Sidebar: () => null }))
vi.mock('../components/Terminal/TerminalArea', () => ({ TerminalArea: () => null }))
vi.mock('../components/StatusBar/StatusBar', () => ({ StatusBar: () => null }))
vi.mock('../components/MetricsDashboard/MetricsDashboard', () => ({ MetricsDashboard: () => null }))
vi.mock('../components/SshMonitor/SshMonitorPanel', () => ({ SshMonitorPanel: () => null }))
vi.mock('../components/CommandBar/CommandBar', () => ({ CommandBar: () => null }))
vi.mock('../components/App/ContextMenu', () => ({ ContextMenu: () => null }))
vi.mock('../components/App/PromptDialog', () => ({ PromptDialog: () => null }))
vi.mock('../components/Settings/SettingsModal', () => ({ SettingsModal: () => null }))
vi.mock('../components/App/Toasts', () => ({ Toasts: () => null }))

import App from '../App'
import { useSessionStore } from '../store/sessionStore'

let kill: ReturnType<typeof vi.fn>
let roots: Array<ReturnType<typeof createRoot>>

beforeEach(() => {
  kill = vi.fn()
  // Test double: only the mount/close-path surface of TerminalAPI exists here.
  const terminalAPIStub = {
    kill,
    stateLoad: vi.fn().mockResolvedValue({
      sessions: [
        { id: 's1', title: 'T', color: 'blue', cwd: '', shell: 'powershell', createdAt: 1, collectionId: null }
      ],
      collections: [],
      activeSessionId: 's1',
      sidebarVisible: true,
      sidebarWidth: 220,
      workspaces: [],
      activeWorkspaceId: null
    }),
    onAttentionChange: vi.fn(() => () => {}),
    metricsSetSampling: vi.fn(),
    onSshAuth: vi.fn(() => () => {}),
    onSshHostkey: vi.fn(() => () => {}),
    selectDirectory: vi.fn().mockResolvedValue({ canceled: true })
  } as unknown as Window['terminalAPI']
  window.terminalAPI = terminalAPIStub
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  roots = []
  document.body.innerHTML = ''
  useSessionStore.setState({
    sessions: [],
    collections: [],
    activeSessionId: null,
    loaded: false,
    attentionMap: {}
  })
})

afterEach(() => {
  for (const r of roots) r.unmount()
})

describe('close-session kill ownership (REVIEW P1-6)', () => {
  it('kills the PTY exactly once per close', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => {
      root.render(<App />)
    })
    // Let loadState() resolve and the seeded session become active.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(useSessionStore.getState().activeSessionId).toBe('s1')

    kill.mockClear()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true }))
    })

    expect(useSessionStore.getState().sessions).toHaveLength(0)
    const killsForS1 = kill.mock.calls.filter((c) => c[0] === 's1')
    // DESIRED: exactly one kill per close. Currently fails with 2 —
    // handleCloseSession kills explicitly AND removeSession kills again.
    expect(killsForS1).toHaveLength(1)
  })
})
