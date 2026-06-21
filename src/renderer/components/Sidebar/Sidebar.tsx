import { useState, useCallback, useRef, useEffect } from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { SessionList } from './SessionList'
import styles from './Sidebar.module.css'

interface SidebarProps {
  onNewTerminal: () => void
  onCloseSession: (id: string) => void
}

export function Sidebar({ onNewTerminal, onCloseSession }: SidebarProps) {
  const sidebarWidth = useSessionStore((s) => s.sidebarWidth)
  const setSidebarWidth = useSessionStore((s) => s.setSidebarWidth)
  const [searchQuery, setSearchQuery] = useState('')
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true
      startX.current = e.clientX
      startWidth.current = sidebarWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [sidebarWidth]
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientX - startX.current
      setSidebarWidth(startWidth.current + delta)
    }

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [setSidebarWidth])

  return (
    <div className={styles.sidebar} style={{ width: sidebarWidth }}>
      <div className={styles.header}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button
          className={styles.newBtn}
          onClick={onNewTerminal}
          aria-label="New terminal"
          title="New terminal (Ctrl+T)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path
              d="M7 1V13M1 7H13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <SessionList onClose={onCloseSession} />
      <div className={styles.resizeHandle} onMouseDown={handleMouseDown} />
    </div>
  )
}
