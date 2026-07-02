import styles from './DropTargetOverlay.module.css'

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center' | null

interface DropTargetOverlayProps {
  zone: DropZone
}

/**
 * Visual highlight showing where a sidebar session will land when dropped.
 *
 * Edge zones (left/right/top/bottom) → insert as a neighbor along that edge.
 * Center → replace this pane's session. Rendered absolutely inside PaneView's
 * content area; pointer-events disabled so it never interferes with the drag.
 */
export function DropTargetOverlay({ zone }: DropTargetOverlayProps) {
  if (!zone) return null
  return <div className={`${styles.dropOverlay} ${styles[`drop_${zone}`]}`} aria-hidden />
}
