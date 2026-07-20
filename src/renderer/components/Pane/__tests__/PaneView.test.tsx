import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { DropZone } from '../DropTargetOverlay'

vi.mock('../../../store/sessionStore', () => {
  const state = { draggingSessionId: null, setActive: vi.fn(), getState: () => state }
  const useSessionStore = (sel: (s: typeof state) => unknown) => sel(state)
  useSessionStore.getState = () => state
  return { useSessionStore }
})

vi.mock('../../../store/workspaceStore', () => {
  const state = { getState: () => state, replaceLeafAt: vi.fn(), insertNeighborAt: vi.fn() }
  const useWorkspaceStore = (sel: (s: typeof state) => unknown) => sel(state)
  useWorkspaceStore.getState = () => state
  return { useWorkspaceStore }
})

vi.mock('../../Terminal/TerminalPane', () => ({
  TerminalPane: ({ session }: any) => <div data-testid="terminal-pane">{session.id}</div>
}))

import { PaneView } from '../PaneView'
import { useSessionStore } from '../../../store/sessionStore'

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

function renderPaneView(overrides: Partial<Parameters<typeof PaneView>[0]> = {}) {
  const props = {
    session: { id: 's1', title: 'Terminal 1', color: 'blue', cwd: '', shell: 'powershell', pid: 0, createdAt: 1, collectionId: null, aiType: null },
    focused: false,
    onFocus: vi.fn(),
    paneId: 'p1',
    ...overrides
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<PaneView {...props} />) })
  return { container, root, props }
}

const EDGE_THRESHOLD = 0.35

function zoneFromPoint(x: number, y: number, rect: DOMRect): DropZone {
  const rx = (x - rect.left) / rect.width
  const ry = (y - rect.top) / rect.height
  const nearLeft = rx < EDGE_THRESHOLD
  const nearRight = rx > 1 - EDGE_THRESHOLD
  const nearTop = ry < EDGE_THRESHOLD
  const nearBottom = ry > 1 - EDGE_THRESHOLD
  const leftness = rx
  const rightness = 1 - rx
  const topness = ry
  const bottomness = 1 - ry
  const edges: Array<[DropZone, number]> = [
    ['left', leftness],
    ['right', rightness],
    ['top', topness],
    ['bottom', bottomness]
  ]
  const inEdgeBand = nearLeft || nearRight || nearTop || nearBottom
  if (!inEdgeBand) return 'center'
  const candidates = edges.filter(([, d]) => d < EDGE_THRESHOLD)
  candidates.sort((a, b) => a[1] - b[1])
  return candidates[0]?.[0] ?? 'center'
}

function rect(x: number, y: number, w: number, h: number): DOMRect {
  return DOMRect.fromRect({ x, y, width: w, height: h })
}

describe('zoneFromPoint', () => {
  it('returns left when near left edge', () => {
    const r = rect(0, 0, 400, 300)
    expect(zoneFromPoint(10, 150, r)).toBe('left')
    expect(zoneFromPoint(100, 150, r)).toBe('left')
  })

  it('returns right when near right edge', () => {
    const r = rect(0, 0, 400, 300)
    expect(zoneFromPoint(395, 150, r)).toBe('right')
    expect(zoneFromPoint(310, 150, r)).toBe('right')
  })

  it('returns center for middle region', () => {
    const r = rect(0, 0, 400, 300)
    expect(zoneFromPoint(200, 150, r)).toBe('center')
  })

  it('returns top when near top edge', () => {
    const r = rect(0, 0, 400, 300)
    expect(zoneFromPoint(200, 10, r)).toBe('top')
    expect(zoneFromPoint(200, 80, r)).toBe('top')
  })

  it('returns bottom when near bottom edge', () => {
    const r = rect(0, 0, 400, 300)
    expect(zoneFromPoint(200, 295, r)).toBe('bottom')
    expect(zoneFromPoint(200, 220, r)).toBe('bottom')
  })
})

describe('PaneView', () => {
  it('renders TerminalPane child', () => {
    const { container } = renderPaneView()
    const tp = container.querySelector('[data-testid="terminal-pane"]')
    expect(tp).not.toBeNull()
    expect(tp!.textContent).toBe('s1')
  })

  it('calls onFocus and setActive on pointer down', () => {
    const onFocus = vi.fn()
    const { container } = renderPaneView({ onFocus, paneId: 'p1' })
    const pane = container.querySelector('[data-testid="terminal-pane"]')!.parentElement!.parentElement!
    act(() => { pane.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
    expect(onFocus).toHaveBeenCalledWith('p1')
    expect(useSessionStore.getState().setActive).toHaveBeenCalledWith('s1')
  })
})
