import { useRef, useCallback, useEffect, useState } from 'react'
import { useWorkspaceStore } from '../../store/workspaceStore'
import type { SplitDirection } from '../../../shared/paneTypes'
import { clampRatioToPixels } from '../../../shared/paneTypes'
import styles from './Sash.module.css'

interface SashProps {
  splitId: string
  ratio?: number
  direction: SplitDirection
}

export function Sash({ splitId, direction, ratio = 0.5 }: SashProps) {
  const setSplitRatio = useWorkspaceStore((s) => s.setSplitRatio)
  const parentRef = useRef<HTMLElement | null>(null)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const parent = e.currentTarget.parentElement
    if (!parent) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    parentRef.current = parent
    setDragging(true)
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const parent = parentRef.current
      if (!parent) return
      if (e.buttons === 0) {
        parentRef.current = null
        setDragging(false)
        return
      }
      const rect = parent.getBoundingClientRect()
      const size = direction === 'horizontal' ? rect.width : rect.height
      if (size <= 0) return
      const offset =
        direction === 'horizontal'
          ? e.clientX - rect.left
          : e.clientY - rect.top
      setSplitRatio(splitId, clampRatioToPixels(offset / size, size))
    },
    [direction, setSplitRatio, splitId]
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!parentRef.current) return
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    parentRef.current = null
    setDragging(false)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onUp = () => {
      parentRef.current = null
      setDragging(false)
    }
    window.addEventListener('pointerup', onUp)
    return () => window.removeEventListener('pointerup', onUp)
  }, [dragging])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const negative = direction === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
    const positive = direction === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
    if (![negative, positive, 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.parentElement?.getBoundingClientRect()
    const size =
      direction === 'horizontal' ? (rect?.width ?? 0) : (rect?.height ?? 0)
    const step = event.shiftKey ? 0.1 : 0.02
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 1
          : ratio + (event.key === positive ? step : -step)
    setSplitRatio(splitId, clampRatioToPixels(next, size))
  }

  const dirClass =
    direction === 'horizontal' ? styles.sashHorizontal : styles.sashVertical

  return (
    <div
      className={`${styles.sash} ${dirClass} ${dragging ? styles.sashDragging : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => {
        parentRef.current = null
        setDragging(false)
      }}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => setSplitRatio(splitId, 0.5)}
      tabIndex={0}
      role="separator"
      aria-label="Resize terminal panes"
      aria-valuemin={10}
      aria-valuemax={90}
      aria-valuenow={Math.round(ratio * 100)}
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
    />
  )
}
