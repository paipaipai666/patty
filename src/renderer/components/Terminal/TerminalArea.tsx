import { useRef, useCallback } from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { TerminalPane } from './TerminalPane'
import styles from './Terminal.module.css'

// LRU capacity: max terminals with full xterm.js DOM at any time.
const LRU_CAPACITY = 10

interface LruEntry {
  used: boolean  // true = user typed or received output; false = just visited
}

export function TerminalArea() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  // LRU: ordered by most-recent-access
  const lruRef = useRef(new Map<string, LruEntry>())
  // Terminals currently mounted (have full xterm.js + PTY)
  const mountedRef = useRef(new Set<string>())
  // Track last active + session count to distinguish new-terminal from tab-switch
  const lastActiveRef = useRef<string | null>(null)
  const lastCountRef = useRef(0)

  // Evict oldest non-used mounted terminal
  const evictOne = useCallback((excludeId: string) => {
    const lru = lruRef.current
    // Try evicting oldest LRU entry that is only "visited"
    for (const [candidateId, entry] of lru) {
      if (!entry.used && candidateId !== excludeId && mountedRef.current.has(candidateId)) {
        mountedRef.current.delete(candidateId)
        lru.delete(candidateId)
        return
      }
    }
    // All mounted are "used" — evict oldest mounted (not the current one)
    for (const candidateId of mountedRef.current) {
      if (candidateId !== excludeId) {
        mountedRef.current.delete(candidateId)
        lru.delete(candidateId)
        return
      }
    }
  }, [])

  // Mark a terminal as "used" (called by TerminalPane on keyboard/output)
  const markUsed = useCallback((id: string) => {
    const lru = lruRef.current
    const entry = lru.get(id)
    if (entry) {
      if (!entry.used) {
        lru.delete(id)
        lru.set(id, { used: true })
      }
    } else {
      lru.set(id, { used: true })
    }
    mountedRef.current.add(id)
  }, [])

  // Track active session changes
  if (activeSessionId && activeSessionId !== lastActiveRef.current) {
    const isNewTerminal = sessions.length !== lastCountRef.current
    lastActiveRef.current = activeSessionId
    lastCountRef.current = sessions.length

    // Track as mounted
    mountedRef.current.add(activeSessionId)

    if (!isNewTerminal) {
      // Tab switch → add to LRU
      const lru = lruRef.current
      const existing = lru.get(activeSessionId)
      lru.delete(activeSessionId)
      lru.set(activeSessionId, { used: existing?.used || false })
    }

    // Enforce capacity
    while (mountedRef.current.size > LRU_CAPACITY) {
      evictOne(activeSessionId)
    }
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
        const isActive = session.id === activeSessionId
        const isMounted = mountedRef.current.has(session.id)

        // Evicted terminal → empty placeholder
        if (!isMounted && !isActive) {
          return (
            <div
              key={session.id}
              className={styles.pane}
              style={{ display: 'none' }}
            />
          )
        }

        // Active terminal that was evicted → re-mount
        if (isActive && !isMounted) {
          mountedRef.current.add(session.id)
          const lru = lruRef.current
          if (!lru.has(session.id)) {
            lru.set(session.id, { used: false })
          }
        }

        return (
          <TerminalPane
            key={session.id}
            session={session}
            isActive={isActive}
            onUsed={markUsed}
          />
        )
      })}
    </div>
  )
}
