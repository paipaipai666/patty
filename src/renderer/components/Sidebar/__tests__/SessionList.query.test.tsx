import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore, type TerminalSession } from '../../../store/sessionStore'
import { useWorkspaceStore } from '../../../store/workspaceStore'
import { SessionList } from '../SessionList'

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

function render(searchQuery: string) {
  const onSelect = vi.fn()
  act(() => root.render(<SessionList searchQuery={searchQuery} onSelect={onSelect} onClose={vi.fn()} />))
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
})
