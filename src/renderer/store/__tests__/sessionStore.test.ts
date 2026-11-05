import { agentUpdate } from '../../../shared/__tests__/agentFixtures'
import type { AgentStatus, AgentUpdate } from '../../../shared/agentTypes'
import { effectiveActivity, type ProgramBatch, type ProgramUpdate } from '../../../shared/programTypes'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../dirtyScheduler', () => ({
  markDirty: vi.fn()
}))

const mockStateLoad = vi.fn()
const mockAgentSnapshot = vi.fn(async () => ({ revision: 0, agents: [] as AgentUpdate[] }))
const mockProgramSnapshot = vi.fn(async (): Promise<ProgramBatch> => ({ revision: 0, programs: [] }))
let capturedProgramCallback: ((batch: ProgramBatch) => void) | null = null
const mockOnProgramUpdate = vi.fn(cb => {
  capturedProgramCallback = cb
  return { ready: Promise.resolve(), unsubscribe: vi.fn() }
})
let capturedAgentCallback: ((update: AgentUpdate) => void) | null = null
const mockOnAgentUpdate = vi.fn((cb) => {
  capturedAgentCallback = cb
  return { ready: Promise.resolve(), unsubscribe: vi.fn() }
})

vi.stubGlobal('window', {
  terminalAPI: {
    stateLoad: mockStateLoad,
    agentStateSnapshot: mockAgentSnapshot,
    programStateSnapshot: mockProgramSnapshot,
    onProgramUpdate: mockOnProgramUpdate,
    onAgentUpdate: mockOnAgentUpdate
  },
  addEventListener: vi.fn()
})

import { useSessionStore, buildSessionPersistedState, teardownSessionIPC, SESSION_COLORS } from '../sessionStore'

beforeEach(() => {
  vi.clearAllMocks()
  mockAgentSnapshot.mockReset().mockResolvedValue({ revision: 0, agents: [] })
  capturedAgentCallback = null
  capturedProgramCallback = null
  mockProgramSnapshot.mockReset().mockResolvedValue({ revision: 0, programs: [] })
  teardownSessionIPC()
  useSessionStore.setState({
    sessions: [],
    collections: [],
    activeSessionId: null,
    sidebarVisible: true,
    sidebarWidth: 220,
    loaded: false,
    agentStates: {}, agentRevisions: {}, agentRevisionFloor: 0, programStates: {}, programRevisionFloor: 0
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

  it('stores ssh target and custom title for ssh sessions', () => {
    const ssh = { host: '10.0.0.5', port: 2222, user: 'deploy' }
    useSessionStore.getState().addSession({ shell: 'ssh', title: 'prod', ssh })
    const s = useSessionStore.getState().sessions[0]
    expect(s.shell).toBe('ssh')
    expect(s.title).toBe('prod')
    expect(s.ssh).toEqual(ssh)
  })

  it('defaults ssh to null for local sessions', () => {
    useSessionStore.getState().addSession()
    expect(useSessionStore.getState().sessions[0].ssh).toBeNull()
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
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 's1', agent: { aiType: 'claude', status: 'working' } }))
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
    useSessionStore.getState().addCollection('My Group')
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

  it('toggleSidebar marks transitioning until endSidebarTransition', () => {
    useSessionStore.setState({ sidebarVisible: true, sidebarTransitioning: false })
    useSessionStore.getState().toggleSidebar()
    expect(useSessionStore.getState().sidebarTransitioning).toBe(true)
    useSessionStore.getState().endSidebarTransition()
    expect(useSessionStore.getState().sidebarTransitioning).toBe(false)
  })

  it('endSidebarTransition is a no-op when not transitioning', () => {
    useSessionStore.setState({ sidebarTransitioning: false })
    useSessionStore.getState().endSidebarTransition()
    expect(useSessionStore.getState().sidebarTransitioning).toBe(false)
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

describe('agent activity', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [{ id: 's1', title: 'T', color: 'blue', cwd: '', shell: 'cmd', pid: 0, createdAt: 1, collectionId: null }] })
  })

  it('applies runtime state and agent identity together', () => {
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 's1', agent: { aiType: 'codex', status: 'waiting_approval' } }))
    expect(useSessionStore.getState().agentStates.s1).toEqual({ status: 'waiting_approval', unread: true })
    expect(useSessionStore.getState().sessions[0].aiType).toBe('codex')
  })

  it('reading an approval keeps the runtime state and attention classification', () => {
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 's1', agent: { aiType: 'claude', status: 'waiting_approval' } }))
    useSessionStore.getState().markAgentRead('s1')
    expect(useSessionStore.getState().agentStates.s1).toEqual({ status: 'waiting_approval', unread: false })
    expect(useSessionStore.getState().sessions[0].aiType).toBe('claude')
  })

  it('new work clears an old completed or failed notice', () => {
    for (const status of ['complete', 'error'] satisfies AgentStatus[]) {
      useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 's1', agent: { aiType: 'claude', status } }))
      expect(useSessionStore.getState().agentStates.s1).toEqual({ status, unread: true })
      useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 's1', agent: { aiType: 'claude', status: 'working' } }))
      expect(useSessionStore.getState().agentStates.s1).toEqual({ status: 'working', unread: false })
    }
  })

  it('duplicate events do not rearm a notice after it was read', () => {
    const update: AgentUpdate = agentUpdate({ paneId: 's1', agent: { aiType: 'claude', status: 'complete' } })
    useSessionStore.getState().applyAgentUpdate(update)
    useSessionStore.getState().setActive('s1')
    useSessionStore.getState().applyAgentUpdate(update)
    expect(useSessionStore.getState().agentStates.s1).toEqual({ status: 'complete', unread: false })
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 's1', agent: { aiType: 'claude', status: 'working' } }))
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 's1', agent: { aiType: 'claude', status: 'complete' } }))
    expect(useSessionStore.getState().agentStates.s1).toEqual({ status: 'complete', unread: true })
  })

  it('clearing a session clears its identity and runtime state together', () => {
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 's1', agent: { aiType: 'codex', status: 'error' } }))
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 's1', agent: null }))
    expect(useSessionStore.getState().agentStates).toEqual({})
    expect(useSessionStore.getState().sessions[0].aiType).toBeNull()
  })

  it('ignores updates for removed sessions', () => {
    const update: AgentUpdate = agentUpdate({ paneId: 's1', agent: { aiType: 'codex', status: 'waiting_input' } })
    useSessionStore.getState().applyAgentUpdate(update)
    useSessionStore.getState().removeSession('s1')
    useSessionStore.getState().applyAgentUpdate(update)
    expect(useSessionStore.getState().agentStates).toEqual({})
    expect(useSessionStore.getState().sessions).toEqual([])
  })

  it('rejects stale states and clears without rearming a read notice', () => {
    const store = useSessionStore.getState()
    store.applyAgentUpdate({ paneId: 's1', revision: 10, agent: { aiType: 'codex', status: 'waiting_approval' } })
    store.markAgentRead('s1')
    store.applyAgentUpdate({ paneId: 's1', revision: 9, agent: { aiType: 'claude', status: 'complete' } })
    store.applyAgentUpdate({ paneId: 's1', revision: 8, agent: null })
    expect(useSessionStore.getState().agentStates.s1).toEqual({ status: 'waiting_approval', unread: false })
    expect(useSessionStore.getState().sessions[0].aiType).toBe('codex')
    store.applyAgentUpdate({ paneId: 's1', revision: 11, agent: { aiType: 'codex', status: 'working' } })
    store.applyAgentUpdate({ paneId: 's1', revision: 12, agent: { aiType: 'codex', status: 'complete' } })
    store.applyAgentUpdate({ paneId: 's1', revision: 11, agent: null })
    expect(useSessionStore.getState().agentStates.s1).toEqual({ status: 'complete', unread: true })
    store.applyAgentUpdate({ paneId: 's1', revision: 13, agent: null })
    expect(useSessionStore.getState().agentStates).toEqual({})
    expect(useSessionStore.getState().sessions[0].aiType).toBeNull()
  })
})

describe('agent snapshot reconciliation', () => {
  function persisted(id = 's1') {
    return {
      sessions: [{ id, title: id, color: 'blue', cwd: '', shell: 'cmd', collectionId: null }],
      collections: [], activeSessionId: id, sidebarVisible: true, sidebarWidth: 220
    }
  }

  it('merges a snapshot with newer buffered events and ignores orphan panes', async () => {
    mockStateLoad.mockImplementationOnce(async () => {
      capturedAgentCallback?.({ paneId: 's1', revision: 21, agent: { aiType: 'codex', status: 'working' } })
      capturedAgentCallback?.({ paneId: 's1', revision: 18, agent: { aiType: 'codex', status: 'complete' } })
      return persisted()
    })
    mockAgentSnapshot.mockResolvedValueOnce({ revision: 20, agents: [
      { paneId: 's1', revision: 17, agent: { aiType: 'codex', status: 'idle' } },
      { paneId: 'removed', revision: 20, agent: { aiType: 'claude', status: 'error' } }
    ] })
    await useSessionStore.getState().loadState()
    expect(useSessionStore.getState().agentStates).toEqual({ s1: { status: 'working', unread: false } })
    expect(useSessionStore.getState().sessions.map((s) => [s.id, s.aiType])).toEqual([['s1', 'codex']])
    expect(useSessionStore.getState().agentRevisions).toEqual({ s1: 21 })
  })

  it('uses an empty snapshot watermark to reject old clears and old attention', async () => {
    mockStateLoad.mockImplementationOnce(async () => {
      capturedAgentCallback?.({ paneId: 's1', revision: 90, agent: { aiType: 'codex', status: 'waiting_approval' } })
      return persisted()
    })
    mockAgentSnapshot.mockResolvedValueOnce({ revision: 100, agents: [] })
    await useSessionStore.getState().loadState()
    capturedAgentCallback?.({ paneId: 's1', revision: 99, agent: { aiType: 'codex', status: 'complete' } })
    expect(useSessionStore.getState().agentStates).toEqual({})
    expect(useSessionStore.getState().sessions[0].aiType).toBeNull()
    capturedAgentCallback?.({ paneId: 's1', revision: 101, agent: { aiType: 'codex', status: 'working' } })
    expect(useSessionStore.getState().agentStates).toEqual({ s1: { status: 'working', unread: false } })
  })

  it('waits until subscription is active before reading the snapshot', async () => {
    let activate: () => void = () => undefined
    const ready = new Promise<void>((resolve) => { activate = resolve })
    mockOnAgentUpdate.mockReturnValueOnce({ ready, unsubscribe: vi.fn() })
    mockStateLoad.mockResolvedValueOnce(persisted())
    const loading = useSessionStore.getState().loadState()
    expect(mockStateLoad).not.toHaveBeenCalled()
    expect(mockAgentSnapshot).not.toHaveBeenCalled()
    activate()
    await loading
    expect(useSessionStore.getState().sessions.map((s) => s.id)).toEqual(['s1'])
    expect(mockAgentSnapshot).toHaveBeenCalledOnce()
  })

  it('cancels overlapping loads and prevents old listeners from changing the new store', async () => {
    let release: (value: ReturnType<typeof persisted>) => void = () => undefined
    let entered: () => void = () => undefined
    const started = new Promise<void>((resolve) => { entered = resolve })
    mockStateLoad.mockImplementationOnce(() => {
      entered()
      return new Promise<ReturnType<typeof persisted>>((resolve) => { release = resolve })
    }).mockResolvedValueOnce(persisted('s2'))
    const oldLoad = useSessionStore.getState().loadState()
    const oldCallback = capturedAgentCallback
    await started
    await useSessionStore.getState().loadState()
    capturedAgentCallback?.({ paneId: 's2', revision: 10, agent: { aiType: 'codex', status: 'working' } })
    oldCallback?.({ paneId: 's2', revision: 999, agent: { aiType: 'claude', status: 'error' } })
    release(persisted('s1'))
    expect(await oldLoad).toBeNull()
    expect(useSessionStore.getState().sessions.map((s) => [s.id, s.aiType])).toEqual([['s2', 'codex']])
    expect(useSessionStore.getState().agentStates).toEqual({ s2: { status: 'working', unread: false } })
    const callback = capturedAgentCallback
    teardownSessionIPC()
    callback?.({ paneId: 's2', revision: 1000, agent: null })
    expect(useSessionStore.getState().agentStates).toEqual({ s2: { status: 'working', unread: false } })
  })
})

describe('loadState / saveState', () => {
  it('retains the latest agent update received while persisted sessions are loading', async () => {
    mockStateLoad.mockImplementationOnce(async () => {
      capturedAgentCallback?.(agentUpdate({ paneId: 's1', agent: { aiType: 'codex', status: 'complete' } }))
      capturedAgentCallback?.(agentUpdate({ paneId: 's1', agent: { aiType: 'codex', status: 'working' } }))
      return {
        sessions: [{ id: 's1', title: 'T', color: 'blue', cwd: '', shell: 'cmd', collectionId: null }],
        collections: [], activeSessionId: 's1', sidebarVisible: true, sidebarWidth: 220
      }
    })
    await useSessionStore.getState().loadState()
    expect(useSessionStore.getState().sessions[0].aiType).toBe('codex')
    expect(useSessionStore.getState().agentStates.s1).toEqual({ status: 'working', unread: false })
  })

  it('loadState restores persisted state', async () => {
    mockStateLoad.mockResolvedValue({
      sessions: [
        { id: 's1', title: 'T1', color: 'blue', cwd: '', shell: 'powershell', collectionId: null },
        { id: 's2', title: 'T2', color: 'green', cwd: '', shell: 'bash', collectionId: null }
      ],
      collections: [{ id: 'c1', name: 'Group', parentId: null, collapsed: false, createdAt: 1 }],
      activeSessionId: 's1',
      sidebarVisible: false,
      sidebarWidth: 180
    })
    const result = await useSessionStore.getState().loadState()
    const state = useSessionStore.getState()
    expect(state.sessions).toHaveLength(2)
    expect(state.sessions[0].id).toBe('s1')
    expect(state.sessions[1].shell).toBe('bash')
    expect(state.collections).toHaveLength(1)
    expect(state.collections[0].name).toBe('Group')
    expect(state.activeSessionId).toBe('s1')
    expect(state.sidebarVisible).toBe(false)
    expect(state.sidebarWidth).toBe(180)
    expect(state.loaded).toBe(true)
    expect(result).not.toBeNull()
    expect(mockOnAgentUpdate).toHaveBeenCalled()
  })

  it('loadState adds pid and null aiType to sessions', async () => {
    mockStateLoad.mockResolvedValue({
      sessions: [{ id: 's1', title: 'T', color: 'blue', cwd: '', shell: 'powershell', collectionId: null }],
      collections: [],
      activeSessionId: 's1',
      sidebarVisible: true,
      sidebarWidth: 220
    })
    await useSessionStore.getState().loadState()
    const s = useSessionStore.getState().sessions[0]
    expect(s.pid).toBe(0)
    expect(s.aiType).toBeNull()
    expect(s.createdAt).toBeGreaterThan(0)
  })

  it('loadState handles failure gracefully', async () => {
    mockStateLoad.mockRejectedValue(new Error('load failed'))
    const result = await useSessionStore.getState().loadState()
    expect(result).toBeNull()
    expect(useSessionStore.getState().loaded).toBe(true)
  })

  it('loadState registers IPC listeners only once (guards duplicate)', async () => {
    mockStateLoad.mockResolvedValue({
      sessions: [],
      collections: [],
      activeSessionId: null,
      sidebarVisible: true,
      sidebarWidth: 220
    })
    await useSessionStore.getState().loadState()
    await useSessionStore.getState().loadState()

    expect(mockOnAgentUpdate).toHaveBeenCalledTimes(2)
  })

  it('loadState IPC callback applies runtime state and identity together', async () => {
    mockStateLoad.mockResolvedValue({
      sessions: [{ id: 's1', title: 'T', color: 'blue', cwd: '', shell: 'powershell', collectionId: null }],
      collections: [],
      activeSessionId: 's1',
      sidebarVisible: true,
      sidebarWidth: 220
    })

    await useSessionStore.getState().loadState()

    expect(capturedAgentCallback).not.toBeNull()
    capturedAgentCallback?.(agentUpdate({ paneId: 's1', agent: { aiType: 'claude', status: 'working' } }))

    expect(useSessionStore.getState().agentStates['s1']).toEqual({ status: 'working', unread: false })
    expect(useSessionStore.getState().sessions[0].aiType).toBe('claude')
  })

  it('loadState IPC clear removes runtime state and identity', async () => {
    mockStateLoad.mockResolvedValue({
      sessions: [{ id: 's1', title: 'T', color: 'blue', cwd: '', shell: 'powershell', collectionId: null }],
      collections: [],
      activeSessionId: 's1',
      sidebarVisible: true,
      sidebarWidth: 220
    })
    await useSessionStore.getState().loadState()

    expect(capturedAgentCallback).not.toBeNull()


    capturedAgentCallback?.(agentUpdate({ paneId: 's1', agent: { aiType: 'claude', status: 'working' } }))
    capturedAgentCallback?.(agentUpdate({ paneId: 's1', agent: null }))

    expect(useSessionStore.getState().agentStates).toEqual({})

    expect(useSessionStore.getState().sessions[0].aiType).toBeNull()
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
  })

  it('keeps the ssh target so sessions reconnect after restart', () => {
    const ssh = { host: '10.0.0.5', user: 'deploy' }
    useSessionStore.setState({
      sessions: [{
        id: 's1', title: 'prod', color: 'blue', cwd: '', shell: 'ssh',
        pid: 1234, createdAt: 1, collectionId: null, aiType: null, ssh
      }],
      activeSessionId: 's1'
    })
    const result = buildSessionPersistedState()
    expect(result.sessions[0].ssh).toEqual(ssh)
    expect(result.sessions[0]).not.toHaveProperty('pid')
    expect(result.activeSessionId).toBe('s1')
    expect(result.sidebarVisible).toBe(true)
  })
})

describe('program status ownership and initialization', () => {
  function report(overrides: Partial<ProgramUpdate> = {}): ProgramUpdate {
    return { paneId: 's1', revision: 10, runId: '1', recordCount: 1, program: { id: '', revision: 2, state: 'blocked', kind: 'permission', app: 'deploy' }, ...overrides }
  }
  function apply(update: ProgramUpdate) {
    useSessionStore.getState().applyProgramBatch({ revision: update.revision, programs: [update] })
  }
  function current() {
    const state = useSessionStore.getState()
    return effectiveActivity(state.agentStates.s1, state.programStates.s1)
  }
  function persisted() {
    return { sessions: ['s1', 's2'].map(id => ({ id, title: id, color: 'blue', cwd: '', shell: 'cmd', collectionId: null })), collections: [], activeSessionId: 's2', sidebarVisible: true, sidebarWidth: 220 }
  }
  it('merges a newer partial batch with all other panes from an older initial snapshot', async () => {
    mockStateLoad.mockResolvedValue(persisted())
    mockProgramSnapshot.mockImplementationOnce(async () => {
      capturedProgramCallback?.({ revision: 12, programs: [report({ revision: 12, program: null, recordCount: 0 })] })
      capturedProgramCallback?.({ revision: 11, programs: [report({ revision: 11 })] })
      return { revision: 10, programs: [report(), report({ paneId: 's2', revision: 9 })] }
    })
    await useSessionStore.getState().loadState()
    expect(useSessionStore.getState().programStates.s1?.program).toBeNull()
    expect(useSessionStore.getState().programStates.s2?.activity).toEqual({ status: 'waiting_approval', unread: true })
    apply(report({ revision: 11 }))
    expect(useSessionStore.getState().programStates.s1?.program).toBeNull()
    expect(useSessionStore.getState().sessions.map(session => session.aiType)).toEqual([null, null])
  })
  it('preserves read state through identical reports, clears and older selections, but resets on a new run', () => {
    const id = useSessionStore.getState().addSession()
    const send = (update: ProgramUpdate) => apply({ ...update, paneId: id })
    send(report())
    useSessionStore.getState().setActive(id)
    expect(useSessionStore.getState().programStates[id]?.activity?.unread).toBe(false)
    send(report({ revision: 11 }))
    expect(useSessionStore.getState().programStates[id]?.activity?.unread).toBe(false)
    send(report({ revision: 12, program: null, recordCount: 0 }))
    send(report({ revision: 13, program: { id: '', revision: 1, state: 'done' } }))
    expect(useSessionStore.getState().programStates[id]?.activity).toEqual({ status: 'complete', unread: false })
    send(report({ revision: 14, runId: '14' }))
    expect(useSessionStore.getState().programStates[id]?.activity?.unread).toBe(true)
    send(report({ revision: 13 }))
    expect(useSessionStore.getState().programStates[id]?.runId).toBe('14')
    useSessionStore.getState().removeSession(id)
    send(report({ revision: 15 }))
    expect(useSessionStore.getState().programStates[id]).toBeUndefined()
  })
  it('keeps authenticated idle and unknown Hooks above blocked program output without modifying identity', () => {
    useSessionStore.setState({ sessions: [{ id: 's1', title: 'T', shell: 'cmd', color: 'blue', cwd: '', pid: 1, createdAt: 1, collectionId: null }] })
    apply(report())
    expect(current()).toEqual({ status: 'waiting_approval', unread: true })
    for (const status of ['idle', 'unknown'] satisfies AgentStatus[]) {
      useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 's1', agent: { aiType: 'codex', status } }))
      expect(current()).toEqual({ status, unread: false })
      useSessionStore.getState().markAgentRead('s1')
      expect(useSessionStore.getState().programStates.s1?.activity?.unread).toBe(true)
    }
    expect(useSessionStore.getState().sessions[0].aiType).toBe('codex')
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 's1', agent: null }))
    expect(current()).toEqual({ status: 'waiting_approval', unread: true })
    useSessionStore.getState().markAgentRead('s1')
    expect(current()?.unread).toBe(false)
  })
  it('rejects callbacks from a torn down listener and does not persist program metadata', async () => {
    mockStateLoad.mockResolvedValue(persisted())
    await useSessionStore.getState().loadState()
    const callback = capturedProgramCallback
    callback?.({ revision: 10, programs: [report()] })
    expect(useSessionStore.getState().programStates.s1?.program?.state).toBe('blocked')
    expect(buildSessionPersistedState()).not.toHaveProperty('programStates')
    teardownSessionIPC()
    callback?.({ revision: 11, programs: [report({ revision: 11, program: null, recordCount: 0 })] })
    expect(useSessionStore.getState().programStates.s1?.program?.state).toBe('blocked')
  })
})
