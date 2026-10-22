import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect
} from 'react'
import {
  Add16Regular,
  Search16Regular,
  ChevronDown16Regular,
  Folder16Regular,
  Globe16Regular,
  Settings20Regular,
  Code16Regular
} from '@fluentui/react-icons'
import { useSessionStore } from '../../store/sessionStore'
import { useSettingsStore } from '../../store/settingsStore'
import { SessionList } from './SessionList'
import type { SshProfile } from '../../../shared/settingsTypes'
import styles from './Sidebar.module.css'

interface SidebarProps {
  onNewTerminal: () => void
  onNewTerminalPickFolder: () => void
  onNewSsh: (profile: SshProfile) => void
  onCloseSession: (id: string) => void
  onSelectSession: (id: string) => void
  onCollectionContextMenu?: (e: React.MouseEvent, collectionId: string) => void
}

export function Sidebar({
  onNewTerminal,
  onNewTerminalPickFolder,
  onNewSsh,
  onCloseSession,
  onSelectSession,
  onCollectionContextMenu
}: SidebarProps) {
  const sidebarWidth = useSessionStore((s) => s.sidebarWidth)
  const setSidebarWidth = useSessionStore((s) => s.setSidebarWidth)
  const addCollection = useSessionStore((s) => s.addCollection)
  const sidebarPosition = useSettingsStore((s) => s.settings.sidebarPosition)
  const sshProfiles = useSettingsStore((s) => s.settings.sshProfiles)
  const openSettings = useSettingsStore((s) => s.openSettings)
  const [searchQuery, setSearchQuery] = useState('')
  const [menu, setMenu] = useState<'create' | 'ssh' | null>(null)
  const [isCreatingCollection, setIsCreatingCollection] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [menuPosition, setMenuPosition] = useState({
    left: 12,
    top: 100,
    maxHeight: 400
  })
  const headerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const newCollectionInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ x: number; width: number } | null>(null)

  const endResize = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    const move = (event: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const delta = event.clientX - drag.x
      setSidebarWidth(
        drag.width + (sidebarPosition === 'right' ? -delta : delta)
      )
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', endResize)
    window.addEventListener('blur', endResize)
    return () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', endResize)
      window.removeEventListener('blur', endResize)
      endResize()
    }
  }, [setSidebarWidth, sidebarPosition, endResize])

  useLayoutEffect(() => {
    if (!menu) return
    const updatePosition = () => {
      const rect = headerRef.current?.getBoundingClientRect()
      if (!rect) return
      const top = Math.min(
        rect.bottom + 2,
        Math.max(12, window.innerHeight - 80)
      )
      setMenuPosition({
        left: Math.max(12, Math.min(rect.left + 12, window.innerWidth - 284)),
        top,
        maxHeight: Math.max(60, window.innerHeight - top - 12)
      })
    }
    updatePosition()
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    window.addEventListener('resize', updatePosition)
    const outside = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !menuButtonRef.current?.contains(event.target)
      )
        setMenu(null)
    }
    document.addEventListener('mousedown', outside)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('mousedown', outside)
    }
  }, [menu])

  useEffect(() => {
    if (isCreatingCollection) newCollectionInputRef.current?.focus()
  }, [isCreatingCollection])

  const closeMenu = () => {
    setMenu(null)
    menuButtonRef.current?.focus()
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      event.stopPropagation()
      closeMenu()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
    )
    const index = buttons.findIndex(
      (button) => button === document.activeElement
    )
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
            buttons.length
    buttons[next]?.focus()
  }

  const createCollection = () => {
    const trimmed = newCollectionName.trim()
    if (trimmed) addCollection(trimmed)
    setIsCreatingCollection(false)
    setNewCollectionName('')
  }

  return (
    <div className={styles.sidebar} style={{ width: sidebarWidth }}>
      <div className={styles.header} ref={headerRef}>
        <div className={styles.search}>
          <Search16Regular aria-hidden />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search sessions..."
            aria-label="Search sessions"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        <div className={styles.createRow}>
          <button
            type="button"
            className={styles.newTerminal}
            title="New terminal"
            onClick={onNewTerminal}
          >
            <Add16Regular aria-hidden />
            <span>New terminal</span>
          </button>
          <div className={styles.menuContainer}>
            <button
              ref={menuButtonRef}
              type="button"
              className={styles.newBtn}
              onClick={() => setMenu(menu ? null : 'create')}
              aria-label="New terminal or collection"
              title="More ways to create a terminal"
              aria-haspopup="menu"
              aria-expanded={menu !== null}
              aria-controls={menu ? 'terminal-create-menu' : undefined}
            >
              <ChevronDown16Regular aria-hidden />
            </button>
            {menu && (
              <div
                id="terminal-create-menu"
                ref={menuRef}
                className={styles.dropdownMenu}
                style={menuPosition}
                role="menu"
                aria-label={
                  menu === 'ssh'
                    ? 'SSH profiles'
                    : 'Create terminal or collection'
                }
                onKeyDown={handleMenuKeyDown}
              >
                {menu === 'create' ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuItem}
                      onClick={() => {
                        setMenu(null)
                        onNewTerminal()
                      }}
                    >
                      <Code16Regular aria-hidden />
                      <span>New Terminal</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuItem}
                      onClick={() => {
                        setMenu(null)
                        onNewTerminalPickFolder()
                      }}
                    >
                      <Folder16Regular aria-hidden />
                      <span>New Terminal (Choose Folder)…</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuItem}
                      onClick={() => setMenu('ssh')}
                    >
                      <Globe16Regular aria-hidden />
                      <span>New SSH Connection…</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuItem}
                      onClick={() => {
                        setMenu(null)
                        setNewCollectionName('')
                        setIsCreatingCollection(true)
                      }}
                    >
                      <Folder16Regular aria-hidden />
                      <span>New Collection</span>
                    </button>
                  </>
                ) : (
                  <>
                    {sshProfiles.length === 0 && (
                      <div className={styles.menuItemDisabled}>
                        No SSH profiles
                      </div>
                    )}
                    {sshProfiles.map((profile) => (
                      <button
                        key={profile.id}
                        type="button"
                        role="menuitem"
                        className={styles.menuItem}
                        onClick={() => {
                          setMenu(null)
                          onNewSsh(profile)
                        }}
                      >
                        <Globe16Regular aria-hidden />
                        <span
                          className={styles.menuItemText}
                          title={profile.host}
                        >
                          {profile.name}
                          <span className={styles.menuItemSub}>
                            {profile.user ? profile.user + '@' : ''}
                            {profile.host}:{profile.port ?? 22}
                          </span>
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuItem}
                      onClick={() => {
                        setMenu(null)
                        openSettings('ssh')
                      }}
                    >
                      Manage SSH Profiles…
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {isCreatingCollection && (
        <div className={styles.newCollectionRow}>
          <Folder16Regular className={styles.folderIcon} aria-hidden />
          <input
            ref={newCollectionInputRef}
            className={styles.renameInput}
            placeholder="Collection name..."
            aria-label="Collection name"
            value={newCollectionName}
            onChange={(event) => setNewCollectionName(event.target.value)}
            onBlur={createCollection}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') createCollection()
              if (event.key === 'Escape') {
                setIsCreatingCollection(false)
                setNewCollectionName('')
              }
            }}
          />
        </div>
      )}
      <SessionList
        onClose={onCloseSession}
        onSelect={onSelectSession}
        onCollectionContextMenu={onCollectionContextMenu}
        searchQuery={searchQuery}
      />
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.settingsBtn}
          onClick={() => openSettings()}
        >
          <Settings20Regular aria-hidden />
          <span>Settings</span>
        </button>
      </div>
      <div
        className={styles.resizeHandle}
        role="separator"
        tabIndex={0}
        aria-label="Sidebar width"
        aria-orientation="vertical"
        aria-valuemin={160}
        aria-valuemax={320}
        aria-valuenow={sidebarWidth}
        style={
          sidebarPosition === 'right' ? { left: 0, right: 'auto' } : undefined
        }
        onMouseDown={(event) => {
          event.preventDefault()
          dragRef.current = { x: event.clientX, width: sidebarWidth }
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
        }}
        onKeyDown={(event) => {
          const delta = sidebarPosition === 'right' ? -16 : 16
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            setSidebarWidth(
              sidebarWidth + (event.key === 'ArrowRight' ? delta : -delta)
            )
          }
          if (event.key === 'Home') {
            event.preventDefault()
            setSidebarWidth(160)
          }
          if (event.key === 'End') {
            event.preventDefault()
            setSidebarWidth(320)
          }
        }}
      />
    </div>
  )
}
