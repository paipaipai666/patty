import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../../../store/sessionStore', () => {
  const state: any = {
    sessions: [],
    collections: [],
    activeSessionId: null,
    loaded: true,
    attentionMap: {},
    draggingSessionId: null,
    getState: () => state
  }
  const useSessionStore = (sel: (s: typeof state) => unknown) => sel(state)
  useSessionStore.getState = () => state
  return { useSessionStore, SESSION_COLOR_VARS: {} }
})

vi.mock('../../../store/workspaceStore', () => {
  const state: any = {
    workspaces: [],
    getState: () => state
  }
  const useWorkspaceStore = (sel: (s: typeof state) => unknown) => sel(state)
  useWorkspaceStore.getState = () => state
  return { useWorkspaceStore }
})

import { SessionList } from '../SessionList'
import { useSessionStore } from '../../../store/sessionStore'
import { useWorkspaceStore } from '../../../store/workspaceStore'

beforeEach(() => {
  vi.clearAllMocks()
  const ss = useSessionStore.getState()
  ss.sessions = []
  ss.collections = []
  ss.activeSessionId = null
  ss.loaded = true
  useWorkspaceStore.getState().workspaces = []
  document.body.innerHTML = ''
})

const mkSession = (id: string, title: string, overrides: any = {}) => ({
  id,
  title,
  color: 'blue' as const,
  cwd: '',
  shell: 'powershell' as const,
  pid: 0,
  createdAt: 1,
  collectionId: null,
  aiType: null,
  ...overrides
})

function render(props: Partial<Parameters<typeof SessionList>[0]> = {}) {
  const allProps = {
    onClose: vi.fn(),
    onSelect: vi.fn(),
    ...props
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<SessionList {...allProps} />) })
  return { container, root, props: allProps }
}

describe('SessionList', () => {
  it('renders nothing when loaded is false', () => {
    useSessionStore.getState().loaded = false
    const { container } = render()
    expect(container.innerHTML).toBe('')
  })

  it('shows empty state when no sessions', () => {
    const { container } = render()
    expect(container.textContent).toContain('No terminals')
  })

  it('shows SessionItems for each session', () => {
    useSessionStore.getState().sessions = [mkSession('s1', 'T1'), mkSession('s2', 'T2')]
    const { container } = render()
    expect(container.textContent).toContain('T1')
    expect(container.textContent).toContain('T2')
  })

  it('filters sessions by search query', () => {
    useSessionStore.getState().sessions = [mkSession('s1', 'Alpha'), mkSession('s2', 'Beta')]
    const { container } = render({ searchQuery: 'Beta' })
    expect(container.textContent).toContain('Beta')
    expect(container.textContent).not.toContain('Alpha')
  })

  it('shows no matches when search has no results', () => {
    useSessionStore.getState().sessions = [mkSession('s1', 'Alpha')]
    const { container } = render({ searchQuery: 'Zeta' })
    expect(container.textContent).toContain('No matches')
  })

  it('groups sessions by workspace when workspaces exist', () => {
    useWorkspaceStore.getState().workspaces = [{
      id: 'ws1',
      name: 'WS1',
      collectionId: null,
      paneTree: {
        id: 'split',
        type: 'split',
        direction: 'horizontal',
        first: { id: 'p1', type: 'leaf' as const, sessionId: 's1' },
        second: { id: 'p2', type: 'leaf' as const, sessionId: 's2' }
      },
      focusedPaneId: 'p1'
    }]
    useSessionStore.getState().sessions = [mkSession('s1', 'T1'), mkSession('s2', 'T2')]
    const { container } = render()
    expect(container.textContent).toContain('T1')
    expect(container.textContent).toContain('T2')
    expect(container.textContent).toContain('WS1')
  })

  it('shows background sessions not in any tree', () => {
    useWorkspaceStore.getState().workspaces = [{
      id: 'ws1',
      name: 'WS1',
      collectionId: null,
      paneTree: { id: 'p1', type: 'leaf' as const, sessionId: 's1' },
      focusedPaneId: 'p1'
    }]
    useSessionStore.getState().sessions = [
      mkSession('s1', 'InTree'),
      mkSession('s2', 'Background')
    ]
    const { container } = render()
    expect(container.textContent).toContain('InTree')
    expect(container.textContent).toContain('Background')
  })

  it('renders sessions in collections', () => {
    useSessionStore.getState().collections = [
      { id: 'col1', name: 'Group', parentId: null, collapsed: false, createdAt: 1 }
    ]
    useSessionStore.getState().sessions = [
      mkSession('s1', 'Nested', { collectionId: 'col1' })
    ]
    const { container } = render()
    expect(container.textContent).toContain('Group')
    expect(container.textContent).toContain('Nested')
  })
})
