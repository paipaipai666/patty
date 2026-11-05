import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useDesktopNotifications } from '../useDesktopNotifications'
import { useSessionStore } from '../../store/sessionStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { DEFAULT_SETTINGS } from '../../../shared/defaultSettings'
import type { DesktopActivation } from '../../../shared/desktopNotifications'
import { focusActiveTerminal } from '../../commands/useApplicationKeyboard'
import { SettingsModal } from '../../components/Settings/SettingsModal'
import type { ProgramRecord } from '../../../shared/programTypes'

vi.mock('../../commands/useApplicationKeyboard', async importOriginal => ({
  ...await importOriginal<typeof import('../../commands/useApplicationKeyboard')>(),
  focusActiveTerminal: vi.fn()
}))

let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
let signal: () => void
let pending: DesktopActivation | null
const dismiss = vi.fn(async (): Promise<void> => undefined)
const notify = vi.fn(async () => true)
const take = vi.fn(async () => { const target = pending; pending = null; return target })
const activate = vi.fn()
const unsubscribe = vi.fn()
function Harness() { useDesktopNotifications(activate); return null }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  pending = null
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  Object.defineProperty(window, 'terminalAPI', { configurable: true, value: {
    notifyAttention: notify, dismissDesktopNotification: dismiss, takeDesktopActivation: take,
    onDesktopActivation: (callback: () => void) => { signal = callback; return { ready: Promise.resolve(), unsubscribe } }
  } })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true, settingsOpen: false })
  useSessionStore.setState({ loaded: false, sessions: [
    { id: 'p1', title: 'First', shell: 'powershell', cwd: '', color: 'blue', collectionId: null, pid: 1, createdAt: 1 },
    { id: 'p2', title: 'Second', shell: 'powershell', cwd: '', color: 'blue', collectionId: null, pid: 2, createdAt: 2 }
  ], activeSessionId: 'p2', agentStates: {}, agentRevisions: {}, agentRevisionFloor: 0, programStates: {}, programRevisionFloor: 0 })
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null })
  useWorkspaceStore.getState().createWorkspace('p1')
  useWorkspaceStore.getState().createWorkspace('p2')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it('waits for session loading and activates the correct workspace without focusing a fallback control', async () => {
  pending = { kind: 'session', sessionId: 'p1' }
  await act(async () => root.render(<Harness />))
  expect(take).not.toHaveBeenCalled()
  await act(async () => useSessionStore.setState({ loaded: true }))
  expect(useSessionStore.getState().activeSessionId).toBe('p1')
  const state = useWorkspaceStore.getState()
  expect(state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId)?.paneTree).toMatchObject({ sessionId: 'p1' })
  expect(activate).toHaveBeenCalledTimes(1)
  expect(focusActiveTerminal).not.toHaveBeenCalled()
  await act(async () => signal())
  expect(activate).toHaveBeenCalledTimes(1)
})

it('delivers only new states and dismisses notices when work resumes', async () => {
  useSessionStore.setState({ loaded: true })
  await act(async () => root.render(<Harness />))
  await act(async () => useSessionStore.getState().applyAgentUpdate({ paneId: 'p1', revision: 1, agent: { aiType: 'codex', status: 'waiting_approval' } }))
  expect(notify).toHaveBeenCalledWith({ paneId: 'p1', title: 'First', revision: 1, kind: 'approval', source: 'agent' })
  await act(async () => useSessionStore.getState().applyAgentUpdate({ paneId: 'p1', revision: 2, agent: { aiType: 'codex', status: 'working' } }))
  expect(dismiss).toHaveBeenCalledWith('p1')
  useSettingsStore.setState(state => ({ settings: { ...state.settings, desktopNotifications: false } }))
  await act(async () => useSessionStore.getState().applyAgentUpdate({ paneId: 'p1', revision: 3, agent: { aiType: 'codex', status: 'error' } }))
  expect(notify).toHaveBeenCalledTimes(1)
})

it('delivers program edges without replaying a startup snapshot or hidden Hook fallback', async () => {
  const report = (revision: number, program: ProgramRecord) => useSessionStore.getState().applyProgramBatch({ revision, programs: [{ paneId: 'p1', revision, runId: '1', recordCount: 1, program }] })
  await act(async () => root.render(<Harness />))
  await act(async () => report(2, { id: '', revision: 1, state: 'blocked', kind: 'permission' }))
  await act(async () => useSessionStore.setState({ loaded: true }))
  expect(notify).not.toHaveBeenCalled()
  await act(async () => report(3, { id: '', revision: 2, state: 'working' }))
  expect(dismiss).toHaveBeenCalledWith('p1')
  await act(async () => report(4, { id: '', revision: 3, state: 'blocked', kind: 'auth' }))
  expect(notify).toHaveBeenLastCalledWith({ paneId: 'p1', title: 'First', source: 'program', revision: 4, runId: '1', kind: 'input' })
  await act(async () => useSessionStore.getState().markAgentRead('p1'))
  await act(async () => useSessionStore.getState().applyAgentUpdate({ paneId: 'p1', revision: 1, agent: { aiType: 'codex', status: 'idle' } }))
  await act(async () => useSessionStore.getState().applyAgentUpdate({ paneId: 'p1', revision: 2, agent: null }))
  expect(notify).toHaveBeenCalledTimes(1)
})

it('finishes dismissing the previous source before showing a replacement notification', async () => {
  useSessionStore.setState({ loaded: true })
  await act(async () => root.render(<Harness />))
  await act(async () => useSessionStore.getState().applyProgramBatch({ revision: 2, programs: [{ paneId: 'p1', revision: 2, runId: '1', recordCount: 1, program: { id: '', revision: 1, state: 'error' } }] }))
  let release = () => {}
  dismiss.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  await act(async () => useSessionStore.getState().applyAgentUpdate({ paneId: 'p1', revision: 20, agent: { aiType: 'codex', status: 'error' } }))
  expect(notify).toHaveBeenCalledTimes(1)
  await act(async () => release())
  expect(notify).toHaveBeenCalledTimes(2)
  expect(notify).toHaveBeenLastCalledWith({ paneId: 'p1', title: 'First', source: 'agent', revision: 20, kind: 'error' })
})

it('focuses the target after its terminal input mounts during cold startup', async () => {
  pending = { kind: 'session', sessionId: 'p1' }
  await act(async () => root.render(<Harness />))
  await act(async () => useSessionStore.setState({ loaded: true }))
  const state = useWorkspaceStore.getState()
  const pane = document.createElement('div')
  pane.dataset.paneId = state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId)?.focusedPaneId ?? ''
  const input = document.createElement('textarea')
  input.className = 'xterm-helper-textarea'
  pane.appendChild(input)
  try {
    await act(async () => document.body.appendChild(pane))
    expect(document.activeElement).toBe(input)
  } finally { pane.remove() }
})

it('cancels delayed focus if the user switches to another session', async () => {
  pending = { kind: 'session', sessionId: 'p1' }
  await act(async () => root.render(<Harness />))
  await act(async () => useSessionStore.setState({ loaded: true }))
  const state = useWorkspaceStore.getState()
  const pane = document.createElement('div')
  pane.dataset.paneId = state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId)?.focusedPaneId ?? ''
  const input = document.createElement('textarea')
  input.className = 'xterm-helper-textarea'
  pane.appendChild(input)
  await act(async () => useSessionStore.getState().setActive('p2'))
  try {
    await act(async () => document.body.appendChild(pane))
    expect(document.activeElement).not.toBe(input)
  } finally { pane.remove() }
})

it('closing settings for an activation does not restore focus to the previous terminal', async () => {
  const elements = useWorkspaceStore.getState().workspaces.map(workspace => {
    const pane = document.createElement('div')
    pane.dataset.paneId = workspace.focusedPaneId ?? ''
    const input = document.createElement('textarea')
    input.className = 'xterm-helper-textarea'
    const id = workspace.paneTree.type === 'leaf' ? workspace.paneTree.sessionId : ''
    input.addEventListener('focus', () => useSessionStore.getState().setActive(id))
    pane.appendChild(input)
    document.body.appendChild(pane)
    return { pane, input, id }
  })
  try {
    useSessionStore.setState({ loaded: true })
    await act(async () => root.render(<><Harness /><SettingsModal /></>))
    act(() => elements.find(item => item.id === 'p2')?.input.focus())
    await act(async () => useSettingsStore.getState().openSettings())
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')?.focus())
    activate.mockImplementationOnce(() => useSettingsStore.getState().closeSettings())
    pending = { kind: 'session', sessionId: 'p1' }
    await act(async () => signal())
    expect(useSessionStore.getState().activeSessionId).toBe('p1')
  } finally { for (const { pane } of elements) pane.remove() }
})
