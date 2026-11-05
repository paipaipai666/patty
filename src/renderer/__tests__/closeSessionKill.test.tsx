import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'



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
        commandPalette: 'Ctrl+Shift+P',
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
      notifications: { claudeCode: true, openCode: true, codex: true, ohMyPi: true, qwenCode: true, copilotCli: true },
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
vi.mock('../components/App/ContextMenu', () => ({ ContextMenu: () => null }))
vi.mock('../components/App/PromptDialog', () => ({ PromptDialog: () => null }))
vi.mock('../components/Settings/SettingsModal', () => ({ SettingsModal: () => null }))
vi.mock('../components/App/Toasts', () => ({ Toasts: () => null }))

import App from '../App'
import { useSessionStore } from '../store/sessionStore'
import { useWorkspaceStore } from '../store/workspaceStore'

let kill: ReturnType<typeof vi.fn>
let roots: Array<ReturnType<typeof createRoot>>

beforeEach(() => {
  kill = vi.fn()

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
    onProgramUpdate: vi.fn(() => ({ ready: Promise.resolve(), unsubscribe: vi.fn() })),
    programStateSnapshot: vi.fn(async () => ({ revision: 0, programs: [] })),
    agentStateSnapshot: vi.fn(async () => ({ revision: 0, agents: [] })),
    onAgentUpdate: vi.fn(() => ({ ready: Promise.resolve(), unsubscribe: vi.fn() })),
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
    agentStates: {}, agentRevisions: {}, agentRevisionFloor: 0, programStates: {}, programRevisionFloor: 0
  })
})

afterEach(() => {
  for (const r of roots) r.unmount()
})

describe('close-session kill ownership (REVIEW P1-6)', () => {
  it('opens SSH input on request, retains its draft when hidden and returns focus on Escape', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(<App />))
    act(() => {
      useSessionStore.setState(state => ({ sessions: state.sessions.map(item => ({ ...item, shell: 'ssh', ssh: { host: 'prod-01', user: 'deploy', port: 2222 } })) }))
      useWorkspaceStore.getState().createWorkspace('s1')
    })
    const workspace = useWorkspaceStore.getState().workspaces.find(item => item.id === useWorkspaceStore.getState().activeWorkspaceId)!
    const pane = document.createElement('div')
    pane.dataset.paneId = workspace.focusedPaneId ?? ''
    const terminal = document.createElement('textarea')
    terminal.className = 'xterm-helper-textarea'
    pane.appendChild(terminal)
    document.body.appendChild(pane)
    terminal.focus()
    const open = async () => {
      act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true })))
      await act(async () => document.querySelector<HTMLButtonElement>('[data-command-id="ssh-command-input"]')!.click())
    }
    const input = container.querySelector<HTMLInputElement>('[aria-label="SSH command input"]')!
    expect(input.closest('[hidden]')).not.toBeNull()
    await open()
    expect(document.activeElement).toBe(input)
    expect(input.closest('[hidden]')).toBeNull()
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'tail -f service.log')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(input.closest('[hidden]')).not.toBeNull()
    expect(document.activeElement).toBe(terminal)
    await open()
    expect(input.value).toBe('tail -f service.log')
    expect(document.activeElement).toBe(input)
    expect(kill).not.toHaveBeenCalled()
    pane.remove()
  })

  it('opens live session details from unified search without restoring permanent chrome', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(<App />))
    act(() => {
      useSessionStore.setState(state => ({ sessions: state.sessions.map(item => ({ ...item, cwd: 'D:/work/payments', pid: 42 })) }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))
    })
    await act(async () => document.querySelector<HTMLButtonElement>('[data-command-id="session-info"]')!.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('D:/work/payments')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('PID 42')
    expect(document.querySelector('[role="combobox"]')).toBeNull()
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(kill).not.toHaveBeenCalled()
  })

  it('keeps the running agent when closing only its layout pane', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(<App />) })
    act(() => {
      useWorkspaceStore.getState().createWorkspace('s1')
      useSessionStore.getState().applyAgentUpdate({ paneId: 's1', revision: 1, agent: { aiType: 'codex', status: 'waiting_approval' } })
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, shiftKey: true, bubbles: true }))
    })
    expect(kill).not.toHaveBeenCalled()
    expect(useSessionStore.getState().sessions.map((s) => [s.id, s.aiType])).toEqual([['s1', 'codex']])
    expect(useSessionStore.getState().agentStates.s1).toEqual({ status: 'waiting_approval', unread: true })
    expect(useSessionStore.getState().activeSessionId).toBeNull()
  })

  it('kills the PTY exactly once per close', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => {
      root.render(<App />)
    })

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

    expect(killsForS1).toHaveLength(1)
  })
})
