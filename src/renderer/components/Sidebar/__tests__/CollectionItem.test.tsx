import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../../../store/sessionStore', () => {
  const state: any = {
    toggleCollectionCollapse: vi.fn(),
    renameCollection: vi.fn(),
    removeCollection: vi.fn(),
    moveSessionToCollection: vi.fn(),
    moveCollection: vi.fn(),
    getState: () => state
  }
  const useSessionStore = (sel: (s: typeof state) => unknown) => sel(state)
  useSessionStore.getState = () => state
  return { useSessionStore }
})

import { useSessionStore } from '../../../store/sessionStore'
import { CollectionItem } from '../CollectionItem'

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

const defaultCollection = {
  id: 'c1',
  name: 'My Collection',
  parentId: null,
  collapsed: false,
  createdAt: 1
}

function render(props: Partial<Parameters<typeof CollectionItem>[0]> = {}) {
  const allProps = {
    collection: defaultCollection,
    depth: 0,
    children: <div data-testid="child" />,
    ...props
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<CollectionItem {...allProps} />) })
  return { container, root, props: allProps }
}

describe('CollectionItem', () => {
  it('renders collection name', () => {
    const { container } = render()
    expect(container.textContent).toContain('My Collection')
  })

  it('double-click enters rename mode', () => {
    const { container } = render()
    const treeitem = container.querySelector('[role="treeitem"]')!
    act(() => { treeitem.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const input = container.querySelector('input')!
    expect(input).not.toBeNull()
    expect(input.value).toBe('My Collection')
  })

  it('rename submits on Enter', () => {
    const { container } = render()
    const treeitem = container.querySelector('[role="treeitem"]')!
    act(() => { treeitem.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const input = container.querySelector('input')!
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      nativeSetter.call(input, 'Renamed Collection')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(useSessionStore.getState().renameCollection).toHaveBeenCalledWith('c1', 'Renamed Collection')
  })

  it('rename cancels on Escape', () => {
    const { container } = render()
    const treeitem = container.querySelector('[role="treeitem"]')!
    act(() => { treeitem.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const input = container.querySelector('input')!
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(container.textContent).toContain('My Collection')
    expect(container.querySelector('input')).toBeNull()
  })

  it('drag over sets dragOver styling', () => {
    const { container } = render()
    const treeitem = container.querySelector('[role="treeitem"]')!
    const dt = { types: ['application/json'], dropEffect: '' }
    const event = new Event('dragover', { bubbles: true })
    Object.defineProperty(event, 'dataTransfer', { value: dt, writable: true })
    act(() => { treeitem.dispatchEvent(event) })
    expect(dt.dropEffect).toBe('move')
  })

  it('drop moves session to collection', () => {
    const { container } = render()
    const treeitem = container.querySelector('[role="treeitem"]')!
    const dt = {
      getData: vi.fn().mockReturnValue(JSON.stringify({ type: 'session', id: 's2' })),
      types: ['application/json']
    }
    const event = new Event('drop', { bubbles: true })
    Object.defineProperty(event, 'dataTransfer', { value: dt, writable: true })
    act(() => { treeitem.dispatchEvent(event) })
    expect(useSessionStore.getState().moveSessionToCollection).toHaveBeenCalledWith('s2', 'c1')
  })

  it('drop moves collection into another collection', () => {
    const { container } = render()
    const treeitem = container.querySelector('[role="treeitem"]')!
    const dt = {
      getData: vi.fn().mockReturnValue(JSON.stringify({ type: 'collection', id: 'c2' })),
      types: ['application/json']
    }
    const event = new Event('drop', { bubbles: true })
    Object.defineProperty(event, 'dataTransfer', { value: dt, writable: true })
    act(() => { treeitem.dispatchEvent(event) })
    expect(useSessionStore.getState().moveCollection).toHaveBeenCalledWith('c2', 'c1')
  })

  it('context menu handler called on right-click', () => {
    const onContextMenu = vi.fn()
    const { container } = render({ onContextMenu })
    const treeitem = container.querySelector('[role="treeitem"]')!
    act(() => { treeitem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    expect(onContextMenu).toHaveBeenCalled()
    expect(onContextMenu.mock.calls[0][1]).toBe('c1')
  })

  it('delete button calls removeCollection', () => {
    const { container } = render()
    const deleteBtn = container.querySelector('button[aria-label="Delete My Collection"]')
    expect(deleteBtn).not.toBeNull()
    act(() => { deleteBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(useSessionStore.getState().removeCollection).toHaveBeenCalledWith('c1')
  })

  it('renders children', () => {
    const { container } = render()
    const child = container.querySelector('[data-testid="child"]')
    expect(child).not.toBeNull()
  })
})
