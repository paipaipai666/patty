import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OmpHistoryScrollbar } from '../OmpHistoryScrollbar'
import { useOmpNavigationStore, type PaneNavigationState } from '../../../store/ompNavigationStore'
import { useOmpHistoryMetricsStore } from '../../../store/ompHistoryMetricsStore'

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
    pendingTarget: null,
    shownPosition: { mode: 'browsing', sessionId: 'session-1', branchEpoch: 1, displayEpoch: 1, viewRevision: 1, frameId: 'frame', entryId, anchor: { partId: `${entryId}:user`, scalarOffset: 0 } },
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useOmpNavigationStore.setState({ byPane: { 'session-1': state('entry-2') } })
  useOmpHistoryMetricsStore.setState({ byPane: {} })
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
    expect(bar?.getAttribute('data-scroll-source')).toBe('turns')
    expect(thumb?.style.top).toBe('50%')
    expect(thumb?.style.height).toBe('12%')
  })

  it('measures the thumb against the whole transcript instead of the turn index', () => {
    useOmpHistoryMetricsStore.getState().record('session-1', { sessionId: 'omp-session', branchEpoch: 1, frameId: 'frame-metrics', entryId: 'entry-2', before: 750, total: 1000, visible: 100 })
    act(() => root.render(<OmpHistoryScrollbar sessionId="session-1" />))
    const bar = container.querySelector('[data-omp-history-scrollbar]')
    const thumb = bar?.querySelector('[class*="historyScrollbarThumb"]') as HTMLElement | null
    expect(bar?.getAttribute('data-scroll-source')).toBe('content')
    expect(thumb?.style.height).toBe('10%')
    expect(thumb?.style.top).toBe('70.5%')
  })

  it('keeps the thumb grabbable in a transcript far larger than one screen', () => {
    useOmpHistoryMetricsStore.getState().record('session-1', { sessionId: 'omp-session', branchEpoch: 1, frameId: 'frame-huge', entryId: 'entry-2', before: 470000, total: 470000, visible: 6000 })
    act(() => root.render(<OmpHistoryScrollbar sessionId="session-1" />))
    const thumb = container.querySelector('[data-omp-history-scrollbar] [class*="historyScrollbarThumb"]') as HTMLElement | null
    expect(thumb?.style.height).toBe('1.5%')
    expect(thumb?.style.top).toBe('95.25%')
  })

  it('follows the pending target while the terminal frame is still being confirmed', () => {
    const target = {
      mode: 'browsing' as const, sessionId: 'session-1', branchEpoch: 1, displayEpoch: 1, viewRevision: 2, frameId: 'target-frame',
      entryId: 'entry-3', anchor: { partId: 'entry-3:user', scalarOffset: 0 }
    }
    useOmpNavigationStore.setState({
      byPane: {
        'session-1': {
          ...state('entry-1'),
          snapshot: {
            kind: 'ready', paneId: 'session-1', runId: 'run', instanceId: 'instance', sessionId: 'session-1', revision: 2,
            scope: { scopeId: 'scope', controlEpoch: 1 }, branchEpoch: 1, displayEpoch: 1, catalogRevision: 1,
            position: target, latestRequest: { requestId: 'request', status: { kind: 'applied', position: target, shown: false }, observationTimedOut: false },
            catalogSnapshotId: 'catalog', turnCount: 3, pageSize: 256
          }
        }
      }
    })
    act(() => root.render(<OmpHistoryScrollbar sessionId="session-1" />))
    const thumb = container.querySelector('[data-omp-history-scrollbar] [class*="historyScrollbarThumb"]') as HTMLElement | null
    expect(thumb?.style.top).toBe('90%')
  })

  it('moves the thumb to a freshly selected turn before the frame is confirmed', () => {
    useOmpNavigationStore.setState({ byPane: { 'session-1': { ...state('entry-1'), pendingTarget: { kind: 'turn', entryId: 'entry-3' }, navigating: true } } })
    act(() => root.render(<OmpHistoryScrollbar sessionId="session-1" />))
    const thumb = container.querySelector('[data-omp-history-scrollbar] [class*="historyScrollbarThumb"]') as HTMLElement | null
    expect(thumb?.style.top).toBe('90%')
  })

  it('passes wheel input to the terminal instead of swallowing it', () => {
    const pane = document.createElement('div')
    document.body.appendChild(pane)
    const root2 = createRoot(pane)
    act(() => root2.render(<><div className="xterm" /><OmpHistoryScrollbar sessionId="session-1" /></>))
    const xterm = pane.querySelector('.xterm') as HTMLElement
    const received: WheelEvent[] = []
    xterm.addEventListener('wheel', event => received.push(event as WheelEvent))
    const bar = pane.querySelector('[data-omp-history-scrollbar]') as HTMLElement
    const event = new WheelEvent('wheel', { deltaY: 240, bubbles: true, cancelable: true })
    act(() => { bar.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(received).toHaveLength(1)
    expect(received[0].deltaY).toBe(240)
    act(() => root2.unmount())
    pane.remove()
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
