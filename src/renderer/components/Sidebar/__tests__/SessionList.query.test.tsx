import { agentUpdate } from '../../../../shared/__tests__/agentFixtures'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore, type TerminalSession } from '../../../store/sessionStore'
import { useWorkspaceStore } from '../../../store/workspaceStore'
import { SessionList } from '../SessionList'
import type { SessionView } from '../sessionQuery'

vi.mock('../../ContributionGrid/ContributionGrid', () => ({ ContributionGrid: () => null }))

let container: HTMLDivElement
let root: Root

function session(id: string, values: Partial<TerminalSession> = {}): TerminalSession {
  return { id, title: id, color: 'blue', cwd: '', shell: 'cmd', pid: 0, createdAt: 1, collectionId: null, ...values }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useSessionStore.setState({
    loaded: true,
    sessions: [
      session('server', { title: 'Server', cwd: 'D:\\work\\payments', collectionId: 'api' }),
      session('review', { title: 'Review', cwd: 'D:\\work\\web' }),
      session('scratch', { title: 'Scratch' })
    ],
    collections: [
      { id: 'work', name: 'Work', parentId: null, collapsed: true, createdAt: 1 },
      { id: 'api', name: 'Payments API', parentId: 'work', collapsed: true, createdAt: 2 }
    ],
    activeSessionId: 'scratch',
    agentStates: {}, agentRevisions: {}, agentRevisionFloor: 0
  })
  useWorkspaceStore.setState({ workspaces: [] })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(searchQuery: string, sessionView: SessionView = 'all') {
  const onSelect = vi.fn()
  act(() => root.render(<SessionList searchQuery={searchQuery} sessionView={sessionView} onSelect={onSelect} onClose={vi.fn()} />))
  return onSelect
}

function resultIds(): Array<string | undefined> {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-tree-id^="session:"]')).map((item) => item.dataset.treeId)
}

describe('session search results', () => {
  it('reading a question stops its glow while preserving its label and attention view', () => {
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'server', agent: { aiType: 'claude', status: 'waiting_input' } }))
    render('', 'attention')
    expect(resultIds()).toEqual(['session:server'])
    expect(container.querySelector('[aria-label="Waiting for answer"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="agent-attention-glow"]')).not.toBeNull()
    act(() => useSessionStore.getState().setActive('server'))
    expect(resultIds()).toEqual(['session:server'])
    expect(container.querySelector('[aria-label="Waiting for answer"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="agent-attention-glow"]')).toBeNull()
    expect(container.querySelector('[data-tree-id="session:server"]')?.getAttribute('aria-description')).toContain('Waiting for answer')
    act(() => useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'server', agent: { aiType: 'claude', status: 'working' } })))
    expect(resultIds()).toEqual([])
    render('server')
    expect(container.textContent).toContain('Working')
  })

  it('reveals a result inside a collapsed parent and selects it from the keyboard', () => {
    const onSelect = render('Work Payments Server')
    expect(resultIds()).toEqual(['session:server'])
    const row = container.querySelector<HTMLElement>('[data-tree-id="session:server"]')!
    expect(row.closest('[hidden]')).toBeNull()
    expect(row.tabIndex).toBe(0)
    act(() => {
      row.focus()
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledWith('server')
  })

  it('updates results when the project query changes and shows a useful empty state', () => {
    render('d:/work')
    expect(resultIds()).toEqual(['session:server', 'session:review'])
    render('missing project')
    expect(resultIds()).toEqual([])
    expect(container.textContent).toContain('No matches')
    expect(container.textContent).toContain('Try a different search')
  })

  it('shows attention inside collapsed collections and updates when an event clears', () => {
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'server', agent: { aiType: 'claude', status: 'waiting_approval' } }))
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'review', agent: { aiType: 'claude', status: 'complete' } }))
    render('', 'attention')
    expect(resultIds()).toEqual(['session:server'])
    expect(container.querySelector('[data-tree-id="session:server"]')?.closest('[hidden]')).toBeNull()
    act(() => useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'server', agent: null })))
    expect(resultIds()).toEqual([])
    expect(container.textContent).toContain('No sessions need attention')
    render('', 'complete')
    expect(resultIds()).toEqual(['session:review'])
  })

  it('keeps filtering and text search active together', () => {
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'server', agent: { aiType: 'claude', status: 'waiting_approval' } }))
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'review', agent: { aiType: 'claude', status: 'error' } }))
    render('payments', 'attention')
    expect(resultIds()).toEqual(['session:server'])
    render('scratch', 'attention')
    expect(resultIds()).toEqual([])
    expect(container.textContent).toContain('No matches')
  })
})

