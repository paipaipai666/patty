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

export function StatusBar() {
  const activeSession = useSessionStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId) ?? null
  )

  if (!activeSession) {
    return (
      <div className={styles.statusbar}>
        <span className={styles.item}>No active session</span>
      </div>
    )
  }

  return (
    <div className={styles.statusbar}>
      <span className={styles.item}>
        <span
          className={styles.dot}
          style={{
            backgroundColor: `var(--color-${activeSession.color})`
          }}
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
    </div>
  )
}
