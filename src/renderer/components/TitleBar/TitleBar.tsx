import { useState, useEffect } from 'react'
import { Search16Regular } from '@fluentui/react-icons'
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
      <rect
        x="1"
        y="1"
        width="12"
        height="12"
        rx="2"
        stroke="currentColor"
        fill="none"
        strokeWidth="1.4"
      />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <rect
        x="3"
        y="0.5"
        width="10"
        height="10"
        rx="2"
        stroke="currentColor"
        fill="none"
        strokeWidth="1.4"
      />
      <rect
        x="0.5"
        y="3.5"
        width="10"
        height="10"
        rx="2"
        stroke="currentColor"
        fill="var(--bg-titlebar)"
        strokeWidth="1.4"
      />
      <rect
        x="0.5"
        y="3.5"
        width="10"
        height="10"
        rx="2"
        stroke="currentColor"
        fill="none"
        strokeWidth="1.4"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <path
        d="M1 1L13 13M13 1L1 13"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function SidebarIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18">
        <rect
          x="1.5"
          y="2"
          width="15"
          height="14"
          rx="2"
          stroke="currentColor"
          fill="none"
          strokeWidth="1.4"
        />
        <line
          x1="6.5"
          y1="2"
          x2="6.5"
          y2="16"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <rect
        x="1.5"
        y="2"
        width="15"
        height="14"
        rx="2"
        stroke="currentColor"
        fill="none"
        strokeWidth="1.4"
      />
      <line
        x1="11.5"
        y1="2"
        x2="11.5"
        y2="16"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  )
}

interface TitleBarProps {
  onOpenCommands?: () => void
  commandShortcut?: string
  sidebarVisible: boolean
  onToggleSidebar: () => void
}

export function TitleBar({
  onOpenCommands,
  commandShortcut,
  sidebarVisible,
  onToggleSidebar
}: TitleBarProps) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const cleanup = window.terminalAPI.onMaximizeChange((val) =>
      setMaximized(val)
    )
    return cleanup
  }, [])

  return (
    <div className={styles.titlebar}>
      <div className={styles.dragRegion} data-tauri-drag-region="deep">
        {!sidebarVisible && <button
          type="button"
          onClick={onToggleSidebar}
          className={styles.btnToggle}
          aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          aria-pressed={sidebarVisible}
          title="Toggle sidebar"
        >
          <SidebarIcon open={sidebarVisible} />
        </button>}
        {!sidebarVisible && onOpenCommands && <button type="button" className={styles.commandButton} onClick={onOpenCommands} aria-label="Open command palette" title={`Find sessions and commands${commandShortcut ? ` (${commandShortcut})` : ''}`}>
          <Search16Regular aria-hidden />
        </button>}
      </div>
      <div className={styles.controls}>
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
          onClick={() => {
            void window.terminalAPI.windowClose()
          }}
          className={`${styles.btnControl} ${styles.btnClose}`}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}
