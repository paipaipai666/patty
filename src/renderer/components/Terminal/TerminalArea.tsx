import { useRef } from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { TerminalPane } from './TerminalPane'
import styles from './Terminal.module.css'

export function TerminalArea() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  // Track which sessions have been activated (visited by user).
  // Only these get full xterm.js + PTY initialization.
  // Untouched sessions from restore are lazy — they mount on first visit.
  const activatedRef = useRef<Set<string>>(new Set())

  if (activeSessionId) {
    activatedRef.current.add(activeSessionId)
  }

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
      {sessions.map((session) => {
        const activated = activatedRef.current.has(session.id)

        if (!activated) {
          // Placeholder: same layout as TerminalPane but no xterm.js / PTY
          return (
            <div
              key={session.id}
              className={styles.pane}
              style={{ display: session.id === activeSessionId ? 'block' : 'none' }}
            />
          )
        }

        return (
          <TerminalPane
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
          />
        )
      })}
    </div>
  )
}
