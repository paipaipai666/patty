import { useSessionStore } from '../../store/sessionStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { PaneTreeRoot } from '../Pane/PaneTree'
import styles from './Terminal.module.css'

/**
 * Terminal area: renders the pane split tree.
 *
 * Shows the empty state when there are no sessions OR no active workspace
 * (e.g. the last pane was just closed — its session stays in the sidebar
 * but nothing is rendered in the terminal area).
 */
export function TerminalArea() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const workspaces = useWorkspaceStore((s) => s.workspaces)

  const activeWs = activeWorkspaceId ? workspaces.find((w) => w.id === activeWorkspaceId) : undefined
  const hasVisiblePane = !!activeWs?.paneTree

  if (sessions.length === 0 || !hasVisiblePane) {
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
