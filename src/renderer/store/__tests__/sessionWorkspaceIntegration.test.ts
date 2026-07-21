import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockStateSave = vi.fn()
const mockStateLoad = vi.fn()
const mockKill = vi.fn()
const mockOnAttentionChange = vi.fn(() => vi.fn())
const mockOnPtyExit = vi.fn(() => vi.fn())

vi.stubGlobal('window', {
  terminalAPI: {
    stateLoad: mockStateLoad,
    stateSave: mockStateSave,
    kill: mockKill,
    onAttentionChange: mockOnAttentionChange,
    onPtyExit: mockOnPtyExit,
  },
  addEventListener: vi.fn(),
})

import { useSessionStore, buildSessionPersistedState, teardownSessionIPC } from '../sessionStore'
import { useWorkspaceStore } from '../workspaceStore'
import { configureDirtyScheduler, flushNow } from '../dirtyScheduler'
import { normalizeWorkspaces } from '../../../shared/workspaceNormalize'
import type { PersistedState } from '../../../shared/stateTypes'

vi.useFakeTimers()

function initStores() {
  teardownSessionIPC()
  useSessionStore.setState({
    sessions: [],
    collections: [],
    activeSessionId: null,
    sidebarVisible: true,
    sidebarWidth: 220,
    sidebarTransitioning: false,
    loaded: false,
    attentionMap: {},
    draggingSessionId: null,
  })
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    activeWorkspaceReady: false,
  })
}

function wirePersistence() {
  configureDirtyScheduler(() => {
    const sessionState = buildSessionPersistedState()
    if (!useSessionStore.getState().loaded) return null
    const wsState = useWorkspaceStore.getState().toPersisted()
    return { ...sessionState, ...wsState }
  })
}

function makeSession(sid: string, title: string, overrides: Record<string, unknown> = {}) {
  return { id: sid, title, color: 'blue', cwd: '', shell: 'powershell', pid: 0, createdAt: 1, collectionId: null, aiType: null, ...overrides }
}

beforeEach(() => {
  configureDirtyScheduler(() => null)
  flushNow()
  vi.clearAllMocks()
  initStores()
})

afterEach(() => {
  flushNow()
})

describe('new terminal flow: addSession → createWorkspace', () => {
  it('creates session and workspace with matching ids', () => {
    const sid = useSessionStore.getState().addSession({ shell: 'powershell' })
    expect(useSessionStore.getState().sessions).toHaveLength(1)
    expect(useSessionStore.getState().activeSessionId).toBe(sid)

    const wid = useWorkspaceStore.getState().createWorkspace(sid)
    const ws = useWorkspaceStore.getState().workspaces[0]
    expect(ws.id).toBe(wid)
    expect(ws.paneTree).toEqual({ id: expect.any(String), type: 'leaf', sessionId: sid })
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(wid)
  })

  it('creates workspace with collectionId matching the session', () => {
    const sid = useSessionStore.getState().addSession({ collectionId: 'col1' })
    useWorkspaceStore.getState().createWorkspace(sid, 'col1')
    expect(useWorkspaceStore.getState().workspaces[0].collectionId).toBe('col1')
  })

  it('adds sessions incrementally with correct colors and workspace names', () => {
    for (let i = 0; i < 3; i++) {
      const sid = useSessionStore.getState().addSession()
      useWorkspaceStore.getState().createWorkspace(sid)
    }
    expect(useSessionStore.getState().sessions).toHaveLength(3)
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(3)
    expect(useSessionStore.getState().sessions[0].color).toBe('blue')
    expect(useSessionStore.getState().sessions[1].color).toBe('green')
    expect(useSessionStore.getState().sessions[2].color).toBe('amber')
    expect(useWorkspaceStore.getState().workspaces[0].name).toBe('Workspace 1')
    expect(useWorkspaceStore.getState().workspaces[1].name).toBe('Workspace 2')
    expect(useWorkspaceStore.getState().workspaces[2].name).toBe('Workspace 3')
  })
})

describe('close session flow: removeSession → removeSessionEverywhere', () => {
  it('cleans up session and its workspace', () => {
    const sid = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(sid)

    useSessionStore.getState().removeSession(sid)
    useWorkspaceStore.getState().removeSessionEverywhere(sid)

    expect(useSessionStore.getState().sessions).toHaveLength(0)
    expect(useSessionStore.getState().activeSessionId).toBeNull()
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0)
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull()
  })

  it('kills the PTY when removing session', () => {
    const sid = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(sid)

    mockKill.mockClear()
    useSessionStore.getState().removeSession(sid)
    expect(mockKill).toHaveBeenCalledWith(sid)
  })

  it('preserves other workspaces when removing a session in only one workspace', () => {
    const s1 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s1)
    const s2 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s2)

    useSessionStore.getState().removeSession(s1)
    useWorkspaceStore.getState().removeSessionEverywhere(s1)

    expect(useSessionStore.getState().sessions).toHaveLength(1)
    expect(useSessionStore.getState().sessions[0].id).toBe(s2)
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(
      useWorkspaceStore.getState().workspaces[0].id
    )
  })

  it('heals workspace focus when the removed session was focused', () => {
    const s1 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s1)
    const s2 = useSessionStore.getState().addSession()

    useWorkspaceStore.getState().splitFocused(s2, 'horizontal')

    const tree = useWorkspaceStore.getState().workspaces[0].paneTree as any
    const otherLeafId = tree.first.sessionId === s1 ? tree.second.id : tree.first.id

    useWorkspaceStore.getState().removeSessionEverywhere(s1)
    expect(useWorkspaceStore.getState().workspaces[0].focusedPaneId).toBe(otherLeafId)
  })
})

describe('split pane flow: addSession → splitFocused', () => {
  it('splits the workspace tree and keeps both sessions', () => {
    const s1 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s1)

    const s2 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().splitFocused(s2, 'vertical')

    const tree = useWorkspaceStore.getState().workspaces[0].paneTree
    expect(tree.type).toBe('split')
    expect(useSessionStore.getState().sessions).toHaveLength(2)
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
  })

  it('new session inherits no cwd when focused session has none', () => {
    const s1 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s1)
    const s2 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().splitFocused(s2, 'horizontal')
    expect(useSessionStore.getState().sessions[1].cwd).toBe('')
  })

  it('is a no-op when there is no active workspace', () => {
    const sid = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().splitFocused(sid, 'horizontal')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0)
  })
})

describe('close pane flow: closeFocused', () => {
  it('removes the pane but keeps the session in the store', () => {
    const s1 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s1)

    useWorkspaceStore.getState().closeFocused()

    expect(useSessionStore.getState().sessions).toHaveLength(1)
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0)
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull()
  })

  it('removes one pane from a split and keeps the other pane', () => {
    const s1 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s1)
    const s2 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().splitFocused(s2, 'horizontal')

    useWorkspaceStore.getState().closeFocused()

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
    expect(useWorkspaceStore.getState().workspaces[0].paneTree.type).toBe('leaf')
  })
})

describe('select session across workspaces: setActive → ensureVisible', () => {
  it('switches workspace when session is in another workspace', () => {
    const s1 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s1)
    const wid1 = useWorkspaceStore.getState().activeWorkspaceId!

    const s2 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s2)
    const wid2 = useWorkspaceStore.getState().activeWorkspaceId!

    useWorkspaceStore.getState().switchWorkspace(wid1)
    useSessionStore.getState().setActive(s2)
    useWorkspaceStore.getState().ensureVisible(s2)

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(wid2)
    expect(useSessionStore.getState().activeSessionId).toBe(s2)
  })

  it('creates a new workspace when session is not in any workspace', () => {
    const s1 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s1)

    const s2 = useSessionStore.getState().addSession()
    useSessionStore.getState().setActive(s2)
    useWorkspaceStore.getState().ensureVisible(s2)

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2)
    expect(useSessionStore.getState().activeSessionId).toBe(s2)
  })

  it('focuses the correct pane without switching workspace when already in active workspace', () => {
    const s1 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s1)
    const s2 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().splitFocused(s2, 'horizontal')

    const wid = useWorkspaceStore.getState().activeWorkspaceId
    useWorkspaceStore.getState().focusPane(
      ((useWorkspaceStore.getState().workspaces[0].paneTree as any).second as any).id
    )

    useSessionStore.getState().setActive(s1)
    useWorkspaceStore.getState().ensureVisible(s1)

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(wid)
  })
})

describe('state persistence chain', () => {
  it('saves combined state from both stores on flush', () => {
    wirePersistence()
    useSessionStore.setState({ loaded: true })

    const sid = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(sid)

    flushNow()

    expect(mockStateSave).toHaveBeenCalledTimes(1)
    const saved = mockStateSave.mock.calls[0][0] as PersistedState
    expect(saved.sessions).toHaveLength(1)
    expect(saved.sessions[0].id).toBe(sid)
    expect(saved.workspaces).toHaveLength(1)
    expect(saved.workspaces[0].id).toBe(
      useWorkspaceStore.getState().workspaces[0].id
    )
    expect(saved.activeSessionId).toBe(sid)
    expect(saved.activeWorkspaceId).toBe(useWorkspaceStore.getState().activeWorkspaceId)
  })

  it('strips runtime-only fields from saved sessions', () => {
    wirePersistence()
    useSessionStore.setState({ loaded: true })

    const sid = useSessionStore.getState().addSession()
    useSessionStore.getState().updatePid(sid, 9999)

    flushNow()
    const saved = mockStateSave.mock.calls[0][0] as PersistedState
    expect(saved.sessions[0]).not.toHaveProperty('pid')
    expect(saved.sessions[0]).not.toHaveProperty('aiType')
  })

  it('saves workspace state after split', () => {
    wirePersistence()
    useSessionStore.setState({ loaded: true })

    const s1 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s1)
    const s2 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().splitFocused(s2, 'horizontal')

    flushNow()
    const saved = mockStateSave.mock.calls[0][0] as PersistedState
    expect(saved.workspaces[0].paneTree!.type).toBe('split')
  })

  it('returns null and skips save when sessionStore is not yet loaded', () => {
    wirePersistence()
    useSessionStore.setState({ loaded: false })
    useSessionStore.getState().addSession()

    flushNow()
    expect(mockStateSave).not.toHaveBeenCalled()
  })

  it('debounces multiple store mutations into one save', () => {
    wirePersistence()
    useSessionStore.setState({ loaded: true })

    useSessionStore.getState().addSession()
    useSessionStore.getState().setSidebarWidth(300)
    useSessionStore.getState().toggleSidebar()

    vi.advanceTimersByTime(100)

    useWorkspaceStore.getState().createWorkspace(
      useSessionStore.getState().sessions[0].id
    )

    vi.advanceTimersByTime(1000)

    expect(mockStateSave).toHaveBeenCalledTimes(1)
  })

  it('saves after removeSession triggers markDirty', () => {
    wirePersistence()
    useSessionStore.setState({ loaded: true })
    const sid = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(sid)

    vi.advanceTimersByTime(1000)
    mockStateSave.mockClear()

    useSessionStore.getState().removeSession(sid)
    useWorkspaceStore.getState().removeSessionEverywhere(sid)

    vi.advanceTimersByTime(1000)
    expect(mockStateSave).toHaveBeenCalled()
  })

  it('saves sidebar state alongside session and workspace state', () => {
    wirePersistence()
    useSessionStore.setState({ loaded: true })
    useSessionStore.getState().addSession()

    useSessionStore.getState().setSidebarWidth(280)
    useSessionStore.getState().toggleSidebar()

    flushNow()
    const saved = mockStateSave.mock.calls[0][0] as PersistedState
    expect(saved.sidebarWidth).toBe(280)
    expect(saved.sidebarVisible).toBe(false)
  })
})

describe('startup restore flow', () => {
  const persistedState: PersistedState = {
    sessions: [
      { id: 's1', title: 'Terminal 1', color: 'blue', cwd: '', shell: 'powershell', collectionId: null, createdAt: 100 },
      { id: 's2', title: 'Terminal 2', color: 'green', cwd: '/home', shell: 'bash', collectionId: null, createdAt: 200 },
    ],
    collections: [],
    activeSessionId: 's1',
    sidebarVisible: true,
    sidebarWidth: 220,
    workspaces: [
      {
        id: 'w1', name: 'Default', collectionId: null,
        paneTree: {
          id: 'sp1', type: 'split', direction: 'horizontal', ratio: 0.5,
          first: { id: 'p1', type: 'leaf', sessionId: 's1' },
          second: { id: 'p2', type: 'leaf', sessionId: 's2' },
        },
        focusedPaneId: 'p1',
      },
    ],
    activeWorkspaceId: 'w1',
  }

  it('loadState → normalizeWorkspaces → loadFromPersisted produces consistent stores', async () => {
    mockStateLoad.mockResolvedValue(persistedState)

    const loaded = await useSessionStore.getState().loadState()

    const sessions = useSessionStore.getState().sessions
    const knownIds = new Set(sessions.map((s) => s.id))
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
      loaded!.workspaces,
      loaded!.activeWorkspaceId,
      knownIds,
    )
    useWorkspaceStore.getState().loadFromPersisted(workspaces, activeWorkspaceId)

    expect(useSessionStore.getState().sessions).toHaveLength(2)
    expect(useSessionStore.getState().activeSessionId).toBe('s1')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('w1')
    expect(useWorkspaceStore.getState().workspaces[0].paneTree.type).toBe('split')
  })

  it('normalizeWorkspaces drops sessions from tree that are no longer in sessionStore', async () => {
    const stale = { ...persistedState }
    stale.sessions = [{ id: 's1', title: 'T1', color: 'blue', cwd: '', shell: 'powershell', collectionId: null, createdAt: 100 }]

    mockStateLoad.mockResolvedValue(stale)

    const loaded = await useSessionStore.getState().loadState()

    const sessions = useSessionStore.getState().sessions
    const knownIds = new Set(sessions.map((s) => s.id))
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
      loaded!.workspaces,
      loaded!.activeWorkspaceId,
      knownIds,
    )
    useWorkspaceStore.getState().loadFromPersisted(workspaces, activeWorkspaceId)

    expect(useSessionStore.getState().sessions).toHaveLength(1)
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
    expect(useWorkspaceStore.getState().workspaces[0].paneTree.type).toBe('leaf')
    expect((useWorkspaceStore.getState().workspaces[0].paneTree as any).sessionId).toBe('s1')
  })

  it('load adds pid and aiType to every session', async () => {
    mockStateLoad.mockResolvedValue(persistedState)
    await useSessionStore.getState().loadState()

    for (const s of useSessionStore.getState().sessions) {
      expect(s.pid).toBe(0)
      expect(s.aiType).toBeNull()
    }
  })

  it('loadFromPersisted ready state: single workspace is ready immediately', async () => {
    const singleWs: PersistedState = {
      sessions: [{ id: 's1', title: 'T', color: 'blue', cwd: '', shell: 'powershell', collectionId: null, createdAt: 100 }],
      collections: [],
      activeSessionId: 's1',
      sidebarVisible: true,
      sidebarWidth: 220,
      workspaces: [{ id: 'w1', name: 'W', collectionId: null, paneTree: { id: 'p1', type: 'leaf', sessionId: 's1' }, focusedPaneId: 'p1' }],
      activeWorkspaceId: 'w1',
    }
    mockStateLoad.mockResolvedValue(singleWs)

    const loaded = await useSessionStore.getState().loadState()
    const sessions = useSessionStore.getState().sessions
    const knownIds = new Set(sessions.map((s) => s.id))
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
      loaded!.workspaces, loaded!.activeWorkspaceId, knownIds,
    )
    useWorkspaceStore.getState().loadFromPersisted(workspaces, activeWorkspaceId)

    expect(useWorkspaceStore.getState().activeWorkspaceReady).toBe(true)
  })

  it('loadFromPersisted ready state: multiple workspaces is NOT ready', async () => {
    const multiWs: PersistedState = {
      sessions: [
        { id: 's1', title: 'T1', color: 'blue', cwd: '', shell: 'powershell', collectionId: null, createdAt: 100 },
        { id: 's2', title: 'T2', color: 'green', cwd: '', shell: 'bash', collectionId: null, createdAt: 200 },
      ],
      collections: [],
      activeSessionId: 's1',
      sidebarVisible: true,
      sidebarWidth: 220,
      workspaces: [
        { id: 'w1', name: 'W1', collectionId: null, paneTree: { id: 'p1', type: 'leaf', sessionId: 's1' }, focusedPaneId: 'p1' },
        { id: 'w2', name: 'W2', collectionId: null, paneTree: { id: 'p2', type: 'leaf', sessionId: 's2' }, focusedPaneId: 'p2' },
      ],
      activeWorkspaceId: 'w1',
    }
    mockStateLoad.mockResolvedValue(multiWs)

    const loaded = await useSessionStore.getState().loadState()
    const sessions = useSessionStore.getState().sessions
    const knownIds = new Set(sessions.map((s) => s.id))
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
      loaded!.workspaces, loaded!.activeWorkspaceId, knownIds,
    )
    useWorkspaceStore.getState().loadFromPersisted(workspaces, activeWorkspaceId)

    expect(useWorkspaceStore.getState().activeWorkspaceReady).toBe(false)
  })
})

describe('cross-store edge cases', () => {
  it('removes a session that exists in workspace tree but session was already removed', () => {
    const sid = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(sid)

    useSessionStore.getState().removeSession(sid)

    useWorkspaceStore.getState().removeSessionEverywhere(sid)

    expect(useSessionStore.getState().sessions).toHaveLength(0)
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0)
  })

  it('removeSessionEverywhere is a no-op when session is in no workspace', () => {
    const s1 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s1)
    const s2 = useSessionStore.getState().addSession()

    useWorkspaceStore.getState().removeSessionEverywhere(s2)

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
  })

  it('closeFocused + removeSessionEverywhere for the same session is safe', () => {
    const s1 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(s1)
    const s2 = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().splitFocused(s2, 'horizontal')

    useWorkspaceStore.getState().closeFocused()

    const wsBefore = useWorkspaceStore.getState().workspaces.length
    useWorkspaceStore.getState().removeSessionEverywhere(s2)

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(wsBefore)
  })

  it('closeFocused last pane + removeSessionEverywhere removes the workspace', () => {
    const sid = useSessionStore.getState().addSession()
    useWorkspaceStore.getState().createWorkspace(sid)

    useWorkspaceStore.getState().closeFocused()
    useWorkspaceStore.getState().removeSessionEverywhere(sid)

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0)
  })

  it('addSession + createWorkspace triggers markDirty in both stores', () => {
    wirePersistence()
    useSessionStore.setState({ loaded: true })

    useSessionStore.getState().addSession()
    expect(mockStateSave).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(mockStateSave).toHaveBeenCalled()
  })
})
