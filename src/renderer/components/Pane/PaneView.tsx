import { useCallback } from 'react'
import type { TerminalSession } from '../../store/sessionStore'
import { TerminalPane } from '../Terminal/TerminalPane'
import styles from './Pane.module.css'

interface PaneViewProps {
  session: TerminalSession
  focused: boolean
  onFocus: (paneId: string) => void
  paneId: string
}

/**
 * A single pane: header (session title + color dot) + the real terminal.
 *
 * Clicking anywhere focuses the pane. The header is a visual label only — no
 * tabs inside a pane (one session per pane by design). The content area holds
 * a TerminalPane; typing/output in it bubbles up via onUsed so the pane claims
 * focus (replacing the old LRU markUsed semantics — under the split-tree model
 * only visible leaves mount a terminal, so LRU eviction of tree leaves is not
 * needed; focus-on-activity is the surviving behavior).
 */
export function PaneView({ session, focused, onFocus, paneId }: PaneViewProps) {
  const handleFocus = useCallback(() => onFocus(paneId), [onFocus, paneId])

  // TerminalPane reports keyboard/output activity; under the new model that
  // means "this pane is being used → it should hold focus".
  const handleUsed = useCallback(() => onFocus(paneId), [onFocus, paneId])

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
        <TerminalPane session={session} visible onUsed={handleUsed} />
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
