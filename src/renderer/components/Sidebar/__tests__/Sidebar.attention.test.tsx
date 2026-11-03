import { agentUpdate } from '../../../../shared/__tests__/agentFixtures'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore, type TerminalSession } from '../../../store/sessionStore'
import { getFocusedSessionId, useWorkspaceStore } from '../../../store/workspaceStore'
import { selectSession } from '../../../store/sessionLifecycle'
import { Sidebar } from '../Sidebar'

vi.mock('../../ContributionGrid/ContributionGrid', () => ({ ContributionGrid: () => null }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const sessions: TerminalSession[] = ['server', 'review', 'sibling', 'scratch'].map((id) => ({
    id, title: id, color: 'blue', cwd: '', shell: 'cmd', pid: 0, createdAt: 1,
    collectionId: id === 'server' || id === 'sibling' ? 'api' : null
  }))
  useSessionStore.setState({
    sessions, agentStates: {}, agentRevisions: {}, agentRevisionFloor: 0, activeSessionId: 'scratch', loaded: true,
    collections: [{ id: 'api', name: 'API', parentId: null, collapsed: true, createdAt: 1 }]
  })
  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-scratch',
    workspaces: [
      {
        id: 'ws-api', name: 'API', collectionId: 'api', focusedPaneId: 'pane-sibling',
        paneTree: {
          id: 'split', type: 'split', direction: 'horizontal', ratio: 0.5,
          first: { id: 'pane-server', type: 'leaf', sessionId: 'server' },
          second: { id: 'pane-sibling', type: 'leaf', sessionId: 'sibling' }
        }
      },
      { id: 'ws-review', name: 'Review', collectionId: null, focusedPaneId: 'pane-review', paneTree: { id: 'pane-review', type: 'leaf', sessionId: 'review' } },
      { id: 'ws-scratch', name: 'Scratch', collectionId: null, focusedPaneId: 'pane-scratch', paneTree: { id: 'pane-scratch', type: 'leaf', sessionId: 'scratch' } }
    ]
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render() {
  act(() => root.render(<Sidebar
    onNewTerminal={vi.fn()}
    onNewTerminalPickFolder={vi.fn()}
    onNewSsh={vi.fn()}
    onCloseSession={vi.fn()}
    onSelectSession={selectSession}
  />))
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Next session needing attention"]')
  if (!button) throw new Error('Missing next attention button')
  return button
}

describe('next attention control', () => {
  it('disables navigation with no target and reacts to incoming and cleared states', () => {
    const button = render()
    expect(button.disabled).toBe(true)
    act(() => button.click())
    expect(useSessionStore.getState().activeSessionId).toBe('scratch')
    expect(getFocusedSessionId()).toBe('scratch')
    act(() => useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'server', agent: { aiType: 'claude', status: 'waiting_input' } })))
    expect(button.disabled).toBe(false)
    act(() => button.click())
    expect(getFocusedSessionId()).toBe('server')
    expect(useSessionStore.getState().agentStates.server).toEqual({ status: 'waiting_input', unread: false })
    act(() => useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'server', agent: { aiType: 'claude', status: 'working' } })))
    expect(button.disabled).toBe(true)
    act(() => button.click())
    expect(useSessionStore.getState().activeSessionId).toBe('server')
    expect(getFocusedSessionId()).toBe('server')
  })

  it('cycles across hidden and filtered sessions, focusing the target split and preserving runtime state', () => {
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'server', agent: { aiType: 'codex', status: 'waiting_approval' } }))
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'review', agent: { aiType: 'claude', status: 'error' } }))
    const button = render()
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Session view"]')!
    const input = container.querySelector<HTMLInputElement>('[aria-label="Search sessions"]')!
    act(() => {
      select.value = 'complete'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'scratch')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.querySelectorAll('[data-tree-id^="session:"]')).toHaveLength(0)
    act(() => button.click())
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-api')
    expect(useWorkspaceStore.getState().workspaces[0].focusedPaneId).toBe('pane-server')
    expect(getFocusedSessionId()).toBe('server')
    expect(useSessionStore.getState().activeSessionId).toBe('server')
    expect(useSessionStore.getState().agentStates.server).toEqual({ status: 'waiting_approval', unread: false })
    act(() => button.click())
    expect(getFocusedSessionId()).toBe('review')
    expect(useSessionStore.getState().agentStates.review).toEqual({ status: 'error', unread: false })
    act(() => button.click())
    expect(getFocusedSessionId()).toBe('server')
    expect(input.value).toBe('scratch')
    expect(select.value).toBe('complete')
    expect(useSessionStore.getState().collections[0].collapsed).toBe(true)
    expect(container.querySelector('option[value="attention"]')?.textContent).toBe('Needs you (2)')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(3)
  })
})
