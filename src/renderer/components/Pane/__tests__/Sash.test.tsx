import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../../../store/workspaceStore', () => {
  const state = { setSplitRatio: vi.fn(), getState: () => state }
  const useWorkspaceStore = (sel: (s: typeof state) => unknown) => sel(state)
  useWorkspaceStore.getState = () => state
  return { useWorkspaceStore }
})

import { useWorkspaceStore } from '../../../store/workspaceStore'
import { Sash } from '../Sash'

let setPointerCapture: any
let releasePointerCapture: any

beforeEach(() => {
  vi.useFakeTimers()
  useWorkspaceStore.getState().setSplitRatio.mockClear()
  setPointerCapture = vi.fn()
  releasePointerCapture = vi.fn()
  Element.prototype.setPointerCapture = setPointerCapture
  Element.prototype.releasePointerCapture = releasePointerCapture
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
})

function renderSash(direction: 'horizontal' | 'vertical' = 'horizontal') {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <div style={{ width: 500, height: 400, position: 'relative' }}>
        <Sash splitId="s1" direction={direction} />
      </div>
    )
  })
  return { container, root }
}

describe('Sash', () => {
  it('renders a sash div with role separator', () => {
    const { container } = renderSash()
    const sash = container.querySelector('[role="separator"]')
    expect(sash).not.toBeNull()
  })

  it('sets aria-orientation to vertical for horizontal direction', () => {
    const { container } = renderSash('horizontal')
    const sash = container.querySelector('[role="separator"]')
    expect(sash!.getAttribute('aria-orientation')).toBe('vertical')
  })

  it('sets aria-orientation to horizontal for vertical direction', () => {
    const { container } = renderSash('vertical')
    const sash = container.querySelector('[role="separator"]')
    expect(sash!.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('sets dragging state on pointer down', () => {
    const { container } = renderSash()
    const sash = container.querySelector('[role="separator"]')!
    act(() => {
      sash.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    })
    expect(setPointerCapture).toHaveBeenCalledWith(1)
  })

  it('adds dragging class on pointer down', () => {
    const { container } = renderSash()
    const sash = container.querySelector('[role="separator"]')!
    expect(sash!.className).not.toContain('sashDragging')
    act(() => {
      sash.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    })
    expect(sash!.className).toContain('sashDragging')
  })

  it('sets split ratio on pointer move during drag', () => {
    const setSplitRatio = useWorkspaceStore.getState().setSplitRatio

    const { container } = renderSash('horizontal')
    const sash = container.querySelector('[role="separator"]')!
    const parent = sash.parentElement!
    // jsdom elements have no layout; force getBoundingClientRect on the
    // parent so the ratio calculation yields 250/500 = 0.5.
    parent.getBoundingClientRect = () => new DOMRect(0, 0, 500, 400)

    act(() => {
      sash.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    })
    act(() => {
      sash.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        clientX: 250,
        clientY: 0
      }))
    })
    expect(setSplitRatio).toHaveBeenCalledWith('s1', 0.5)
  })

  it('releases pointer capture and clears dragging on pointer up', () => {
    const { container } = renderSash()
    const sash = container.querySelector('[role="separator"]')!

    act(() => {
      sash.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    })
    act(() => {
      sash.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
    })
    expect(releasePointerCapture).toHaveBeenCalledWith(1)
  })

  it('computes vertical split ratio on pointer move', () => {
    const setSplitRatio = useWorkspaceStore.getState().setSplitRatio
    const { container } = renderSash('vertical')
    const sash = container.querySelector('[role="separator"]')!
    const parent = sash.parentElement!
    parent.getBoundingClientRect = () => new DOMRect(0, 0, 500, 400)

    act(() => {
      sash.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    })
    act(() => {
      sash.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        clientX: 0,
        clientY: 200
      }))
    })
    expect(setSplitRatio).toHaveBeenCalledWith('s1', 0.5)
  })
})
