import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

const { sessionState, wsState } = vi.hoisted(() => ({
  sessionState: { sessions: [] as any[] },
  wsState: { workspaces: [] as any[], activeWorkspaceId: null as string | null }
}))

vi.mock('../../../store/sessionStore', () => {
  const useSessionStore = (sel: (s: typeof sessionState) => unknown) => sel(sessionState)
  useSessionStore.getState = () => sessionState
  return { useSessionStore }
})

vi.mock('../../../store/workspaceStore', () => {
  const useWorkspaceStore = (sel: (s: typeof wsState) => unknown) => sel(wsState)
  useWorkspaceStore.getState = () => wsState
  return { useWorkspaceStore }
})

vi.mock('../../Pane/PaneTree', () => ({
  PaneTreeRoot: () => <div data-testid="pane-tree-root" />
}))

import { TerminalArea } from '../TerminalArea'

beforeEach(() => {
  sessionState.sessions = []
  wsState.workspaces = []
  wsState.activeWorkspaceId = null
  document.body.innerHTML = ''
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<TerminalArea />) })
  return { container, root }
}

describe('TerminalArea', () => {
  it('shows empty state when sessions.length === 0', () => {
    const { container } = render()
    expect(container.querySelector('h2')?.textContent).toBe('Patty')
    expect(container.querySelector('p')?.textContent).toContain('Ctrl+T')
  })

  it('shows empty state when no active workspace pane tree exists', () => {
    sessionState.sessions = [{ id: 'sess-1' }]
    const { container } = render()
    expect(container.querySelector('h2')?.textContent).toBe('Patty')
  })

  it('renders PaneTreeRoot when sessions exist and active workspace has paneTree', () => {
    sessionState.sessions = [{ id: 'sess-1' }]
    wsState.workspaces = [{ id: 'ws-1', paneTree: { type: 'leaf', id: 'leaf-1', sessionId: 'sess-1' } }]
    wsState.activeWorkspaceId = 'ws-1'
    const { container } = render()
    expect(container.querySelector('[data-testid="pane-tree-root"]')).toBeTruthy()
  })
})
