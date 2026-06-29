import { useCallback } from 'react'
import type { TerminalSession } from '../../store/sessionStore'
import styles from './Pane.module.css'

interface PaneViewProps {
  session: TerminalSession
  focused: boolean
  onFocus: (paneId: string) => void
  paneId: string
  /** Pane body. During bring-up this is a placeholder; later the real TerminalPane. */
  children?: React.ReactNode
}

/**
 * A single pane: header (session title + color dot) + content area.
 *
 * Clicking anywhere focuses the pane. The header is a visual label only — no
 * tabs inside a pane (one session per pane by design). The content area is
 * filled by the caller; during layout bring-up it's a placeholder showing the
 * sessionId.
 */
export function PaneView({ session, focused, onFocus, paneId, children }: PaneViewProps) {
  const handleFocus = useCallback(() => onFocus(paneId), [onFocus, paneId])

  return (
    <div
      className={`${styles.paneView} ${focused ? styles.paneViewFocused : ''}`}
      onPointerDown={handleFocus}
    >
      <div className={styles.paneHeader}>
        <span className={styles.paneDot} style={{ background: dotColor(session.color) }} />
        <span className={styles.paneTitle}>{session.title}</span>
      </div>
      <div className={styles.paneContent}>
        {children ?? <div className={styles.panePlaceholder}>pane: {session.id.slice(0, 8)}</div>}
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
