import { useState, useCallback, useRef, useEffect } from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useSettingsStore } from '../../store/settingsStore'
import { SessionList } from './SessionList'
import styles from './Sidebar.module.css'

interface SidebarProps {
  onNewTerminal: () => void
  onCloseSession: (id: string) => void
  onCollectionContextMenu?: (e: React.MouseEvent, collectionId: string) => void
}

export function Sidebar({ onNewTerminal, onCloseSession, onCollectionContextMenu }: SidebarProps) {
  const sidebarWidth = useSessionStore((s) => s.sidebarWidth)
  const setSidebarWidth = useSessionStore((s) => s.setSidebarWidth)
  const addCollection = useSessionStore((s) => s.addCollection)
  const sidebarPosition = useSettingsStore((s) => s.settings.sidebarPosition)
  const [searchQuery, setSearchQuery] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [isCreatingCollection, setIsCreatingCollection] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const newCollectionInputRef = useRef<HTMLInputElement>(null)
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
      const adjusted = sidebarPosition === 'right' ? -delta : delta
      setSidebarWidth(startWidth.current + adjusted)
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
  }, [setSidebarWidth, sidebarPosition])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu])

  const handleNewCollection = () => {
    setIsCreatingCollection(true)
    setNewCollectionName('')
    setShowMenu(false)
    setTimeout(() => newCollectionInputRef.current?.focus(), 0)
  }

  const handleCreateCollection = () => {
    const trimmed = newCollectionName.trim()
    if (trimmed) {
      addCollection(trimmed)
    }
    setIsCreatingCollection(false)
    setNewCollectionName('')
  }

  const handleCollectionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreateCollection()
    } else if (e.key === 'Escape') {
      setIsCreatingCollection(false)
      setNewCollectionName('')
    }
  }

  const handleNewTerminalClick = () => {
    setShowMenu(false)
    onNewTerminal()
  }

  return (
    <div className={styles.sidebar} style={{ width: sidebarWidth }}>
      <div className={styles.header}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search sessions..."
          aria-label="Search sessions"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className={styles.menuContainer} ref={menuRef}>
          <button
            className={styles.newBtn}
            onClick={() => setShowMenu(!showMenu)}
            aria-label="New terminal or collection"
            title="New terminal or collection"
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
          {showMenu && (
            <div className={styles.dropdownMenu}>
              <button className={styles.menuItem} onClick={handleNewTerminalClick}>
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <rect x="1" y="2" width="10" height="8" rx="1" stroke="currentColor" fill="none" strokeWidth="1" />
                  <path d="M4 6L5.5 7.5L8 5" stroke="currentColor" strokeWidth="1" fill="none" />
                </svg>
                New Terminal
              </button>
              <button className={styles.menuItem} onClick={handleNewCollection}>
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <path
                    d="M1 3C1 2.45 1.45 2 2 2H4.5L5.5 3H10C10.55 3 11 3.45 11 4V9C11 9.55 10.55 10 10 10H2C1.45 10 1 9.55 1 9V3Z"
                    stroke="currentColor"
                    fill="none"
                    strokeWidth="1"
                  />
                </svg>
                New Collection
              </button>
            </div>
          )}
        </div>
      </div>
      {isCreatingCollection && (
        <div className={styles.newCollectionRow}>
          <svg className={styles.folderIcon} width="14" height="14" viewBox="0 0 14 14">
            <path
              d="M1 3.5C1 2.67 1.67 2 2.5 2H5L6.5 3.5H11.5C12.33 3.5 13 4.17 13 5V10.5C13 11.33 12.33 12 11.5 12H2.5C1.67 12 1 11.33 1 10.5V3.5Z"
              fill="currentColor"
              opacity="0.6"
            />
          </svg>
          <input
            ref={newCollectionInputRef}
            className={styles.renameInput}
            placeholder="Collection name..."
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onBlur={handleCreateCollection}
            onKeyDown={handleCollectionKeyDown}
            autoFocus
          />
        </div>
      )}
      <SessionList onClose={onCloseSession} onCollectionContextMenu={onCollectionContextMenu} searchQuery={searchQuery} />
      <div
        className={styles.resizeHandle}
        style={sidebarPosition === 'right' ? { left: -2, right: 'auto' } : undefined}
        onMouseDown={handleMouseDown}
      />
    </div>
  )
}
