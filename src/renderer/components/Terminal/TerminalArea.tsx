import { useSessionStore } from '../../store/sessionStore'
import { TerminalPane } from './TerminalPane'
import styles from './Terminal.module.css'

export function TerminalArea() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  if (sessions.length === 0) {
    return (
      <div className={styles.emptyArea}>
        <div className={styles.emptyContent}>
          <div className={styles.emptyLogo}>⌨</div>
          <h2 className={styles.emptyTitle}>Terminal Sidebar</h2>
          <p className={styles.emptyDesc}>Press Ctrl+T or click + to create a new terminal</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.area}>
      {sessions.map((session) => (
        <TerminalPane
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
        />
      ))}
    </div>
  )
}
