import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { useSessionStore } from '../../store/sessionStore'
import { useSettingsStore } from '../../store/settingsStore'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { TerminalPane } from './TerminalPane'
import styles from './Terminal.module.css'

export function TerminalArea() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const emptyRef = useRef<HTMLDivElement>(null)

  // Empty state entrance animation
  useGSAP(() => {
    if (!emptyRef.current) return
    const children = emptyRef.current.children
    gsap.from(children, {
      y: 16,
      opacity: 0,
      duration: 0.5,
      stagger: 0.1,
      ease: 'back.out(1.5)'
    })
    // Floating icon
    gsap.to(children[0], {
      y: -6,
      duration: 1.8,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut'
    })
  }, { scope: emptyRef })

  if (sessions.length === 0) {
    return (
      <div className={styles.emptyArea}>
        <div className={styles.emptyContent} ref={emptyRef}>
          <div className={styles.emptyLogo}>⌨</div>
          <h2 className={styles.emptyTitle}>Patty</h2>
          <p className={styles.emptyDesc}>Press Ctrl+T or click + to create a new terminal</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.area}>
      {settingsLoaded &&
        sessions.map((session) => (
          <ErrorBoundary key={session.id}>
            <TerminalPane
              session={session}
              isActive={session.id === activeSessionId}
            />
          </ErrorBoundary>
        ))}
    </div>
  )
}
