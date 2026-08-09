import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

import { ContextMenu, type MenuItem } from '../ContextMenu'

function render(props: { show: boolean; x?: number; y?: number; items?: MenuItem[]; onClose?: () => void }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <ContextMenu
        show={props.show}
        x={props.x ?? 0}
        y={props.y ?? 0}
        items={props.items ?? []}
        onClose={props.onClose ?? vi.fn()}
      />
    )
  })
  return { container, root }
}

describe('ContextMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('renders null when show=false', () => {
    const { container } = render({ show: false })
    expect(container.innerHTML).toBe('')
  })

  it('renders menu items when show=true', () => {
    const items: MenuItem[] = [
      { label: 'Open', action: vi.fn() },
      { label: 'Delete', action: vi.fn() }
    ]
    const { container } = render({ show: true, items })
    expect(container.querySelector('button[role="menuitem"]')).not.toBeNull()
    const buttons = container.querySelectorAll('button[role="menuitem"]')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent).toBe('Open')
    expect(buttons[1].textContent).toBe('Delete')
  })

  it('clicking a menu item calls action and closes menu', () => {
    const onClose = vi.fn()
    const action = vi.fn()
    const items: MenuItem[] = [{ label: 'DoThing', action }]
    const { container } = render({ show: true, items, onClose })
    const btn = container.querySelector('button[role="menuitem"]')!
    act(() => { btn.click() })
    expect(action).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape key closes menu', () => {
    const onClose = vi.fn()
    render({ show: true, onClose, items: [{ label: 'X', action: vi.fn() }] })
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('outside click closes menu', () => {
    const onClose = vi.fn()
    render({ show: true, onClose, items: [{ label: 'X', action: vi.fn() }] })
    act(() => { document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('cached items are shown during exit animation', () => {
    const items: MenuItem[] = [{ label: 'CachedItem', action: vi.fn() }]
    const { container, root } = render({ show: true, items })
    expect(container.querySelector('button[role="menuitem"]')).not.toBeNull()

    act(() => {
      root.render(
        <ContextMenu show={false} x={0} y={0} items={[]} onClose={vi.fn()} />
      )
    })
    expect(container.querySelector('button[role="menuitem"]')).not.toBeNull()
    expect(container.querySelector('button[role="menuitem"]')!.textContent).toBe('CachedItem')

    act(() => { vi.advanceTimersByTime(120) })
    expect(container.innerHTML).toBe('')
  })
})
