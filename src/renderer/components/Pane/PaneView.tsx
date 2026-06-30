import { useCallback, useState, useRef } from 'react'
import type { TerminalSession } from '../../store/sessionStore'
import { usePaneStore } from '../../store/paneStore'
import { TerminalPane } from '../Terminal/TerminalPane'
import { DropTargetOverlay, type DropZone } from './DropTargetOverlay'
import styles from './Pane.module.css'

interface PaneViewProps {
  session: TerminalSession
  focused: boolean
  onFocus: (paneId: string) => void
  paneId: string
  /** False when this pane belongs to a non-active workspace (display:none).
   *  TerminalPane uses this to release the WebGL context while hidden. */
  visible?: boolean
}

/** Edge threshold: within this fraction of a pane's half-size, the drop lands
 *  on that edge instead of center. 0.5 would make edges dominate; ~0.35 keeps
 *  a comfortable center target. */
const EDGE_THRESHOLD = 0.35

/** Decide which drop zone the pointer is in, relative to the pane rect. */
function zoneFromPoint(x: number, y: number, rect: DOMRect): DropZone {
  const rx = (x - rect.left) / rect.width
  const ry = (y - rect.top) / rect.height
  // Distance from each edge in [0,1]; < EDGE_THRESHOLD means "near that edge".
  const nearLeft = rx < EDGE_THRESHOLD
  const nearRight = rx > 1 - EDGE_THRESHOLD
  const nearTop = ry < EDGE_THRESHOLD
  const nearBottom = ry > 1 - EDGE_THRESHOLD
  // Pick the single nearest edge if any; otherwise center. Avoid ambiguous
  // corner zones by comparing horizontal vs vertical edge proximity.
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
  // Among edges the pointer is close to, choose the closest.
  const candidates = edges.filter(([, d]) => d < EDGE_THRESHOLD)
  candidates.sort((a, b) => a[1] - b[1])
  return candidates[0]?.[0] ?? 'center'
}

/**
 * A single pane: header (session title + color dot) + the real terminal.
 *
 * Accepts sidebar drag-in: dropping a session on an edge inserts it as a
 * neighbor (split); dropping on the center replaces this pane's session. The
 * drop overlay highlights the target zone during dragover.
 */
export function PaneView({ session, focused, onFocus, paneId, visible = true }: PaneViewProps) {
  const [dropZone, setDropZone] = useState<DropZone>(null)
  const dropZoneRef = useRef<DropZone>(null)

  const handleFocus = useCallback(() => onFocus(paneId), [onFocus, paneId])
  const handleUsed = useCallback(() => onFocus(paneId), [onFocus, paneId])

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only accept drags carrying a sidebar session payload.
    if (!e.dataTransfer.types.includes('application/json')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const zone = zoneFromPoint(e.clientX, e.clientY, rect)
    dropZoneRef.current = zone
    setDropZone(zone)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only clear when leaving the pane entirely (not when crossing child
    // elements). relatedTarget is null or outside the pane on a real leave.
    const rt = e.relatedTarget as Node | null
    if (rt && e.currentTarget.contains(rt)) return
    dropZoneRef.current = null
    setDropZone(null)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const zone = dropZoneRef.current
      dropZoneRef.current = null
      setDropZone(null)
      if (!zone) return
      try {
        const payload = JSON.parse(e.dataTransfer.getData('application/json'))
        if (payload?.type !== 'session' || typeof payload.id !== 'string') return
        const sessionId = payload.id
        const store = usePaneStore.getState()
        if (zone === 'center') {
          store.replaceLeafAt(paneId, sessionId)
        } else {
          const direction = zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical'
          const side = zone === 'left' || zone === 'top' ? 'first' : 'second'
          store.insertNeighborAt(paneId, sessionId, direction, side)
        }
        // Focus the pane that received the drop (or its new neighbor).
        onFocus(paneId)
      } catch {
        // Malformed drag payload — ignore.
      }
    },
    [onFocus, paneId]
  )

  return (
    <div
      className={`${styles.paneView} ${focused ? styles.paneViewFocused : ''}`}
      onPointerDown={handleFocus}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={styles.paneHeader}>
        <span className={styles.paneDot} style={{ background: dotColor(session.color) }} />
        <span className={styles.paneTitle}>{session.title}</span>
      </div>
      <div className={styles.paneContent}>
        <TerminalPane session={session} visible={visible} onUsed={handleUsed} />
        <DropTargetOverlay zone={dropZone} />
      </div>
    </div>
  )
}

/** Map a session color to the CSS var used by SessionItem's COLOR_MAP. */
function dotColor(color: TerminalSession['color']): string {
  const map: Record<TerminalSession['color'], string> = {
    blue: 'var(--color-blue)',
    green: 'var(--color-green)',
    amber: 'var(--color-amber)',
    coral: 'var(--color-coral)',
    purple: 'var(--color-purple)',
    gray: 'var(--color-gray)'
  }
  return map[color] ?? 'var(--color-blue)'
}
