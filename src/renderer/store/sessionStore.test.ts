import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./statePersistence', () => ({
  requestStateSave: vi.fn()
}))

const mockStateLoad = vi.fn()
const mockOnAttentionChange = vi.fn(() => vi.fn())
const mockOnPtyExit = vi.fn(() => vi.fn())
const mockResetAttention = vi.fn()

vi.stubGlobal('window', {
  terminalAPI: {
    stateLoad: mockStateLoad,
    onAttentionChange: mockOnAttentionChange,
    onPtyExit: mockOnPtyExit,
    resetAttention: mockResetAttention
  },
  addEventListener: vi.fn()
})

import { useSessionStore, buildSessionPersistedState, teardownSessionIPC, SESSION_COLORS } from './sessionStore'

beforeEach(() => {
  vi.clearAllMocks()
  teardownSessionIPC()
  useSessionStore.setState({
    sessions: [],
    collections: [],
    activeSessionId: null,
    sidebarVisible: true,
    sidebarWidth: 220,
    loaded: false,
    attentionMap: {}
  })
})

describe('addSession', () => {
  it('creates a session with auto-generated id and title', () => {
    const id = useSessionStore.getState().addSession()
    const state = useSessionStore.getState()
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0].title).toBe('Terminal 1')
    expect(state.sessions[0].shell).toBe('powershell')
    expect(state.sessions[0].color).toBe('blue')
    expect(state.activeSessionId).toBe(id)
  })

  it('accepts optional shell and cwd', () => {
    useSessionStore.getState().addSession({ shell: 'bash', cwd: '/home' })
    const s = useSessionStore.getState().sessions[0]
    expect(s.shell).toBe('bash')
    expect(s.cwd).toBe('/home')
  })

  it('rotates colors for multiple sessions', () => {
    useSessionStore.getState().addSession()
    useSessionStore.getState().addSession()
    useSessionStore.getState().addSession()
    const sessions = useSessionStore.getState().sessions
    expect(sessions[0].color).toBe('blue')
    expect(sessions[1].color).toBe('green')
    expect(sessions[2].color).toBe('amber')
  })
})

describe('removeSession', () => {
  it('removes a session and nullifies activeSessionId when last', () => {
    useSessionStore.setState({
      sessions: [{ id: 's1', title: 'T1', color: 'blue', cwd: '', shell: 'powershell', pid: 0, createdAt: 1, collectionId: null, aiType: null }],
      activeSessionId: 's1'
    })
    useSessionStore.getState().removeSession('s1')
    expect(useSessionStore.getState().sessions).toHaveLength(0)
    expect(useSessionStore.getState().activeSessionId).toBeNull()
  })

  it('activates the next session when removing the active session', () => {
    useSessionStore.setState({
      sessions: [
        { id: 's1', title: 'T1', color: 'blue', cwd: '', shell: 'powershell', pid: 0, createdAt: 1, collectionId: null, aiType: null },
        { id: 's2', title: 'T2', color: 'green', cwd: '', shell: 'powershell', pid: 0, createdAt: 2, collectionId: null, aiType: null }
      ],
      activeSessionId: 's1'
    })
    useSessionStore.getState().removeSession('s1')
    expect(useSessionStore.getState().activeSessionId).toBe('s2')
  })

  it('activates the last session when removing the last in order', () => {
    useSessionStore.setState({
      sessions: [
        { id: 's1', title: 'T1', color: 'blue', cwd: '', shell: 'powershell', pid: 0, createdAt: 1, collectionId: null, aiType: null },
        { id: 's2', title: 'T2', color: 'green', cwd: '', shell: 'powershell', pid: 0, createdAt: 2, collectionId: null, aiType: null }
      ],
      activeSessionId: 's2'
    })
    useSessionStore.getState().removeSession('s2')
    expect(useSessionStore.getState().activeSessionId).toBe('s1')
  })

  it('is a no-op when session does not exist', () => {
    useSessionStore.setState({
      sessions: [{ id: 's1', title: 'T1', color: 'blue', cwd: '', shell: 'powershell', pid: 0, createdAt: 1, collectionId: null, aiType: null }],
      activeSessionId: 's1'
    })
    useSessionStore.getState().removeSession('nope')
    expect(useSessionStore.getState().sessions).toHaveLength(1)
  })

  it('clears attention timer when removing a session', () => {
    useSessionStore.setState({
      sessions: [{ id: 's1', title: 'T1', color: 'blue', cwd: '', shell: 'powershell', pid: 0, createdAt: 1, collectionId: null, aiType: null }],
      activeSessionId: 's1'
    })
    useSessionStore.getState().setAttention('s1', 'start')
    useSessionStore.getState().removeSession('s1')
    expect(useSessionStore.getState().sessions).toHaveLength(0)
  })
})

describe('setActive / renameSession / setColor / updatePid / moveSessionToCollection', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [{ id: 's1', title: 'T1', color: 'blue', cwd: '', shell: 'powershell', pid: 0, createdAt: 1, collectionId: null, aiType: null }]
    })
  })

  it('setActive updates activeSessionId', () => {
    useSessionStore.getState().setActive('s1')
    expect(useSessionStore.getState().activeSessionId).toBe('s1')
  })

  it('renameSession updates the title', () => {
    useSessionStore.getState().renameSession('s1', 'New Name')
    expect(useSessionStore.getState().sessions[0].title).toBe('New Name')
  })

  it('setColor updates the color', () => {
    useSessionStore.getState().setColor('s1', 'coral')
    expect(useSessionStore.getState().sessions[0].color).toBe('coral')
  })

  it('updatePid updates the pid', () => {
    useSessionStore.getState().updatePid('s1', 1234)
    expect(useSessionStore.getState().sessions[0].pid).toBe(1234)
  })

  it('moveSessionToCollection sets collectionId', () => {
    useSessionStore.getState().moveSessionToCollection('s1', 'col1')
    expect(useSessionStore.getState().sessions[0].collectionId).toBe('col1')
  })
})

describe('collections', () => {
  it('addCollection creates a new collection', () => {
    const id = useSessionStore.getState().addCollection('My Group')
    const state = useSessionStore.getState()
    expect(state.collections).toHaveLength(1)
    expect(state.collections[0].name).toBe('My Group')
    expect(state.collections[0].parentId).toBeNull()
  })

  it('addCollection accepts optional parentId', () => {
    const parentId = useSessionStore.getState().addCollection('Parent')
    const childId = useSessionStore.getState().addCollection('Child', parentId)
    const child = useSessionStore.getState().collections.find(c => c.id === childId)
    expect(child?.parentId).toBe(parentId)
  })

  it('removeCollection removes a collection and its descendants', () => {
    useSessionStore.setState({
      collections: [
        { id: 'c1', name: 'Parent', parentId: null, collapsed: false, createdAt: 1 },
        { id: 'c2', name: 'Child', parentId: 'c1', collapsed: false, createdAt: 2 },
        { id: 'c3', name: 'Other', parentId: null, collapsed: false, createdAt: 3 }
      ]
    })
    useSessionStore.getState().removeCollection('c1')
    expect(useSessionStore.getState().collections).toHaveLength(1)
    expect(useSessionStore.getState().collections[0].id).toBe('c3')
  })

  it('removeCollection clears collectionId on affected sessions', () => {
    useSessionStore.setState({
      collections: [{ id: 'c1', name: 'G', parentId: null, collapsed: false, createdAt: 1 }],
      sessions: [{ id: 's1', title: 'T', color: 'blue', cwd: '', shell: 'powershell', pid: 0, createdAt: 1, collectionId: 'c1', aiType: null }]
    })
    useSessionStore.getState().removeCollection('c1')
    expect(useSessionStore.getState().sessions[0].collectionId).toBeNull()
  })

  it('renameCollection renames a collection', () => {
    useSessionStore.setState({
      collections: [{ id: 'c1', name: 'Old', parentId: null, collapsed: false, createdAt: 1 }]
    })
    useSessionStore.getState().renameCollection('c1', 'New')
    expect(useSessionStore.getState().collections[0].name).toBe('New')
  })

  it('toggleCollectionCollapse toggles collapsed state', () => {
    useSessionStore.setState({
      collections: [{ id: 'c1', name: 'G', parentId: null, collapsed: false, createdAt: 1 }]
    })
    useSessionStore.getState().toggleCollectionCollapse('c1')
    expect(useSessionStore.getState().collections[0].collapsed).toBe(true)
    useSessionStore.getState().toggleCollectionCollapse('c1')
    expect(useSessionStore.getState().collections[0].collapsed).toBe(false)
  })

  it('moveCollection sets new parentId', () => {
    useSessionStore.setState({
      collections: [
        { id: 'c1', name: 'A', parentId: null, collapsed: false, createdAt: 1 },
        { id: 'c2', name: 'B', parentId: null, collapsed: false, createdAt: 2 }
      ]
    })
    useSessionStore.getState().moveCollection('c1', 'c2')
    expect(useSessionStore.getState().collections.find(c => c.id === 'c1')?.parentId).toBe('c2')
  })

  it('moveCollection prevents circular parent reference', () => {
    useSessionStore.setState({
      collections: [
        { id: 'c1', name: 'A', parentId: null, collapsed: false, createdAt: 1 },
        { id: 'c2', name: 'B', parentId: 'c1', collapsed: false, createdAt: 2 }
      ]
    })
    useSessionStore.getState().moveCollection('c1', 'c2')
    // Should not set because c2 is descendant of c1
    expect(useSessionStore.getState().collections.find(c => c.id === 'c1')?.parentId).toBeNull()
  })

  it('moveCollection prevents moving into itself', () => {
    useSessionStore.setState({
      collections: [{ id: 'c1', name: 'A', parentId: null, collapsed: false, createdAt: 1 }]
    })
    useSessionStore.getState().moveCollection('c1', 'c1')
    expect(useSessionStore.getState().collections.find(c => c.id === 'c1')?.parentId).toBeNull()
  })
})

describe('sidebar', () => {
  it('toggleSidebar toggles visibility', () => {
    useSessionStore.getState().toggleSidebar()
    expect(useSessionStore.getState().sidebarVisible).toBe(false)
    useSessionStore.getState().toggleSidebar()
    expect(useSessionStore.getState().sidebarVisible).toBe(true)
  })

  it('setSidebarWidth clamps within bounds', () => {
    useSessionStore.getState().setSidebarWidth(50)
    expect(useSessionStore.getState().sidebarWidth).toBe(160)
    useSessionStore.getState().setSidebarWidth(500)
    expect(useSessionStore.getState().sidebarWidth).toBe(320)
    useSessionStore.getState().setSidebarWidth(200)
    expect(useSessionStore.getState().sidebarWidth).toBe(200)
  })
})

describe('navigation', () => {
  function seedSessions(count: number) {
    useSessionStore.setState({
      sessions: Array.from({ length: count }, (_, i) => ({
        id: `s${i}`,
        title: `T${i}`,
        color: SESSION_COLORS[i % SESSION_COLORS.length],
        cwd: '',
        shell: 'powershell' as const,
        pid: 0,
        createdAt: i,
        collectionId: null,
        aiType: null
      })),
      activeSessionId: 's0'
    })
  }

  it('navigateNext goes forward and wraps', () => {
    seedSessions(3)
    useSessionStore.getState().navigateNext()
    expect(useSessionStore.getState().activeSessionId).toBe('s1')
    useSessionStore.getState().navigateNext()
    expect(useSessionStore.getState().activeSessionId).toBe('s2')
    useSessionStore.getState().navigateNext()
    expect(useSessionStore.getState().activeSessionId).toBe('s0')
  })

  it('navigatePrev goes backward and wraps', () => {
    seedSessions(3)
    useSessionStore.getState().navigatePrev()
    expect(useSessionStore.getState().activeSessionId).toBe('s2')
  })

  it('navigateToIndex selects by index', () => {
    seedSessions(3)
    useSessionStore.getState().navigateToIndex(1)
    expect(useSessionStore.getState().activeSessionId).toBe('s1')
  })

  it('navigateToIndex ignores out-of-range index', () => {
    seedSessions(2)
    useSessionStore.getState().navigateToIndex(10)
    expect(useSessionStore.getState().activeSessionId).toBe('s0')
  })

  it('navigateNext is no-op with single session', () => {
    seedSessions(1)
    useSessionStore.getState().navigateNext()
    expect(useSessionStore.getState().activeSessionId).toBe('s0')
  })
})

describe('attention', () => {
  it('setAttention sets an event type', () => {
    useSessionStore.getState().setAttention('s1', 'start')
    expect(useSessionStore.getState().attentionMap['s1']).toBe('start')
  })

  it('setAttention with null clears the event type', () => {
    useSessionStore.setState({ attentionMap: { s1: 'start' } })
    useSessionStore.getState().setAttention('s1', null)
    expect(useSessionStore.getState().attentionMap['s1']).toBeNull()
  })

  it('setAttention coalesces rapid successive calls within 1s', () => {
    useSessionStore.getState().setAttention('s1', 'start')
    useSessionStore.getState().setAttention('s1', 'permission')
    // Second call should be coalesced (timer already set)
    expect(useSessionStore.getState().attentionMap['s1']).toBe('start')
  })

  it('resetAttention calls setAttention with null and IPC', () => {
    useSessionStore.getState().resetAttention('s1')
    expect(mockResetAttention).toHaveBeenCalledWith('s1')
  })

  it('setAiType sets the ai type on a session', () => {
    useSessionStore.setState({
      sessions: [{ id: 's1', title: 'T', color: 'blue', cwd: '', shell: 'powershell', pid: 0, createdAt: 1, collectionId: null, aiType: null }]
    })
    useSessionStore.getState().setAiType('s1', 'codex')
    expect(useSessionStore.getState().sessions[0].aiType).toBe('codex')
  })
})

describe('buildSessionPersistedState', () => {
  it('returns session state without runtime-only fields', () => {
    useSessionStore.setState({
      sessions: [{
        id: 's1', title: 'T', color: 'blue', cwd: '', shell: 'powershell',
        pid: 1234, createdAt: 1, collectionId: null, aiType: 'claude'
      }],
      activeSessionId: 's1',
      sidebarVisible: true,
      sidebarWidth: 220
    })
    const result = buildSessionPersistedState()
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]).not.toHaveProperty('pid')
    expect(result.sessions[0]).not.toHaveProperty('aiType')
    expect(result.activeSessionId).toBe('s1')
    expect(result.sidebarVisible).toBe(true)
  })
})
