import styles from './DropTargetOverlay.module.css'

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center' | null

interface DropTargetOverlayProps {
  zone: DropZone
}


   
export function DropTargetOverlay({ zone }: DropTargetOverlayProps) {
  if (!zone) return null
  return <div className={`${styles.dropOverlay} ${styles[`drop_${zone}`]}`} aria-hidden />
}
