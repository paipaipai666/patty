import { useEffect, useRef, type PointerEvent, type ReactElement } from 'react'
import { navigationAnchor, useOmpNavigationStore } from '../../store/ompNavigationStore'
import { useOmpHistoryMetricsStore } from '../../store/ompHistoryMetricsStore'
import styles from './Terminal.module.css'

const FALLBACK_THUMB_PERCENT = 12

function forwardWheelToTerminal(element: HTMLElement, event: WheelEvent): void {
  const terminal = element.parentElement?.querySelector<HTMLElement>('.xterm')
  terminal?.dispatchEvent(new WheelEvent('wheel', {
    deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
    clientX: event.clientX, clientY: event.clientY,
    ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey,
    bubbles: true, cancelable: true
  }))
}

export function OmpHistoryScrollbar({ sessionId }: { sessionId: string }): ReactElement | null {
  const state = useOmpNavigationStore(store => store.byPane[sessionId])
  const metrics = useOmpHistoryMetricsStore(store => store.byPane[sessionId])
  const track = useRef<HTMLDivElement>(null)
  const anchor = navigationAnchor(state)
  const turns = state?.turns
  useEffect(() => {
    const element = track.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return
      event.preventDefault()
      event.stopPropagation()
      forwardWheelToTerminal(element, event)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [anchor.mode, anchor.entryId])
  if (anchor.mode !== 'browsing' || !anchor.entryId || !turns?.length) return null
  const measured = metrics && metrics.total > 0 ? metrics : undefined
  const current = Math.max(0, turns.findIndex(turn => turn.entryId === anchor.entryId))
  const turnRatio = turns.length === 1 ? 1 : current / (turns.length - 1)
  const ratio = measured ? Math.min(1, Math.max(0, measured.before / measured.total)) : turnRatio
  const height = measured ? Math.min(25, Math.max(1.5, (measured.visible / measured.total) * 100)) : FALLBACK_THUMB_PERCENT
  const navigateAt = (clientY: number): void => {
    const element = track.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)))
    const index = Math.round(fraction * (turns.length - 1))
    const turn = turns[Math.max(0, Math.min(turns.length - 1, index))]
    if (turn) void useOmpNavigationStore.getState().navigate(sessionId, { kind: 'turn', entryId: turn.entryId })
  }
  const pointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    navigateAt(event.clientY)
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) navigateAt(event.clientY)
  }
  return <div ref={track} className={styles.historyScrollbar} data-omp-history-scrollbar
    data-scroll-source={measured ? 'content' : 'turns'}
    onPointerDown={pointerDown} onPointerMove={pointerMove}>
    <div className={styles.historyScrollbarThumb} style={{ top: `${4 + height / 2 + ratio * (92 - height)}%`, height: `${height}%` }} />
  </div>
}
