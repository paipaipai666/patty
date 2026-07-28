import { useState, useMemo } from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useWorkspaceStore, getFocusedSessionId } from '../../store/workspaceStore'
import styles from './CommandBar.module.css'

// FinalShell-style local command input: compose/edit a command here, then send
// it to the focused SSH session. History lives in localStorage (usage traces,
// not settings) and is shared across sessions like shell history.
const HISTORY_KEY = 'patty-cmd-history'
const HISTORY_LIMIT = 200

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function pushHistory(cmd: string) {
  const history = loadHistory()
  // Skip consecutive duplicates — spamming the same command must not flood ↑ recall.
  if (history[history.length - 1] !== cmd) {
    history.push(cmd)
  }
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)))
  } catch {
    // ignore localStorage failures
  }
}

export function CommandBar() {
  // Subscribe to focus/workspace changes so the bar follows the focused pane.
  useWorkspaceStore((s) => s.workspaces)
  useWorkspaceStore((s) => s.activeWorkspaceId)
  const sessionId = getFocusedSessionId()
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId))

  const [value, setValue] = useState('')
  // History navigation: null = editing fresh text; otherwise index into history.
  const [histIdx, setHistIdx] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  const ghost = useMemo(() => {
    if (!value || histIdx !== null) return ''
    const history = loadHistory()
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].startsWith(value) && history[i] !== value) {
        return history[i].slice(value.length)
      }
    }
    return ''
  }, [value, histIdx])

  if (!session || session.shell !== 'ssh') return null

  const send = () => {
    const cmd = value.replace(/[\r\n]+/g, ' ').trim()
    if (!cmd) return
    // write() is fire-and-forget; the Rust side swallows EPIPE on dead PTYs.
    window.terminalAPI.write(session.id, cmd + '\r')
    useSessionStore.getState().resetAttention(session.id)
    pushHistory(cmd)
    setValue('')
    setHistIdx(null)
    setDraft('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const history = loadHistory()
    if (e.key === 'Enter') {
      e.preventDefault()
      send()
      return
    }
    if (e.key === 'Tab') {
      if (ghost) {
        e.preventDefault()
        setValue(value + ghost)
      }
      return
    }
    if (e.key === 'ArrowRight' && ghost && e.currentTarget.selectionStart === value.length) {
      e.preventDefault()
      setValue(value + ghost)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      if (histIdx === null) {
        setDraft(value)
        const next = history.length - 1
        setHistIdx(next)
        setValue(history[next])
      } else if (histIdx > 0) {
        setHistIdx(histIdx - 1)
        setValue(history[histIdx - 1])
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx === null) return
      if (histIdx < history.length - 1) {
        setHistIdx(histIdx + 1)
        setValue(history[histIdx + 1])
      } else {
        // Stepping past the newest entry restores the pre-navigation draft.
        setHistIdx(null)
        setValue(draft)
      }
      return
    }
    if (e.key === 'Escape') {
      e.currentTarget.blur()
    }
  }

  const target = session.ssh?.user ? `${session.ssh.user}@${session.ssh.host}` : session.ssh?.host ?? 'SSH'

  return (
    <div className={styles.bar}>
      <span className={styles.prompt}>&gt;_</span>
      <div className={styles.inputWrap}>
        <input
          type="text"
          className={styles.input}
          value={value}
          placeholder={`Type a command, Enter to send to ${target}`}
          aria-label="SSH command input"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setValue(e.target.value)
            setHistIdx(null)
          }}
          onKeyDown={handleKeyDown}
        />
        {ghost && (
          <div className={styles.ghost} aria-hidden="true">
            <span className={styles.ghostTyped}>{value}</span>
            <span className={styles.ghostSuffix}>{ghost}</span>
          </div>
        )}
      </div>
      <button type="button" className={styles.sendBtn} onClick={send} aria-label="Send command" title="Send command">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M1 6H11M7 2L11 6L7 10" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}
