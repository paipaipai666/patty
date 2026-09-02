import { describe, it, expect, beforeEach, vi } from 'vitest'

// sessionLifecycle is the only place allowed to pair sessionStore and
// workspaceStore operations. These tests drive the real stores (with a stubbed
// terminalAPI) and pin the pairing contract that used to be re-implemented at
// every call site (REVIEW.md P1-6).

const mockKill = vi.fn()
const mockSelectDirectory = vi.fn()

vi.stubGlobal('window', {
  terminalAPI: {
    kill: mockKill,
    selectDirectory: mockSelectDirectory,
    stateLoad: vi.fn(),
    onAttentionChange: vi.fn(() => vi.fn())
  },
  addEventListener: vi.fn()
})

vi.mock('../dirtyScheduler', () => ({ markDirty: vi.fn() }))

import { useSessionStore } from '../sessionStore'
import { useWorkspaceStore, getFocusedSessionId } from '../workspaceStore'
import {
  createTerminal,
  createSshTerminal,
  createTerminalInCollection,
  createTerminalSplit,
  closeSession,
  closeAllSessions,
  selectSession
} from '../sessionLifecycle'

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.setState({
    sessions: [],
    collections: [],
    activeSessionId: null,
    sidebarVisible: true,
    sidebarWidth: 220,
    loaded: true,
    attentionMap: {}
  })
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null })
})

describe('createTerminal', () => {
  it('creates the session AND mounts it in a workspace', () => {
    const id = createTerminal({ shell: 'powershell' })
    const sessions = useSessionStore.getState().sessions
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(id)
    const ws = useWorkspaceStore.getState().workspaces
    expect(ws).toHaveLength(1)
    expect(ws[0].paneTree.type === 'leaf' && ws[0].paneTree.sessionId).toBe(id)
  })

  it('passes collectionId through to both stores', () => {
    useSessionStore.getState().addCollection('Work', null)
    const collectionId = useSessionStore.getState().collections[0].id
    const id = createTerminal({ collectionId, shell: 'cmd' })
    expect(useSessionStore.getState().sessions[0].collectionId).toBe(collectionId)
    expect(useWorkspaceStore.getState().workspaces[0].collectionId).toBe(collectionId)
    expect(useSessionStore.getState().activeSessionId).toBe(id)
  })
})

describe('createSshTerminal', () => {
  it('snapshots the profile into the session', () => {
    createSshTerminal({ id: 'p1', name: 'prod', host: '10.0.0.5', port: 22, user: 'deploy' })
    const s = useSessionStore.getState().sessions[0]
    expect(s.shell).toBe('ssh')
    expect(s.title).toBe('prod')
    expect(s.ssh).toEqual({ host: '10.0.0.5', port: 22, user: 'deploy', identityFile: undefined })
  })
})

describe('createTerminalInCollection', () => {
  it('creates session + workspace eagerly on picker success', async () => {
    mockSelectDirectory.mockResolvedValue({ canceled: false, directory: 'D:\\work' })
    await createTerminalInCollection('col-1', 'powershell')
    const s = useSessionStore.getState().sessions
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ cwd: 'D:\\work', collectionId: 'col-1', shell: 'powershell' })
    expect(useWorkspaceStore.getState().workspaces[0].collectionId).toBe('col-1')
  })

  it('is a no-op when the folder picker is canceled', async () => {
    mockSelectDirectory.mockResolvedValue({ canceled: true, directory: null })
    await createTerminalInCollection('col-1', 'powershell')
    expect(useSessionStore.getState().sessions).toHaveLength(0)
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0)
  })
})

describe('createTerminalSplit', () => {
  it('inherits the focused session cwd and shell, and focuses the new leaf', () => {
    const base = createTerminal({ cwd: 'C:\\proj', shell: 'pwsh' })
    selectSession(base)
    const id = createTerminalSplit('horizontal')
    const s = useSessionStore.getState().sessions
    expect(s).toHaveLength(2)
    expect(s[1]).toMatchObject({ cwd: 'C:\\proj', shell: 'pwsh' })
    expect(getFocusedSessionId()).toBe(id)
    const tree = useWorkspaceStore.getState().workspaces[0].paneTree
    expect(tree.type).toBe('split')
  })
})

describe('closeSession / closeAllSessions', () => {
  it('kills the PTY once and prunes the session from every workspace', () => {
    const id = createTerminal({ shell: 'powershell' })
    closeSession(id)
    expect(mockKill.mock.calls.filter((c) => c[0] === id)).toHaveLength(1)
    expect(useSessionStore.getState().sessions).toHaveLength(0)
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0)
  })

  it('closeAllSessions empties both stores', () => {
    createTerminal({ shell: 'cmd' })
    createTerminal({ shell: 'pwsh' })
    closeAllSessions()
    expect(useSessionStore.getState().sessions).toHaveLength(0)
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0)
  })
})

describe('selectSession', () => {
  it('activates the session and makes its workspace visible', () => {
    const a = createTerminal({ shell: 'cmd' })
    const b = createTerminal({ shell: 'pwsh' })
    selectSession(a)
    expect(useSessionStore.getState().activeSessionId).toBe(a)
    const ws = useWorkspaceStore.getState()
    const activeWs = ws.workspaces.find((w) => w.id === ws.activeWorkspaceId)
    expect(activeWs && JSON.stringify(activeWs.paneTree).includes(a)).toBe(true)
    expect(b).not.toBe(a)
  })
})
