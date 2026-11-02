import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore, type TerminalSession } from '../../../store/sessionStore'
import { useWorkspaceStore } from '../../../store/workspaceStore'
import { SessionList } from '../SessionList'
import { Sidebar } from '../Sidebar'
import type { SessionView } from '../sessionQuery'

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
    attentionMap: {}
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
    useSessionStore.getState().setAttention('server', 'permission')
    useSessionStore.getState().setAttention('review', 'complete')
    render('', 'attention')
    expect(resultIds()).toEqual(['session:server'])
    expect(container.querySelector('[data-tree-id="session:server"]')?.closest('[hidden]')).toBeNull()
    act(() => useSessionStore.getState().resetAttention('server'))
    expect(resultIds()).toEqual([])
    expect(container.textContent).toContain('No sessions need attention')
    render('', 'complete')
    expect(resultIds()).toEqual(['session:review'])
  })

  it('keeps filtering and text search active together', () => {
    useSessionStore.getState().setAttention('server', 'permission')
    useSessionStore.getState().setAttention('review', 'error')
    render('payments', 'attention')
    expect(resultIds()).toEqual(['session:server'])
    render('scratch', 'attention')
    expect(resultIds()).toEqual([])
    expect(container.textContent).toContain('No matches')
  })
})

describe('sidebar attention controls', () => {
  function renderSidebar() {
    act(() => root.render(<Sidebar
      onNewTerminal={vi.fn()}
      onNewTerminalPickFolder={vi.fn()}
      onNewSsh={vi.fn()}
      onCloseSession={vi.fn()}
      onSelectSession={vi.fn()}
    />))
  }

  it('counts attention and completed sessions independently and updates from live store events', () => {
    useSessionStore.getState().setAttention('server', 'permission')
    useSessionStore.getState().setAttention('review', 'error')
    useSessionStore.getState().setAttention('scratch', 'complete')
    renderSidebar()
    expect(Array.from(container.querySelectorAll('option')).map((option) => option.textContent)).toEqual([
      'All sessions (3)', 'Needs attention (2)', 'Completed (1)'
    ])
    act(() => useSessionStore.getState().resetAttention('server'))
    expect(container.querySelector('option[value="attention"]')?.textContent).toBe('Needs attention (1)')
  })

  it('combines the view picker with the search field without changing the active workspace', () => {
    useSessionStore.getState().setAttention('server', 'permission')
    useSessionStore.getState().setAttention('review', 'error')
    renderSidebar()
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Session view"]')!
    act(() => {
      select.value = 'attention'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(resultIds()).toEqual(['session:server', 'session:review'])
    const input = container.querySelector<HTMLInputElement>('[aria-label="Search sessions"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'payments')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(resultIds()).toEqual(['session:server'])
    act(() => useSessionStore.getState().resetAttention('server'))
    expect(resultIds()).toEqual([])
    expect(input.value).toBe('payments')
    expect(select.value).toBe('attention')
    expect(useSessionStore.getState().activeSessionId).toBe('scratch')
    expect(useSessionStore.getState().collections[0].collapsed).toBe(true)
  })
})
