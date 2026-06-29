import { useSessionStore } from '../../store/sessionStore'
import { PaneTreeRoot } from '../Pane/PaneTree'
import styles from './Terminal.module.css'

/**
 * Terminal area: renders the pane split tree.
 *
 * This commit wires the pane tree into the layout but renders each pane body
 * as a placeholder (PaneView's default). The real TerminalPane + fit-on-visible
 * logic arrives in the next commit. The legacy single-tab/LRU machinery is
 * set aside here and re-introduced (scoped to tree leaves) in the TerminalArea
 * refactor commit.
 */
export function TerminalArea() {
  const sessions = useSessionStore((s) => s.sessions)

  if (sessions.length === 0) {
    return (
      <div className={styles.emptyArea}>
        <div className={styles.emptyContent}>
          <div className={styles.emptyLogo}>⌨</div>
          <h2 className={styles.emptyTitle}>Patty</h2>
          <p className={styles.emptyDesc}>Press Ctrl+T or click + to create a new terminal</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.area}>
      <PaneTreeRoot />
    </div>
  )
}
