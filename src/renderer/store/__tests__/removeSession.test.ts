import { describe, it, expect, vi, beforeEach } from 'vitest'

const kill = vi.fn()
vi.stubGlobal('window', {
  terminalAPI: {
    kill,
    stateLoad: vi.fn(),
    onAgentUpdate: vi.fn(() => vi.fn())
  },
  addEventListener: vi.fn()
})

vi.mock('../dirtyScheduler', () => ({ markDirty: vi.fn() }))

import { useSessionStore } from '../sessionStore'

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.setState({
    sessions: [],
    collections: [],
    activeSessionId: null,
    agentStates: {},
    sidebarTransitioning: false
  })
})

describe('removeSession kills its PTY (low)', () => {
  it('invokes terminalAPI.kill when a session is removed', () => {
    const id = useSessionStore.getState().addSession({ cwd: 'C:\\', shell: 'powershell' })
    kill.mockClear()
    useSessionStore.getState().removeSession(id)

    expect(kill).toHaveBeenCalledWith(id)
  })

  it('drops the attention entry so a closed session cannot leave a stale dot', () => {
    const id = useSessionStore.getState().addSession({ cwd: 'C:\\', shell: 'powershell' })
    useSessionStore.setState({ agentStates: { [id]: { status: 'waiting_approval', unread: true } } })
    expect(useSessionStore.getState().agentStates[id]).toEqual({ status: 'waiting_approval', unread: true })

    useSessionStore.getState().removeSession(id)

    expect(useSessionStore.getState().agentStates).not.toHaveProperty(id)
    expect(useSessionStore.getState().agentStates).toEqual({})
  })

  it('keeps the attention entries of sessions that are still open', () => {
    const closing = useSessionStore.getState().addSession({ cwd: 'C:\\', shell: 'powershell' })
    const staying = useSessionStore.getState().addSession({ cwd: 'C:\\', shell: 'powershell' })
    useSessionStore.setState({ agentStates: { [closing]: { status: 'waiting_approval', unread: true }, [staying]: { status: 'working', unread: false } } })

    useSessionStore.getState().removeSession(closing)

    const agentStates = useSessionStore.getState().agentStates
    expect(agentStates).not.toHaveProperty(closing)
    expect(agentStates[staying]).toEqual({ status: 'working', unread: false })
  })
})
