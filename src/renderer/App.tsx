import { useEffect, useCallback } from 'react'
import { useSessionStore, type SessionColor } from './store/sessionStore'
import { useSettingsStore } from './store/settingsStore'
import { TitleBar } from './components/TitleBar/TitleBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { TerminalArea } from './components/Terminal/TerminalArea'
import { StatusBar } from './components/StatusBar/StatusBar'
import { ContextMenu, type MenuItem } from './components/common/ContextMenu'
import { SettingsModal } from './components/Settings/SettingsModal'
import { useState } from 'react'
import styles from './App.module.css'

interface ContextMenuState {
  x: number
  y: number
  sessionId: string
}

const COLORS: SessionColor[] = ['blue', 'green', 'amber', 'coral', 'purple', 'gray']

export default function App() {
  const addSession = useSessionStore((s) => s.addSession)
  const removeSession = useSessionStore((s) => s.removeSession)
  const setActive = useSessionStore((s) => s.setActive)
  const renameSession = useSessionStore((s) => s.renameSession)
  const setColor = useSessionStore((s) => s.setColor)
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)
  const navigateNext = useSessionStore((s) => s.navigateNext)
  const navigatePrev = useSessionStore((s) => s.navigatePrev)
  const navigateToIndex = useSessionStore((s) => s.navigateToIndex)
  const sessions = useSessionStore((s) => s.sessions)

  const settingsInit = useSettingsStore((s) => s.init)
  const settings = useSettingsStore((s) => s.settings)
  const openSettings = useSettingsStore((s) => s.openSettings)

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // Initialize settings on mount
  useEffect(() => {
    settingsInit()
  }, [settingsInit])

  const handleNewTerminal = useCallback(async () => {
    try {
      const result = await window.terminalAPI.selectDirectory()
      if (result.canceled) return
      addSession({ cwd: result.directory || undefined, shell: settings.defaultShell })
    } catch (err) {
      console.error('Failed to create terminal:', err)
    }
  }, [addSession, settings.defaultShell])

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

  // Keyboard shortcuts
  useEffect(() => {
    const shortcuts = settings.shortcuts

    const shortcutActions: Record<string, () => void> = {
      [shortcuts.newTerminal.toLowerCase()]: handleNewTerminal,
      [shortcuts.closeTerminal.toLowerCase()]: () => {
        const activeId = useSessionStore.getState().activeSessionId
        if (activeId) handleCloseSession(activeId)
      },
      [shortcuts.nextTab.toLowerCase()]: navigateNext,
      [shortcuts.prevTab.toLowerCase()]: navigatePrev,
      [shortcuts.toggleSidebar.toLowerCase()]: toggleSidebar,
      [shortcuts.settings.toLowerCase()]: openSettings
    }

    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [handleNewTerminal, handleCloseSession, navigateNext, navigatePrev, toggleSidebar, navigateToIndex, settings.shortcuts, openSettings])

  const getContextMenuItems = (): MenuItem[] => {
    if (!contextMenu) return []
    const { sessionId } = contextMenu

    return [
      {
        label: 'Rename',
        action: () => {
          // Trigger rename - the SessionItem handles this via double-click
          // For now, we'll use a prompt
          const name = window.prompt('Enter new name:')
          if (name?.trim()) renameSession(sessionId, name.trim())
        }
      },
      { separator: true, label: '', action: () => {} },
      ...COLORS.map(
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

  const sidebarOnRight = settings.sidebarPosition === 'right'

  return (
    <div className={styles.app}>
      <TitleBar onOpenSettings={openSettings} />
      <div className={styles.main} style={sidebarOnRight ? { flexDirection: 'row-reverse' } : undefined}>
        {sidebarVisible && (
          <Sidebar onNewTerminal={handleNewTerminal} onCloseSession={handleCloseSession} />
        )}
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
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      )}
      <SettingsModal />
    </div>
  )
}
