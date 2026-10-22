import { Code24Regular, Add16Regular } from '@fluentui/react-icons'
import { useSessionStore } from '../../store/sessionStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { PaneTreeRoot } from '../Pane/PaneTree'
import styles from './Terminal.module.css'


   
export function TerminalArea({ onNewTerminal }: { onNewTerminal?: () => void } = {}) {
  const sessions = useSessionStore((s) => s.sessions)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const workspaces = useWorkspaceStore((s) => s.workspaces)

  const activeWs = activeWorkspaceId ? workspaces.find((w) => w.id === activeWorkspaceId) : undefined
  const hasVisiblePane = !!activeWs?.paneTree

  if (sessions.length === 0 || !hasVisiblePane) {
    return (
      <div className={styles.emptyArea}>
        <div className={styles.emptyContent}>
          <div className={styles.emptyLogo}><Code24Regular aria-hidden /></div>
          <h2 className={styles.emptyTitle}>Patty</h2>
          <p className={styles.emptyDesc}>Create a terminal or connect to a saved SSH host.</p>
          {onNewTerminal && <button type="button" className={styles.emptyAction} onClick={onNewTerminal}><Add16Regular aria-hidden />New terminal</button>}
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
