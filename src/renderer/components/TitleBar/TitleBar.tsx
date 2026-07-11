import { useState, useEffect } from 'react'
import styles from './TitleBar.module.css'

function MinimizeIcon() {
  return (
    <svg width="14" height="2" viewBox="0 0 14 2">
      <rect width="14" height="2" rx="1" fill="currentColor" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" fill="none" strokeWidth="1.4" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <rect x="3" y="0.5" width="10" height="10" rx="2" stroke="currentColor" fill="none" strokeWidth="1.4" />
      <rect x="0.5" y="3.5" width="10" height="10" rx="2" stroke="currentColor" fill="var(--bg-titlebar)" strokeWidth="1.4" />
      <rect x="0.5" y="3.5" width="10" height="10" rx="2" stroke="currentColor" fill="none" strokeWidth="1.4" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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
      <svg width="18" height="18" viewBox="0 0 18 18">
        <rect x="1.5" y="2" width="15" height="14" rx="2" stroke="currentColor" fill="none" strokeWidth="1.4" />
        <line x1="6.5" y1="2" x2="6.5" y2="16" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <rect x="1.5" y="2" width="15" height="14" rx="2" stroke="currentColor" fill="none" strokeWidth="1.4" />
      <line x1="11.5" y1="2" x2="11.5" y2="16" stroke="currentColor" strokeWidth="1.4" />
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
