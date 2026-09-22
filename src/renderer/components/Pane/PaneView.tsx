import { useCallback, useState, useRef } from 'react'
import { useSessionStore, type TerminalSession } from '../../store/sessionStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { TerminalPane } from '../Terminal/TerminalPane'
import { DropTargetOverlay, type DropZone } from './DropTargetOverlay'
import styles from './PaneView.module.css'

interface PaneViewProps {
  session: TerminalSession
  focused: boolean
  onFocus: (paneId: string) => void
  paneId: string

                                                                          
  visible?: boolean
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


   
export function PaneView({ session, focused, onFocus, paneId, visible = true }: PaneViewProps) {
  const [dropZone, setDropZone] = useState<DropZone>(null)
  const dropZoneRef = useRef<DropZone>(null)

  const draggingSessionId = useSessionStore((s) => s.draggingSessionId)
  const showDropHint = !!draggingSessionId && draggingSessionId !== session.id && !dropZone

  const handleFocus = useCallback(() => {
    onFocus(paneId)

    useSessionStore.getState().setActive(session.id)
  }, [onFocus, paneId, session.id])

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {

    if (!e.dataTransfer.types.includes('application/json')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const zone = zoneFromPoint(e.clientX, e.clientY, rect)
    dropZoneRef.current = zone
    setDropZone(zone)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {

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
        const store = useWorkspaceStore.getState()
        if (zone === 'center') {
          store.replaceLeafAt(paneId, sessionId)
        } else {
          const direction = zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical'
          const side = zone === 'left' || zone === 'top' ? 'first' : 'second'
          store.insertNeighborAt(paneId, sessionId, direction, side)
        }

        onFocus(paneId)
      } catch {

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
      <div className={styles.paneContent}>
        <TerminalPane session={session} visible={visible} onUsed={handleFocus} />
        {showDropHint && <div className={styles.dropHint} aria-hidden />}
        <DropTargetOverlay zone={dropZone} />
      </div>
    </div>
  )
}


