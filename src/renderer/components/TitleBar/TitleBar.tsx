import { useState, useEffect } from 'react'
import styles from './TitleBar.module.css'

function MinimizeIcon() {
  return (
    <svg width="10" height="1" viewBox="0 0 10 1">
      <rect width="10" height="1" fill="currentColor" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" fill="none" strokeWidth="1" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <rect x="2" y="0" width="7.5" height="7.5" stroke="currentColor" fill="none" strokeWidth="1" />
      <rect x="0" y="2.5" width="7.5" height="7.5" stroke="currentColor" fill="var(--bg-titlebar)" strokeWidth="1" />
      <rect x="0" y="2.5" width="7.5" height="7.5" stroke="currentColor" fill="none" strokeWidth="1" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path
        d="M6 7.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"
        stroke="currentColor"
        fill="none"
        strokeWidth="0.8"
      />
      <path
        d="M7.42 1.56l.36-.36a.5.5 0 01.71 0l.7.7a.5.5 0 00.45.14l.98-.22a.5.5 0 01.57.42l.12.99a.5.5 0 00.26.38l.85.5a.5.5 0 01.21.69l-.42.86a.5.5 0 000 .47l.42.86a.5.5 0 01-.21.69l-.85.5a.5.5 0 00-.26.38l-.12.99a.5.5 0 01-.57.42l-.98-.22a.5.5 0 00-.45.14l-.7.7a.5.5 0 01-.71 0l-.36-.36a.5.5 0 00-.47 0l-.36.36a.5.5 0 01-.71 0l-.7-.7a.5.5 0 00-.45-.14l-.98.22a.5.5 0 01-.57-.42l-.12-.99a.5.5 0 00-.26-.38l-.85-.5a.5.5 0 01-.21-.69l.42-.86a.5.5 0 000-.47l-.42-.86a.5.5 0 01.21-.69l.85-.5a.5.5 0 00.26-.38l.12-.99a.5.5 0 01.57-.42l.98.22a.5.5 0 00.45-.14l.7-.7a.5.5 0 01.71 0l.36.36a.5.5 0 00.47 0z"
        stroke="currentColor"
        fill="none"
        strokeWidth="0.6"
      />
    </svg>
  )
}

interface TitleBarProps {
  onOpenSettings?: () => void
}

export function TitleBar({ onOpenSettings }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const cleanup = window.terminalAPI.onMaximizeChange((val) => setMaximized(val))
    return cleanup
  }, [])

  return (
    <div className={styles.titlebar}>
      <div className={styles.dragRegion}>
        <span className={styles.title}>Terminal Sidebar</span>
      </div>
      <div className={styles.controls}>
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className={styles.btnControl}
            aria-label="Settings"
            title="Settings"
          >
            <GearIcon />
          </button>
        )}
        <button
          onClick={() => window.terminalAPI.windowMinimize()}
          className={styles.btnControl}
          aria-label="Minimize"
        >
          <MinimizeIcon />
        </button>
        <button
          onClick={() => window.terminalAPI.windowMaximize()}
          className={styles.btnControl}
          aria-label={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button
          onClick={() => window.terminalAPI.windowClose()}
          className={`${styles.btnControl} ${styles.btnClose}`}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}
