import { useEffect, useCallback } from 'react'
import { useSessionStore, type SessionColor } from './store/sessionStore'
import { TitleBar } from './components/TitleBar/TitleBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { TerminalArea } from './components/Terminal/TerminalArea'
import { StatusBar } from './components/StatusBar/StatusBar'
import { ContextMenu, type MenuItem } from './components/common/ContextMenu'
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

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const handleNewTerminal = useCallback(() => {
    addSession()
  }, [addSession])

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return

      switch (e.key) {
        case 't':
        case 'T':
          e.preventDefault()
          handleNewTerminal()
          break
        case 'w':
        case 'W':
          e.preventDefault()
          {
            const activeId = useSessionStore.getState().activeSessionId
            if (activeId) handleCloseSession(activeId)
          }
          break
        case ']':
          e.preventDefault()
          navigateNext()
          break
        case '[':
          e.preventDefault()
          navigatePrev()
          break
        case 'b':
        case 'B':
          e.preventDefault()
          toggleSidebar()
          break
        default:
          // Ctrl+1-9
          if (e.key >= '1' && e.key <= '9') {
            e.preventDefault()
            navigateToIndex(parseInt(e.key) - 1)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNewTerminal, handleCloseSession, navigateNext, navigatePrev, toggleSidebar, navigateToIndex])

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

  return (
    <div className={styles.app}>
      <TitleBar />
      <div className={styles.main}>
        {sidebarVisible && (
          <Sidebar onNewTerminal={handleNewTerminal} onCloseSession={handleCloseSession} />
        )}
        <div className={styles.content} onContextMenu={(e) => {
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
    </div>
  )
}
