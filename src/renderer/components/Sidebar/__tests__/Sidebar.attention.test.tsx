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
    sessions, agentStates: {}, agentRevisions: {}, agentRevisionFloor: 0, programStates: {}, programRevisionFloor: 0, activeSessionId: 'scratch', loaded: true,
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
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Notifications"]')
  if (!button) throw new Error('Missing notification button')
  return button
}

describe('session notifications', () => {
  function entries() { return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).filter(button => button.querySelector('strong')) }
  it('navigates to a program report through the existing bell and retains Hook priority', async () => {
    useSessionStore.getState().applyProgramBatch({ revision: 3, programs: [{ paneId: 'server', revision: 3, runId: '1', recordCount: 1, program: { id: '', revision: 1, state: 'blocked', kind: 'permission' } }] })
    const button = render()
    expect(button.getAttribute('aria-description')).toBe('1 new or waiting sessions')
    act(() => button.click())
    expect(entries()[0].textContent).toContain('Waiting for approval')
    await act(async () => entries()[0].click())
    expect(getFocusedSessionId()).toBe('server')
    expect(useSessionStore.getState().programStates.server?.activity?.unread).toBe(false)
    act(() => useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'server', agent: { aiType: 'codex', status: 'idle' } })))
    expect(button.getAttribute('aria-description')).toBe('0 new or waiting sessions')
  })
  it('keeps the default sidebar quiet and returns keyboard focus after dismissal', () => {
    const button = render()
    expect(button.getAttribute('aria-description')).toBe('0 new or waiting sessions')
    expect(container.querySelector('select')).toBeNull()
    act(() => { button.focus(); button.click() })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Nothing needs your attention.')
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close notifications"]')!
    expect(document.activeElement).toBe(close)
    act(() => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })))
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Notification view')
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('selects a hidden workspace and its exact pane without clearing a waiting state', async () => {
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'server', agent: { aiType: 'claude', status: 'waiting_approval' } }))
    const button = render()
    expect(button.getAttribute('aria-description')).toBe('1 new or waiting sessions')
    act(() => button.click())
    expect(entries().map(item => item.querySelector('strong')?.textContent)).toEqual(['server'])
    await act(async () => entries()[0].click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-api')
    expect(getFocusedSessionId()).toBe('server')
    expect(useSessionStore.getState().agentStates.server).toEqual({ status: 'waiting_approval', unread: false })
    expect(button.getAttribute('aria-description')).toBe('1 new or waiting sessions')
    act(() => button.click())
    expect(entries()[0].textContent).toContain('Waiting for approval')
  })

  it('updates open results and preserves an empty completed filter when tasks change', () => {
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'server', agent: { aiType: 'claude', status: 'waiting_input' } }))
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'review', agent: { aiType: 'codex', status: 'complete' } }))
    const button = render()
    act(() => button.click())
    expect(entries().map(item => item.querySelector('strong')?.textContent)).toEqual(['server', 'review'])
    act(() => useSessionStore.getState().setActive('review'))
    expect(entries().map(item => item.querySelector('strong')?.textContent)).toEqual(['server'])
    const filter = document.querySelector<HTMLSelectElement>('[aria-label="Notification view"]')!
    act(() => { filter.value = 'complete'; filter.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(entries().map(item => item.querySelector('strong')?.textContent)).toEqual(['review'])
    act(() => useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'review', agent: { aiType: 'codex', status: 'working' } })))
    expect(entries()).toHaveLength(0)
    expect(filter.value).toBe('complete')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('No completed sessions.')
    expect(getFocusedSessionId()).toBe('scratch')
  })

  it('dismisses on outside pointer interaction and removes a deleted target from an open list', () => {
    useSessionStore.getState().applyAgentUpdate(agentUpdate({ paneId: 'server', agent: { aiType: 'claude', status: 'error' } }))
    const button = render()
    act(() => button.click())
    expect(entries()).toHaveLength(1)
    act(() => useSessionStore.setState(state => ({ sessions: state.sessions.filter(item => item.id !== 'server') })))
    expect(entries()).toHaveLength(0)
    act(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
