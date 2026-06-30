import { useRef, useCallback, useEffect, useState } from 'react'
import { useWorkspaceStore } from '../../store/workspaceStore'
import type { SplitDirection } from '../../../shared/paneTypes'
import styles from './Pane.module.css'

interface SashProps {
  /** The split node this sash belongs to. Dragging updates its ratio. */
  splitId: string
  direction: SplitDirection
}

/**
 * Draggable divider between the two subtrees of a split.
 *
 * On pointerdown we capture the pointer. While dragging, the first subtree's
 * share = (pointer offset from the parent's near edge) / parentSize, clamped
 * by the store. The parent is the .split flex container that owns this sash.
 */
export function Sash({ splitId, direction }: SashProps) {
  const setSplitRatio = useWorkspaceStore((s) => s.setSplitRatio)
  const parentRef = useRef<HTMLElement | null>(null)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const parent = e.currentTarget.parentElement
      if (!parent) return
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      parentRef.current = parent
      setDragging(true)
    },
    []
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const parent = parentRef.current
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      const size = direction === 'horizontal' ? rect.width : rect.height
      if (size <= 0) return
      const offset = direction === 'horizontal' ? e.clientX - rect.left : e.clientY - rect.top
      setSplitRatio(splitId, offset / size)
    },
    [direction, setSplitRatio, splitId]
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!parentRef.current) return
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    parentRef.current = null
    setDragging(false)
  }, [])

  // Drop the drag if the pointer leaves the window mid-drag.
  useEffect(() => {
    if (!dragging) return
    const onUp = () => {
      parentRef.current = null
      setDragging(false)
    }
    window.addEventListener('pointerup', onUp)
    return () => window.removeEventListener('pointerup', onUp)
  }, [dragging])

  const dirClass = direction === 'horizontal' ? styles.sashHorizontal : styles.sashVertical

  return (
    <div
      className={`${styles.sash} ${dirClass} ${dragging ? styles.sashDragging : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      role="separator"
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
    />
  )
}
