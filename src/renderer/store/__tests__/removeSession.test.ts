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
})
