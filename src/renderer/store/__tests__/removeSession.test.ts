import { describe, it, expect, vi, beforeEach } from 'vitest'

const kill = vi.fn()
vi.stubGlobal('window', {
  terminalAPI: {
    kill,
    stateLoad: vi.fn(),
    onAttentionChange: vi.fn(() => vi.fn())
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
    attentionMap: {},
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
    useSessionStore.setState({ attentionMap: { [id]: 'bell' } })
    expect(useSessionStore.getState().attentionMap[id]).toBe('bell')

    useSessionStore.getState().removeSession(id)

    expect(useSessionStore.getState().attentionMap).not.toHaveProperty(id)
    expect(useSessionStore.getState().attentionMap).toEqual({})
  })

  it('keeps the attention entries of sessions that are still open', () => {
    const closing = useSessionStore.getState().addSession({ cwd: 'C:\\', shell: 'powershell' })
    const staying = useSessionStore.getState().addSession({ cwd: 'C:\\', shell: 'powershell' })
    useSessionStore.setState({ attentionMap: { [closing]: 'bell', [staying]: 'activity' } })

    useSessionStore.getState().removeSession(closing)

    const attentionMap = useSessionStore.getState().attentionMap
    expect(attentionMap).not.toHaveProperty(closing)
    expect(attentionMap[staying]).toBe('activity')
  })
})
