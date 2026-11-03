import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../shared/defaultSettings'
import { useSessionStore } from '../../store/sessionStore'
import { useWorkspaceStore, getFocusedSessionId } from '../../store/workspaceStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useToastStore } from '../../store/toastStore'
import { createTerminal, createTerminalSplit, closeSession } from '../../store/sessionLifecycle'
import { createShortcutCommands } from '../applicationCommands'
import { usePaletteCommands } from '../usePaletteCommands'
import { useCommandExecution } from '../useApplicationKeyboard'
import { filterCommands } from '../../components/CommandPalette/commandSearch'
import { DARK_UI, DARK_XTERM } from '../../styles/themes'

vi.mock('../../store/dirtyScheduler', () => ({ markDirty: vi.fn() }))
const save = vi.fn().mockResolvedValue({})
const folder = vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined)
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement

function Harness({ query = '' }: { query?: string }) {
  const shortcuts = useSettingsStore(state => state.settings.shortcuts)
  const commands = usePaletteCommands(createShortcutCommands(shortcuts, {
    commandPalette: () => {}, newTerminal: () => { createTerminal() },
    closeTerminal: () => { const id = useSessionStore.getState().activeSessionId; if (id) closeSession(id) },
    nextTab: () => useSessionStore.getState().navigateNext(), prevTab: () => useSessionStore.getState().navigatePrev(),
    splitHorizontal: () => { createTerminalSplit('horizontal') }, splitVertical: () => { createTerminalSplit('vertical') },
    closePane: () => useWorkspaceStore.getState().closeFocused(), settings: () => useSettingsStore.getState().openSettings(),
    toggleSidebar: () => useSessionStore.getState().toggleSidebar()
  }), folder)
  const execute = useCommandExecution()
  return <>{filterCommands(commands, query).map(command => <button key={command.id} data-command-id={command.id} disabled={Boolean(command.disabledReason?.())} onClick={() => { void execute(command) }}>{command.label} · {command.disabledReason?.() ?? command.description}</button>)}</>
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  save.mockReset().mockResolvedValue({})
  folder.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(window, 'terminalAPI', { configurable: true, value: { settingsSet: save, kill: () => {} } })
  useSessionStore.setState({ sessions: [], collections: [], activeSessionId: null, agentStates: {}, agentRevisions: {}, agentRevisionFloor: 0, sidebarVisible: true })
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, settingsOpen: false, settingsCategory: null })
  useToastStore.setState({ toasts: [] })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
})
afterEach(() => { act(() => root.unmount()); container.remove() })

function command(id: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[data-command-id="${id}"]`)
  if (!button) throw new Error(`Missing command ${id}`)
  return button
}
async function execute(id: string) { await act(async () => command(id).click()) }

describe('live palette commands', () => {
  it('finds a session by its ancestor collection and exact remote target', () => {
    act(() => {
      useSessionStore.setState({
        collections: [{ id: 'team', name: 'Platform', parentId: null, collapsed: true, createdAt: 1 }, { id: 'project', name: 'Payments', parentId: 'team', collapsed: true, createdAt: 2 }],
        sessions: [{ id: 'remote', title: 'Logs', shell: 'ssh', ssh: { host: 'prod-01', user: 'deploy', port: 2222 }, cwd: '/srv/payments', collectionId: 'project', color: 'blue', pid: 0, createdAt: 1 }]
      })
      root.render(<Harness query="Platform Payments deploy 2222" />)
    })
    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(container.textContent).toContain('Switch to Logs')
    expect(useSessionStore.getState().collections.every(item => item.collapsed)).toBe(true)
  })

  it('explains unavailable workspace actions and creates no orphan when they are selected', async () => {
    expect(command('splitHorizontal').textContent).toContain('Select a terminal pane first')
    expect(command('closeTerminal').textContent).toContain('No active terminal')
    expect(command('next-attention').textContent).toContain('No sessions need attention')
    await execute('splitHorizontal')
    expect(useSessionStore.getState().sessions).toHaveLength(0)
    await execute('newTerminal')
    expect(useSessionStore.getState().sessions).toHaveLength(1)
    expect(command('splitHorizontal').disabled).toBe(false)
    await execute('splitHorizontal')
    expect(useSessionStore.getState().sessions).toHaveLength(2)
    expect(getFocusedSessionId()).toBe(useSessionStore.getState().activeSessionId)
  })

  it('reuses attention selection and leaves its running status intact after reading', async () => {
    let target = ''
    act(() => {
      createTerminal({ title: 'First' })
      target = createTerminal({ title: 'Approval' })
      useSessionStore.getState().applyAgentUpdate({ paneId: target, revision: 1, agent: { aiType: 'claude', status: 'waiting_approval' } })
    })
    await execute('next-attention')
    expect(useSessionStore.getState().activeSessionId).toBe(target)
    expect(useSessionStore.getState().agentStates[target]).toEqual({ status: 'waiting_approval', unread: false })
    expect(getFocusedSessionId()).toBe(target)
  })

  it('uses current SSH profile details to create the selected connection', async () => {
    act(() => useSettingsStore.setState(state => ({ settings: { ...state.settings, sshProfiles: [{ id: 'prod', name: 'Production', host: 'prod.example', port: 2222, user: 'deploy' }] } })))
    expect(command('ssh:prod').textContent).toContain('deploy@prod.example:2222')
    await execute('ssh:prod')
    expect(useSessionStore.getState().sessions[0]).toMatchObject({ shell: 'ssh', title: 'Production', ssh: { host: 'prod.example', port: 2222, user: 'deploy' } })
    expect(getFocusedSessionId()).toBe(useSessionStore.getState().activeSessionId)
  })

  it('applies built-in and custom themes through settings without changing the active session', async () => {
    let session = ''
    act(() => {
      session = createTerminal()
      useSettingsStore.setState(state => ({ settings: { ...state.settings, customThemes: [{ id: 'personal', name: 'Personal', ui: DARK_UI, terminal: DARK_XTERM }] } }))
    })
    await execute('theme:light')
    expect(save).toHaveBeenCalledWith('theme', 'light')
    expect(command('theme:light').textContent).toContain('Current theme')
    await execute('theme:personal')
    expect(useSettingsStore.getState().settings.theme).toBe('personal')
    expect(useSessionStore.getState().activeSessionId).toBe(session)
  })

  it('reports a failed theme save after the real settings store rolls it back', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    save.mockRejectedValueOnce(new Error('disk unavailable'))
    try {
      await execute('theme:light')
      expect(useSettingsStore.getState().settings.theme).toBe('dark')
      expect(useToastStore.getState().toasts.map(toast => toast.message)).toEqual(['Could not use light theme. Try again.'])
    } finally { log.mockRestore() }
  })

  it('opens the requested settings section and preserves the cancel result of the folder picker', async () => {
    await execute('shortcut-settings')
    expect(useSettingsStore.getState().settingsCategory).toBe('shortcuts')
    expect(useSettingsStore.getState().settingsOpen).toBe(true)
    act(() => useSettingsStore.getState().closeSettings())
    await execute('new-in-folder')
    expect(folder).toHaveBeenCalledOnce()
    expect(useSessionStore.getState().sessions).toHaveLength(0)
  })

  it('finds sessions by tool and folder across query fields and removes closed sessions', () => {
    let target = ''
    act(() => { target = createTerminal({ title: '中文项目', cwd: 'D:\\projects\\payments', shell: 'pwsh' }) })
    act(() => root.render(<Harness query="切换 pwsh D:/projects/payments" />))
    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(container.textContent).toContain('Switch to 中文项目')
    act(() => closeSession(target))
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})
