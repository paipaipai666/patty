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
  PaneView: ({ session, paneId, visible }: { session?: TerminalSession; paneId: string; visible?: boolean }) => (
    <div data-testid="pane-view" data-session-id={session?.id} data-visible={visible}>{session?.id ?? paneId}</div>
  )
}))

vi.mock('../Sash', () => ({
  Sash: ({ splitId }: { splitId: string }) => <div role="separator" data-testid="sash" data-split-id={splitId} />
}))

import { PaneTreeRoot } from '../PaneTree'
import { useWorkspaceStore } from '../../../store/workspaceStore'
import { useSessionStore, type TerminalSession } from '../../../store/sessionStore'
import type { Workspace } from '../../../../shared/workspaceTypes'
import type { PaneTree } from '../../../../shared/paneTypes'

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

  function renderTree(tree: PaneTree) {
    const ws = useWorkspaceStore.getState()
    ws.workspaces = [{ ...makeWs('w1', 's1'), paneTree: tree }]
    ws.activeWorkspaceId = 'w1'
    useSessionStore.getState().sessions = [makeSession('s1'), makeSession('s2'), makeSession('s3')]
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const render = () => act(() => root.render(<PaneTreeRoot />))
    render()
    return { container, root, render, ws }
  }

  function rememberOutput(container: HTMLElement) {
    const pane = [...container.querySelectorAll('[data-testid="pane-view"]')]
      .find(element => element.textContent === 's1')
    if (!pane) throw new Error('Running terminal is missing')
    const output = document.createElement('span')
    output.textContent = 'running-output-42'
    pane.appendChild(output)
    return { pane, output }
  }

  it('retains the running terminal and output when adding a split', () => {
    const tree: PaneTree = { id: 'p1', type: 'leaf', sessionId: 's1' }
    const view = renderTree(tree)
    const { pane, output } = rememberOutput(view.container)
    view.ws.workspaces = [{
      ...makeWs('w1', 's1'),
      paneTree: {
        id: 'split', type: 'split', direction: 'horizontal', ratio: 0.5,
        first: tree, second: { id: 'p2', type: 'leaf', sessionId: 's2' }
      }
    }]
    view.render()
    expect(view.container.contains(pane)).toBe(true)
    expect(view.container.contains(output)).toBe(true)
    expect(pane.textContent).toBe('s1running-output-42')
    act(() => view.root.unmount())
  })

  it('retains the running terminal and output when closing its sibling', () => {
    const survivor: PaneTree = { id: 'p1', type: 'leaf', sessionId: 's1' }
    const view = renderTree({
      id: 'split', type: 'split', direction: 'horizontal', ratio: 0.5,
      first: survivor, second: { id: 'p2', type: 'leaf', sessionId: 's2' }
    })
    const { pane, output } = rememberOutput(view.container)
    view.ws.workspaces = [{ ...makeWs('w1', 's1'), paneTree: survivor }]
    view.render()
    expect(view.container.contains(pane)).toBe(true)
    expect(view.container.contains(output)).toBe(true)
    expect(view.container.querySelectorAll('[data-testid="pane-view"]')).toHaveLength(1)
    act(() => view.root.unmount())
  })

  it('retains the running terminal when a nested split collapses', () => {
    const survivor: PaneTree = { id: 'p1', type: 'leaf', sessionId: 's1' }
    const second: PaneTree = { id: 'p3', type: 'leaf', sessionId: 's3' }
    const view = renderTree({
      id: 'outer', type: 'split', direction: 'horizontal', ratio: 0.6,
      first: {
        id: 'inner', type: 'split', direction: 'vertical', ratio: 0.5,
        first: survivor, second: { id: 'p2', type: 'leaf', sessionId: 's2' }
      },
      second
    })
    const { pane, output } = rememberOutput(view.container)
    view.ws.workspaces = [{
      ...makeWs('w1', 's1'),
      paneTree: { id: 'outer', type: 'split', direction: 'horizontal', ratio: 0.6, first: survivor, second }
    }]
    view.render()
    expect(view.container.contains(pane)).toBe(true)
    expect(view.container.contains(output)).toBe(true)
    act(() => view.root.unmount())
  })

  it('retains the running terminal when moving to another workspace', () => {
    const view = renderTree({ id: 'p1', type: 'leaf', sessionId: 's1' })
    const { pane, output } = rememberOutput(view.container)
    view.ws.workspaces = [makeWs('w2', 's1')]
    view.ws.activeWorkspaceId = 'w2'
    view.render()
    expect(view.container.contains(pane)).toBe(true)
    expect(view.container.contains(output)).toBe(true)
    act(() => view.root.unmount())
  })

  it('retains a moved terminal hidden without starting other unvisited terminals', () => {
    const view = renderTree({ id: 'p1', type: 'leaf', sessionId: 's1' })
    const { pane, output } = rememberOutput(view.container)
    view.ws.workspaces = [makeWs('w1', 's2'), {
      ...makeWs('w2', 's1'),
      paneTree: {
        id: 'split', type: 'split', direction: 'vertical', ratio: 0.5,
        first: { id: 'p1', type: 'leaf', sessionId: 's1' },
        second: { id: 'p3', type: 'leaf', sessionId: 's3' }
      }
    }]
    view.render()
    expect(view.container.contains(pane)).toBe(true)
    expect(view.container.contains(output)).toBe(true)
    expect(pane.getAttribute('data-visible')).toBe('false')
    expect(view.container.querySelector('[data-session-id="s3"]')).toBeNull()
    expect(view.container.querySelectorAll('[data-testid="pane-view"]')).toHaveLength(2)
    act(() => view.root.unmount())
  })

  it('replaces the old terminal when the leaf selects another session', () => {
    const view = renderTree({ id: 'p1', type: 'leaf', sessionId: 's1' })
    const { pane, output } = rememberOutput(view.container)
    view.ws.workspaces = [{
      ...makeWs('w1', 's2'), paneTree: { id: 'p1', type: 'leaf', sessionId: 's2' }
    }]
    view.render()
    expect(view.container.contains(pane)).toBe(false)
    expect(view.container.contains(output)).toBe(false)
    expect(view.container.textContent).toBe('s2')
    act(() => view.root.unmount())
  })

  it('keeps each sash inside the full split bounds for pointer and keyboard resizing', () => {
    const view = renderTree({
      id: 'outer', type: 'split', direction: 'horizontal', ratio: 0.5,
      first: { id: 'p1', type: 'leaf', sessionId: 's1' },
      second: {
        id: 'inner', type: 'split', direction: 'vertical', ratio: 0.25,
        first: { id: 'p2', type: 'leaf', sessionId: 's2' },
        second: { id: 'p3', type: 'leaf', sessionId: 's3' }
      }
    })
    const frame = view.container.querySelector('[data-split-id="inner"]')?.parentElement
    expect(frame?.style.left).toBe('calc(50% + 6px)')
    expect(frame?.style.width).toBe('calc(50% - 6px)')
    expect(frame?.style.height).toBe('100%')
    expect(frame?.style.getPropertyValue('--sash-offset')).toBe('25%')
    act(() => view.root.unmount())
  })

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

    expect(container.querySelectorAll('[data-testid="pane-view"]')).toHaveLength(2)
  })
})
