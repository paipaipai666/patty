import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OmpHistoryScrollbar } from '../OmpHistoryScrollbar'
import { useOmpNavigationStore, type PaneNavigationState } from '../../../store/ompNavigationStore'

let root: ReturnType<typeof createRoot>
let container: HTMLDivElement

function state(entryId: string): PaneNavigationState {
  return {
    status: 'ready',
    snapshot: null,
    turns: [
      { entryId: 'entry-1', ordinal: 1, preview: 'first', createdAt: 1 },
      { entryId: 'entry-2', ordinal: 2, preview: 'second', createdAt: 2 },
      { entryId: 'entry-3', ordinal: 3, preview: 'third', createdAt: 3 },
    ],
    error: null,
    navigating: false,
    shownPosition: { mode: 'browsing', sessionId: 'session-1', branchEpoch: 1, displayEpoch: 1, viewRevision: 1, frameId: 'frame', entryId, anchor: { partId: `${entryId}:user`, scalarOffset: 0 } },
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useOmpNavigationStore.setState({ byPane: { 'session-1': state('entry-2') } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('OmpHistoryScrollbar', () => {
  it('shows a thumb while browsing and moves it with the current turn', () => {
    act(() => root.render(<OmpHistoryScrollbar sessionId="session-1" />))
    const bar = container.querySelector('[data-omp-history-scrollbar]')
    const thumb = bar?.querySelector('[class*="historyScrollbarThumb"]') as HTMLElement | null
    expect(bar).not.toBeNull()
    expect(thumb?.style.top).toBe('48%')
  })

  it('renders nothing while live', () => {
    useOmpNavigationStore.setState({
      byPane: {
        'session-1': {
          ...state('entry-2'),
          shownPosition: { mode: 'live', sessionId: 'session-1', branchEpoch: 1, displayEpoch: 1, viewRevision: 1, frameId: 'frame' },
        },
      },
    })
    act(() => root.render(<OmpHistoryScrollbar sessionId="session-1" />))
    expect(container.querySelector('[data-omp-history-scrollbar]')).toBeNull()
  })
})
