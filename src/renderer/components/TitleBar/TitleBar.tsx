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
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 9.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M7 1.5c.25 0 .45.18.5.42l.34 1.78c.5.18 1.02.46 1.5.82l1.7-.67c.23-.09.48 0 .6.22l.92 1.6c.13.22.08.5-.12.66l-1.4 1.07c.04.28.04.56 0 .84l1.4 1.07c.2.16.25.44.12.66l-.92 1.6c-.12.22-.37.31-.6.22l-1.7-.67c-.48.36-1 .64-1.5.82l-.34 1.78c-.05.24-.25.42-.5.42s-.45-.18-.5-.42l-.34-1.78c-.5-.18-1.02-.46-1.5-.82l-1.7.67c-.23.09-.48 0-.6-.22l-.92-1.6c-.13-.22-.08-.5.12-.66l1.4-1.07c-.04-.28-.04-.56 0-.84l-1.4-1.07c-.2-.16-.25-.44-.12-.66l.92-1.6c.12-.22.37-.31.6-.22l1.7.67c.48-.36 1-.64 1.5-.82l.34-1.78c.05-.24.25-.42.5-.42Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
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
