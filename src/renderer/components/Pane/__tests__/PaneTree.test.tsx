import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../../../store/workspaceStore', () => {
  const state: any = {
    workspaces: [],
    activeWorkspaceId: null,
    focusPane: vi.fn(),
    getState: () => state
  }
  const useWorkspaceStore = (sel: (s: typeof state) => unknown) => sel(state)
  useWorkspaceStore.getState = () => state
  return { useWorkspaceStore }
})

vi.mock('../../../store/sessionStore', () => {
  const state: any = {
    sessions: [],
    getState: () => state
  }
  const useSessionStore = (sel: (s: typeof state) => unknown) => sel(state)
  useSessionStore.getState = () => state
  return { useSessionStore }
})

vi.mock('../PaneView', () => ({
  PaneView: ({ session, paneId }: any) => <div data-testid="pane-view">{session?.id ?? paneId}</div>
}))

vi.mock('../Sash', () => ({
  Sash: () => <div data-testid="sash" />
}))

import { PaneTreeRoot } from '../PaneTree'
import { useWorkspaceStore } from '../../../store/workspaceStore'
import { useSessionStore, type TerminalSession } from '../../../store/sessionStore'
import type { Workspace } from '../../../../shared/workspaceTypes'

beforeEach(() => {
  const ws = useWorkspaceStore.getState()
  ws.workspaces = []
  ws.activeWorkspaceId = null
  vi.mocked(ws.focusPane).mockClear()
  const ss = useSessionStore.getState()
  ss.sessions = []
  document.body.innerHTML = ''
})

describe('PaneTreeRoot', () => {
  it('renders null when no workspaces', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => { root.render(<PaneTreeRoot />) })
    expect(container.innerHTML).toBe('')
  })

  it('renders leaves for single workspace with one session', () => {
    const ws = useWorkspaceStore.getState()
    ws.workspaces = [{
      id: 'ws1',
      name: 'Workspace 1',
      collectionId: null,
      paneTree: { id: 'p1', type: 'leaf', sessionId: 's1' },
      focusedPaneId: 'p1'
    }]
    ws.activeWorkspaceId = 'ws1'
    const ss = useSessionStore.getState()
    ss.sessions = [{
      id: 's1', title: 'T1', color: 'blue', cwd: '', shell: 'powershell', pid: 0, createdAt: 1, collectionId: null, aiType: null
    }]

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => { root.render(<PaneTreeRoot />) })
    const paneViews = container.querySelectorAll('[data-testid="pane-view"]')
    expect(paneViews.length).toBe(1)
  })

  it('renders PaneViewPlaceholder for missing session in tree', () => {
    const ws = useWorkspaceStore.getState()
    ws.workspaces = [{
      id: 'ws1',
      name: 'Workspace 1',
      collectionId: null,
      paneTree: { id: 'p1', type: 'leaf', sessionId: 'ghost' },
      focusedPaneId: 'p1'
    }]
    ws.activeWorkspaceId = 'ws1'

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => { root.render(<PaneTreeRoot />) })
    expect(container.textContent).toContain('session missing')
  })

  function makeWs(id: string, sessionId: string): Workspace {
    return {
      id,
      name: `Workspace ${id}`,
      collectionId: null,
      paneTree: { id: `leaf-${id}`, type: 'leaf', sessionId },
      focusedPaneId: `leaf-${id}`
    }
  }

  function makeSession(id: string): TerminalSession {
    return { id, title: `T-${id}`, color: 'blue', cwd: '', shell: 'powershell', pid: 0, createdAt: 1, collectionId: null, aiType: null }
  }

  it('mounts only the active workspace at startup (lazy restore of the other 99)', () => {
    const ws = useWorkspaceStore.getState()
    ws.workspaces = [makeWs('w1', 's1'), makeWs('w2', 's2')]
    ws.activeWorkspaceId = 'w1'
    const ss = useSessionStore.getState()
    ss.sessions = [makeSession('s1'), makeSession('s2')]

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => { root.render(<PaneTreeRoot />) })
    const paneViews = container.querySelectorAll('[data-testid="pane-view"]')
    expect(paneViews.length).toBe(1)
    expect(container.textContent).toBe('s1')
  })

  it('keeps a visited workspace mounted (hidden) after switching away', () => {
    const ws = useWorkspaceStore.getState()
    ws.workspaces = [makeWs('w1', 's1'), makeWs('w2', 's2')]
    ws.activeWorkspaceId = 'w1'
    const ss = useSessionStore.getState()
    ss.sessions = [makeSession('s1'), makeSession('s2')]

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => { root.render(<PaneTreeRoot />) })
    expect(container.querySelectorAll('[data-testid="pane-view"]')).toHaveLength(1)

    ws.activeWorkspaceId = 'w2'
    act(() => { root.render(<PaneTreeRoot />) })
    // w1 stays mounted (display:none, PTY + scrollback preserved), w2 mounts.
    expect(container.querySelectorAll('[data-testid="pane-view"]')).toHaveLength(2)
  })

  it('never mounts a workspace that was never visited', () => {
    const ws = useWorkspaceStore.getState()
    ws.workspaces = [makeWs('w1', 's1'), makeWs('w2', 's2'), makeWs('w3', 's3')]
    ws.activeWorkspaceId = 'w1'
    const ss = useSessionStore.getState()
    ss.sessions = [makeSession('s1'), makeSession('s2'), makeSession('s3')]

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => { root.render(<PaneTreeRoot />) })
    expect(container.querySelectorAll('[data-testid="pane-view"]')).toHaveLength(1)

    ws.activeWorkspaceId = 'w2'
    act(() => { root.render(<PaneTreeRoot />) })
    // w1 (visited) + w2 (active) mount; w3 (never visited) renders nothing.
    expect(container.querySelectorAll('[data-testid="pane-view"]')).toHaveLength(2)
  })
})
