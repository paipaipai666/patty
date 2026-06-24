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

  // LRU: ordered by most-recent-access. Value tracks whether it was truly "used".
  const lruRef = useRef(new Map<string, LruEntry>())
  // All mounted terminals (have full xterm.js DOM, includes LRU + new terminals)
  const mountedRef = useRef(new Set<string>())
  // Terminals whose DOM was removed but xterm.js is cached
  const evictedRef = useRef(new Set<string>())
  // Track last active + session count to distinguish new-terminal from tab-switch
  const lastActiveRef = useRef<string | null>(null)
  const lastCountRef = useRef(0)

  // Access a terminal in the LRU
  const accessLru = useCallback((id: string, isUsed: boolean) => {
    const lru = lruRef.current
    const existing = lru.get(id)

    lru.delete(id)
    lru.set(id, { used: isUsed || existing?.used || false })

    // Evict over-capacity entries
    while (lru.size > LRU_CAPACITY) {
      let evicted = false
      for (const [candidateId, entry] of lru) {
        if (!entry.used && candidateId !== id) {
          lru.delete(candidateId)
          evictedRef.current.add(candidateId)
          evicted = true
          break
        }
      }
      if (!evicted) {
        const oldest = lru.keys().next().value
        if (oldest && oldest !== id) {
          lru.delete(oldest)
          evictedRef.current.add(oldest)
        } else {
          break
        }
      }
    }
  }, [])

  // Mark a terminal as "used" (called by TerminalPane on keyboard/output)
  const markUsed = useCallback((id: string) => {
    const lru = lruRef.current
    const entry = lru.get(id)
    if (entry && !entry.used) {
      lru.delete(id)
      lru.set(id, { used: true })
    }
    // Ensure it's tracked as mounted and not evicted
    mountedRef.current.add(id)
    evictedRef.current.delete(id)
  }, [])

  // Track active session changes — only count tab switches, not new terminal creation
  if (activeSessionId && activeSessionId !== lastActiveRef.current) {
    const isNewTerminal = sessions.length !== lastCountRef.current
    lastActiveRef.current = activeSessionId
    lastCountRef.current = sessions.length

    // Track as mounted
    mountedRef.current.add(activeSessionId)

    if (!isNewTerminal) {
      // Tab switch to existing terminal → add to LRU
      accessLru(activeSessionId, false)
    }

    // Enforce capacity: evict oldest non-used mounted terminals
    while (mountedRef.current.size > LRU_CAPACITY) {
      const lru = lruRef.current
      let evicted = false

      // Try to evict oldest LRU entry that is only "visited"
      for (const [candidateId, entry] of lru) {
        if (!entry.used && candidateId !== activeSessionId && mountedRef.current.has(candidateId)) {
          mountedRef.current.delete(candidateId)
          lru.delete(candidateId)
          evictedRef.current.add(candidateId)
          evicted = true
          break
        }
      }

      if (!evicted) {
        // All mounted are "used" or in LRU — evict oldest mounted (not active)
        for (const candidateId of mountedRef.current) {
          if (candidateId !== activeSessionId) {
            mountedRef.current.delete(candidateId)
            lru.delete(candidateId)
            evictedRef.current.add(candidateId)
            break
          }
        }
        break // avoid infinite loop
      }
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
        const isEvicted = evictedRef.current.has(session.id)

        // Evicted + not active → render empty placeholder (TerminalPane cached its xterm.js)
        if (isEvicted && !isActive) {
          return (
            <div
              key={session.id}
              className={styles.pane}
              style={{ display: 'none' }}
            />
          )
        }

        // Active + was evicted → un-evict (TerminalPane will reattach from cache)
        if (isActive && isEvicted) {
          evictedRef.current.delete(session.id)
          accessLru(session.id, false)
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
