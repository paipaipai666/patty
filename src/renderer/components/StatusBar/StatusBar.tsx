import { useSessionStore } from '../../store/sessionStore'
import styles from './StatusBar.module.css'

const SHELL_LABELS: Record<string, string> = {
  powershell: 'Windows PowerShell',
  pwsh: 'PowerShell 7',
  cmd: 'CMD',
  gitbash: 'Git Bash',
  wsl: 'WSL'
}

function formatCwd(cwd: string): string {
  if (!cwd) return '~'
  const match = cwd.match(/^([A-Z]:\\Users\\[^\\]+)/i)
  if (match && cwd.startsWith(match[1])) {
    return '~' + cwd.slice(match[1].length).replace(/\\/g, '/')
  }
  return cwd
}

interface StatusBarProps {
  metricsOpen?: boolean
  onToggleMetrics?: () => void
}

export function StatusBar({ metricsOpen = false, onToggleMetrics }: StatusBarProps) {
  const activeSession = useSessionStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId) ?? null
  )

  const metricsButton = (
    <button
      className={`${styles.item} ${styles.toggleBtn} ${metricsOpen ? styles.active : ''}`}
      onClick={onToggleMetrics}
      aria-pressed={metricsOpen}
    >
      Metrics
    </button>
  )

  if (!activeSession) {
    return (
      <div className={styles.statusbar}>
        <span className={styles.item}>No active session</span>
        <span className={styles.spacer} />
        {metricsButton}
      </div>
    )
  }

  return (
    <div className={styles.statusbar} role="status" aria-live="polite">
      <span key={activeSession.id} className={styles.swap}>
        <span className={styles.item}>
          <span
            className={styles.dot}
            style={{
              backgroundColor: `var(--color-${activeSession.color})`
            }}
            aria-label={activeSession.color}
          />
          {activeSession.title}
        </span>
        <span className={styles.separator}>│</span>
        <span className={styles.item}>{SHELL_LABELS[activeSession.shell] || activeSession.shell}</span>
        <span className={styles.separator}>│</span>
        <span className={styles.item}>{formatCwd(activeSession.cwd)}</span>
        {activeSession.pid > 0 && (
          <>
            <span className={styles.separator}>│</span>
            <span className={styles.item}>PID {activeSession.pid}</span>
          </>
        )}
      </span>
      <span className={styles.spacer} />
      {metricsButton}
    </div>
  )
}
