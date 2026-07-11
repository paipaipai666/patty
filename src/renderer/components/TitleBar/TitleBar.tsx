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

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function SidebarIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14">
        <rect x="1" y="1.5" width="12" height="11" rx="1.5" stroke="currentColor" fill="none" strokeWidth="1.2" />
        <line x1="5" y1="1.5" x2="5" y2="12.5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <rect x="1" y="1.5" width="12" height="11" rx="1.5" stroke="currentColor" fill="none" strokeWidth="1.2" />
      <line x1="9" y1="1.5" x2="9" y2="12.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

interface TitleBarProps {
  onOpenSettings?: () => void
  sidebarVisible: boolean
  onToggleSidebar: () => void
}

export function TitleBar({ onOpenSettings, sidebarVisible, onToggleSidebar }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const cleanup = window.terminalAPI.onMaximizeChange((val) => setMaximized(val))
    return cleanup
  }, [])

  return (
    <div className={styles.titlebar}>
      <div className={styles.dragRegion}>
        <button
          type="button"
          onClick={onToggleSidebar}
          className={styles.btnToggle}
          aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          aria-pressed={sidebarVisible}
          title="Toggle sidebar"
        >
          <SidebarIcon open={sidebarVisible} />
        </button>
        <span className={styles.title}>Patty</span>
      </div>
      <div className={styles.controls}>
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className={styles.btnControl}
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon />
          </button>
        )}
        <button
          type="button"
          onClick={() => window.terminalAPI.windowMinimize()}
          className={styles.btnControl}
          aria-label="Minimize"
        >
          <MinimizeIcon />
        </button>
        <button
          type="button"
          onClick={() => window.terminalAPI.windowMaximize()}
          className={styles.btnControl}
          aria-label={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button
          type="button"
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
