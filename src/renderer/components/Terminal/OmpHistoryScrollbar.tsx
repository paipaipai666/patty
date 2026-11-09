import { useRef, type PointerEvent, type ReactElement } from 'react'
import { navigationAnchor, useOmpNavigationStore } from '../../store/ompNavigationStore'
import styles from './Terminal.module.css'

export function OmpHistoryScrollbar({ sessionId }: { sessionId: string }): ReactElement | null {
  const state = useOmpNavigationStore(store => store.byPane[sessionId])
  const track = useRef<HTMLDivElement>(null)
  const anchor = navigationAnchor(state)
  const turns = state?.turns
  if (anchor.mode !== 'browsing' || !anchor.entryId || !turns?.length) return null
  const current = Math.max(0, turns.findIndex(turn => turn.entryId === anchor.entryId))
  const ratio = turns.length === 1 ? 1 : current / (turns.length - 1)
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
    onPointerDown={pointerDown} onPointerMove={pointerMove}>
    <div className={styles.historyScrollbarThumb} style={{ top: `${4 + ratio * 88}%` }} />
  </div>
}
