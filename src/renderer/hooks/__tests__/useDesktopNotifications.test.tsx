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

vi.mock('../../commands/useApplicationKeyboard', () => ({ focusActiveTerminal: vi.fn() }))

let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
let signal: () => void
let pending: DesktopActivation | null
const dismiss = vi.fn(async () => undefined)
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
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true })
  useSessionStore.setState({ loaded: false, sessions: [
    { id: 'p1', title: 'First', shell: 'powershell', cwd: '', color: 'blue', collectionId: null, pid: 1, createdAt: 1 },
    { id: 'p2', title: 'Second', shell: 'powershell', cwd: '', color: 'blue', collectionId: null, pid: 2, createdAt: 2 }
  ], activeSessionId: 'p2', agentStates: {}, agentRevisions: {}, agentRevisionFloor: 0 })
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

it('waits for session loading then activates the correct workspace and focuses its terminal', async () => {
  pending = { kind: 'session', sessionId: 'p1' }
  await act(async () => root.render(<Harness />))
  expect(take).not.toHaveBeenCalled()
  await act(async () => useSessionStore.setState({ loaded: true }))
  expect(useSessionStore.getState().activeSessionId).toBe('p1')
  const state = useWorkspaceStore.getState()
  expect(state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId)?.paneTree).toMatchObject({ sessionId: 'p1' })
  expect(activate).toHaveBeenCalledTimes(1)
  expect(focusActiveTerminal).toHaveBeenCalledTimes(1)
  await act(async () => signal())
  expect(activate).toHaveBeenCalledTimes(1)
})

it('delivers only new states and dismisses notices when work resumes', async () => {
  useSessionStore.setState({ loaded: true })
  await act(async () => root.render(<Harness />))
  await act(async () => useSessionStore.getState().applyAgentUpdate({ paneId: 'p1', revision: 1, agent: { aiType: 'codex', status: 'waiting_approval' } }))
  expect(notify).toHaveBeenCalledWith({ paneId: 'p1', title: 'First', revision: 1, kind: 'approval' })
  await act(async () => useSessionStore.getState().applyAgentUpdate({ paneId: 'p1', revision: 2, agent: { aiType: 'codex', status: 'working' } }))
  expect(dismiss).toHaveBeenCalledWith('p1')
  useSettingsStore.setState(state => ({ settings: { ...state.settings, desktopNotifications: false } }))
  await act(async () => useSessionStore.getState().applyAgentUpdate({ paneId: 'p1', revision: 3, agent: { aiType: 'codex', status: 'error' } }))
  expect(notify).toHaveBeenCalledTimes(1)
})
