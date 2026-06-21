import { useSessionStore } from '../../store/sessionStore'
import { SessionItem } from './SessionItem'
import styles from './Sidebar.module.css'

interface SessionListProps {
  onClose: (id: string) => void
}

export function SessionList({ onClose }: SessionListProps) {
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  if (sessions.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon}>⌨</span>
        <span>No terminals</span>
        <span className={styles.emptyHint}>Press Ctrl+T to create one</span>
      </div>
    )
  }

  return (
    <div className={styles.list}>
      {sessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          onClose={onClose}
        />
      ))}
    </div>
  )
}
