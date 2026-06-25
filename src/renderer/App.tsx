import { useEffect, useCallback, useState } from 'react'
import { useSessionStore, teardownSessionIPC, SESSION_COLORS } from './store/sessionStore'
import { useSettingsStore } from './store/settingsStore'
import { TitleBar } from './components/TitleBar/TitleBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { TerminalArea } from './components/Terminal/TerminalArea'
import { StatusBar } from './components/StatusBar/StatusBar'
import { ContextMenu, type MenuItem } from './components/common/ContextMenu'
import { PromptDialog, type PromptOptions } from './components/common/PromptDialog'
import { SettingsModal } from './components/Settings/SettingsModal'
import styles from './App.module.css'

interface ContextMenuState {
  x: number
  y: number
  sessionId: string
}

interface CollectionContextMenuState {
  x: number
  y: number
  collectionId: string
}

export default function App() {
  const addSession = useSessionStore((s) => s.addSession)
  const removeSession = useSessionStore((s) => s.removeSession)
  const setActive = useSessionStore((s) => s.setActive)
  const renameSession = useSessionStore((s) => s.renameSession)
  const setColor = useSessionStore((s) => s.setColor)
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const sidebarWidth = useSessionStore((s) => s.sidebarWidth)
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)
  const navigateNext = useSessionStore((s) => s.navigateNext)
  const navigatePrev = useSessionStore((s) => s.navigatePrev)
  const navigateToIndex = useSessionStore((s) => s.navigateToIndex)
  const loadState = useSessionStore((s) => s.loadState)
  const addCollection = useSessionStore((s) => s.addCollection)
  const removeCollection = useSessionStore((s) => s.removeCollection)
  const renameCollection = useSessionStore((s) => s.renameCollection)

  const settingsInit = useSettingsStore((s) => s.init)
  const defaultShell = useSettingsStore((s) => s.settings.defaultShell)
  const shortcuts = useSettingsStore((s) => s.settings.shortcuts)
  const sidebarPosition = useSettingsStore((s) => s.settings.sidebarPosition)
  const openSettings = useSettingsStore((s) => s.openSettings)

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [collectionContextMenu, setCollectionContextMenu] = useState<CollectionContextMenuState | null>(null)
  const [promptOptions, setPromptOptions] = useState<PromptOptions | null>(null)

  const showPrompt = useCallback((title: string, defaultValue: string = ''): Promise<{ canceled: boolean; value: string }> => {
    return new Promise((resolve) => {
      setPromptOptions({
        title,
        defaultValue,
        onSubmit: (value) => {
          setPromptOptions(null)
          resolve({ canceled: false, value })
        },
        onCancel: () => {
          setPromptOptions(null)
          resolve({ canceled: true, value: '' })
        }
      })
    })
  }, [])

  // Initialize settings on mount
  useEffect(() => {
    settingsInit()
  }, [settingsInit])

  // Load session state on mount
  useEffect(() => {
    loadState()
    return () => teardownSessionIPC()
  }, [loadState])

  const handleNewTerminal = useCallback(async () => {
    try {
      const result = await window.terminalAPI.selectDirectory()
      if (result.canceled) return
      addSession({ cwd: result.directory || undefined, shell: defaultShell })
    } catch (err) {
      console.error('Failed to create terminal:', err)
    }
  }, [addSession, defaultShell])

  const handleCloseSession = useCallback(
    (id: string) => {
      window.terminalAPI.kill(id)
      removeSession(id)
    },
    [removeSession]
  )

  const handleContextMenu = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId })
  }, [])

  const handleCollectionContextMenu = useCallback((e: React.MouseEvent, collectionId: string) => {
    e.preventDefault()
    setCollectionContextMenu({ x: e.clientX, y: e.clientY, collectionId })
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const sc = shortcuts

    const shortcutActions: Record<string, () => void> = {
      [sc.newTerminal.toLowerCase()]: handleNewTerminal,
      [sc.closeTerminal.toLowerCase()]: () => {
        const activeId = useSessionStore.getState().activeSessionId
        if (activeId) handleCloseSession(activeId)
      },
      [sc.nextTab.toLowerCase()]: navigateNext,
      [sc.prevTab.toLowerCase()]: navigatePrev,
      [sc.toggleSidebar.toLowerCase()]: toggleSidebar,
      [sc.settings.toLowerCase()]: openSettings
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip global shortcuts when focus is inside terminal
      const activeEl = document.activeElement
      if (activeEl?.closest('.xterm')) return

      const parts: string[] = []
      if (e.ctrlKey) parts.push('ctrl')
      if (e.altKey) parts.push('alt')
      if (e.shiftKey) parts.push('shift')
      if (e.metaKey) parts.push('meta')
      const key = e.key.toLowerCase()
      if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
        parts.push(key)
      }
      const combo = parts.join('+')

      const action = shortcutActions[combo]
      if (action) {
        e.preventDefault()
        action()
        return
      }

      // Ctrl+1-9 tab navigation
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        navigateToIndex(parseInt(e.key) - 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNewTerminal, handleCloseSession, navigateNext, navigatePrev, toggleSidebar, navigateToIndex, shortcuts, openSettings])

  const getContextMenuItems = (): MenuItem[] => {
    if (!contextMenu) return []
    const { sessionId } = contextMenu

    return [
      {
        label: 'Rename',
        action: async () => {
          const result = await showPrompt('Enter new name:')
          if (!result.canceled && result.value.trim()) {
            renameSession(sessionId, result.value.trim())
          }
        }
      },
      { separator: true, label: '', action: () => {} },
      ...SESSION_COLORS.map(
        (color): MenuItem => ({
          label: `Color: ${color}`,
          action: () => setColor(sessionId, color)
        })
      ),
      { separator: true, label: '', action: () => {} },
      {
        label: 'Close',
        action: () => handleCloseSession(sessionId)
      }
    ]
  }

  const getCollectionContextMenuItems = (): MenuItem[] => {
    if (!collectionContextMenu) return []
    const { collectionId } = collectionContextMenu

    return [
      {
        label: 'Rename',
        action: async () => {
          const result = await showPrompt('Enter new name:')
          if (!result.canceled && result.value.trim()) {
            renameCollection(collectionId, result.value.trim())
          }
        }
      },
      {
        label: 'Delete',
        action: () => removeCollection(collectionId)
      },
      { separator: true, label: '', action: () => {} },
      {
        label: 'New Subcollection',
        action: async () => {
          const result = await showPrompt('Enter collection name:')
          if (!result.canceled && result.value.trim()) {
            addCollection(result.value.trim(), collectionId)
          }
        }
      },
      {
        label: 'New Terminal Here',
        action: async () => {
          try {
            const result = await window.terminalAPI.selectDirectory()
            if (!result.canceled) {
              addSession({ cwd: result.directory || undefined, collectionId, shell: defaultShell })
            }
          } catch (err) {
            console.error('Failed to create terminal:', err)
          }
        }
      }
    ]
  }

  const sidebarOnRight = sidebarPosition === 'right'

  return (
    <div className={styles.app}>
      <TitleBar onOpenSettings={openSettings} />
      <div className={styles.main} style={sidebarOnRight ? { flexDirection: 'row-reverse' } : undefined}>
        <div className={styles.sidebarWrapper} style={{ width: sidebarVisible ? sidebarWidth : 0 }}>
          <Sidebar onNewTerminal={handleNewTerminal} onCloseSession={handleCloseSession} onCollectionContextMenu={handleCollectionContextMenu} />
        </div>
        <div
          className={styles.content}
          style={{ [sidebarOnRight ? 'borderRight' : 'borderLeft']: '1px solid var(--border-subtle)' }}
          onContextMenu={(e) => {
          // Right-click on terminal area - find active session
          const activeId = useSessionStore.getState().activeSessionId
          if (activeId) handleContextMenu(e, activeId)
        }}>
          <TerminalArea />
          <StatusBar />
        </div>
      </div>
      <ContextMenu
        show={!!contextMenu}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={contextMenu ? getContextMenuItems() : []}
        onClose={() => setContextMenu(null)}
      />
      <ContextMenu
        show={!!collectionContextMenu}
        x={collectionContextMenu?.x ?? 0}
        y={collectionContextMenu?.y ?? 0}
        items={collectionContextMenu ? getCollectionContextMenuItems() : []}
        onClose={() => setCollectionContextMenu(null)}
      />
      <PromptDialog show={!!promptOptions} options={promptOptions ?? { title: '', defaultValue: '', onSubmit: () => {}, onCancel: () => {}}} />
      <SettingsModal />
    </div>
  )
}
