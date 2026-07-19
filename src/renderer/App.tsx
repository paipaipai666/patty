import { useEffect, useCallback, useState } from 'react'
import { useSessionStore, teardownSessionIPC, SESSION_COLORS, buildSessionPersistedState } from './store/sessionStore'
import { useWorkspaceStore, getFocusedSessionId } from './store/workspaceStore'
import { configureDirtyScheduler, markDirty } from './store/dirtyScheduler'
import { normalizeWorkspaces } from '../shared/workspaceNormalize'
import { useSettingsStore } from './store/settingsStore'
import { perfMark, perfMeasure } from '../shared/perf'
import { TitleBar } from './components/TitleBar/TitleBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { TerminalArea } from './components/Terminal/TerminalArea'
import { StatusBar } from './components/StatusBar/StatusBar'
import { MetricsDashboard } from './components/MetricsDashboard/MetricsDashboard'
import { ContextMenu, type MenuItem } from './components/common/ContextMenu'
import { PromptDialog, type PromptOptions } from './components/common/PromptDialog'
import { SettingsModal } from './components/Settings/SettingsModal'
import { Toasts } from './components/common/Toasts'
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

const LAST_CWD_KEY = 'patty-last-cwd'

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
  const [metricsOpen, setMetricsOpen] = useState(false)

  const perfEnabled = (window as any).terminalAPI?.perfEnabled === true

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
    if (perfEnabled) perfMark('renderer:settings-init-start')
    settingsInit().then(() => {
      if (perfEnabled) perfMeasure('renderer:settings-init', 'renderer:settings-init-start')
    })
  }, [settingsInit])

  // Metrics sampling spawns a powershell.exe per sample in the main process —
  // only run it while the dashboard is open.
  useEffect(() => {
    window.terminalAPI.metricsSetSampling(metricsOpen)
    return () => window.terminalAPI.metricsSetSampling(false)
  }, [metricsOpen])

  // Wire combined persistence: sessionStore owns sessions/sidebar/collections,
  // workspaceStore owns workspaces[] + activeWorkspaceId.
  useEffect(() => {
    configureDirtyScheduler(() => {
      const sessionState = buildSessionPersistedState()
      if (!useSessionStore.getState().loaded) return null
      const wsState = useWorkspaceStore.getState().toPersisted()
      return {
        ...sessionState,
        ...wsState
      }
    })
  }, [])

  // Load session state on mount, then normalize and restore workspaces.
  // Legacy paneTree/focusedPaneId fields are normalized into workspaces by
  // normalizeWorkspaces so old state files upgrade seamlessly.
  useEffect(() => {
    let cancelled = false
    if (perfEnabled) perfMark('renderer:state-load-start')
    loadState().then((persisted) => {
      if (perfEnabled) perfMark('renderer:state-loaded')
      if (cancelled || !persisted) return
      const sessions = useSessionStore.getState().sessions
      const knownIds = new Set(sessions.map((s) => s.id))
      if (perfEnabled) perfMark('renderer:normalize-workspaces-start')
      const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
        persisted.workspaces,
        persisted.activeWorkspaceId,
        knownIds
      )
      if (perfEnabled) perfMeasure('renderer:normalize-workspaces', 'renderer:normalize-workspaces-start')
      if (perfEnabled) perfMark('renderer:load-workspace-start')
      useWorkspaceStore.getState().loadFromPersisted(workspaces, activeWorkspaceId)
      if (perfEnabled) perfMeasure('renderer:load-workspace', 'renderer:load-workspace-start')
      if (perfEnabled) perfMeasure('renderer:state-load', 'renderer:state-load-start')
    })
    return () => {
      cancelled = true
      teardownSessionIPC()
    }
  }, [loadState])

  const handleNewTerminal = useCallback(() => {
    // Instant create: reuse the last picked directory, or the user's home
    // (pty.rs falls back to USERPROFILE when cwd is undefined). The native
    // folder picker stays available as a separate menu item.
    const cwd = localStorage.getItem(LAST_CWD_KEY) || undefined
    const newId = addSession({ cwd, shell: defaultShell })
    useWorkspaceStore.getState().createWorkspace(newId)
  }, [addSession, defaultShell])

  const handleNewTerminalPickFolder = useCallback(async () => {
    try {
      const result = await window.terminalAPI.selectDirectory()
      if (result.canceled) return
      if (result.directory) localStorage.setItem(LAST_CWD_KEY, result.directory)
      const newId = addSession({ cwd: result.directory || undefined, shell: defaultShell })
      useWorkspaceStore.getState().createWorkspace(newId)
    } catch (err) {
      console.error('Failed to create terminal:', err)
    }
  }, [addSession, defaultShell])

  const handleCloseSession = useCallback(
    (id: string) => {
      window.terminalAPI.kill(id)
      removeSession(id)
      useWorkspaceStore.getState().removeSessionEverywhere(id)
    },
    [removeSession]
  )

  // Split the focused pane: the new half inherits the focused session's cwd
  // (tmux-style) and shell. The new session becomes a leaf beside the focused
  // one and receives focus.
  const handleSplit = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      const focusedSessionId = getFocusedSessionId()
      const sessions = useSessionStore.getState().sessions
      const focused = focusedSessionId ? sessions.find((s) => s.id === focusedSessionId) : undefined
      const newId = addSession({
        cwd: focused?.cwd || undefined,
        shell: focused?.shell
      })
      useWorkspaceStore.getState().splitFocused(newId, direction)
    },
    [addSession]
  )

  // Close the focused pane (not the session — the session goes to the sidebar
  // background). Its PTY is killed when the TerminalPane unmounts.
  const handleClosePane = useCallback(() => {
    const focusedId = getFocusedSessionId()
    useWorkspaceStore.getState().closeFocused()
    // Clear AI state for the closed pane. The session stays in the sidebar but
    // its PTY is about to be killed by the unmounting TerminalPane — fallback
    // cleanup (onPtyExit → setAiType) would be blocked by ptyManager's stale
    // sessions.has() check, so we clear aiType here synchronously.
    if (focusedId) {
      useSessionStore.getState().setAiType(focusedId, null)
    }
    // Sync sidebar highlight to whatever pane is now focused. When the last
    // pane was closed, closeFocused() clears activeWorkspaceId, so this resolves
    // to null and the sidebar highlight disappears.
    const nextFocused = getFocusedSessionId()
    const currentActive = useSessionStore.getState().activeSessionId
    if (nextFocused === currentActive) return
    if (nextFocused) {
      setActive(nextFocused)
    } else {
      // No focused pane — clear the active session so the sidebar highlight
      // and the terminal area both reflect the empty state.
      useSessionStore.setState({ activeSessionId: null })
      markDirty()
    }
  }, [setActive])

  // Sidebar click on a session: make it the active session (sidebar highlight +
  // status bar) and ensure it's visible. With workspaces, this switches to the
  // workspace containing the session (creating one if needed) and focuses its pane.
  const handleSelectSession = useCallback(
    (id: string) => {
      setActive(id)
      useWorkspaceStore.getState().ensureVisible(id)
    },
    [setActive]
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
      [sc.settings.toLowerCase()]: openSettings,
      [sc.splitHorizontal.toLowerCase()]: () => handleSplit('horizontal'),
      [sc.splitVertical.toLowerCase()]: () => handleSplit('vertical'),
      [sc.closePane.toLowerCase()]: handleClosePane
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip global shortcuts when focus is inside terminal or form controls
      const activeEl = document.activeElement
      if (activeEl?.closest('.xterm')) return
      if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) return

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
  }, [handleNewTerminal, handleCloseSession, handleSplit, handleClosePane, navigateNext, navigatePrev, toggleSidebar, navigateToIndex, shortcuts, openSettings])

  const getContextMenuItems = (): MenuItem[] => {
    if (!contextMenu) return []
    const { sessionId } = contextMenu

    return [
      {
        label: 'Split Horizontal',
        action: () => handleSplit('horizontal')
      },
      {
        label: 'Split Vertical',
        action: () => handleSplit('vertical')
      },
      {
        label: 'Close Pane',
        action: () => handleClosePane()
      },
      { separator: true, label: '', action: () => {} },
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
      <TitleBar onOpenSettings={openSettings} sidebarVisible={sidebarVisible} onToggleSidebar={toggleSidebar} />
      <div className={styles.main} style={sidebarOnRight ? { flexDirection: 'row-reverse' } : undefined}>
        <div className={styles.sidebarWrapper} style={{ width: sidebarVisible ? sidebarWidth : 0 }}>
          <Sidebar onNewTerminal={handleNewTerminal} onNewTerminalPickFolder={handleNewTerminalPickFolder} onCloseSession={handleCloseSession} onSelectSession={handleSelectSession} onCollectionContextMenu={handleCollectionContextMenu} />
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
          <StatusBar metricsOpen={metricsOpen} onToggleMetrics={() => setMetricsOpen((o) => !o)} />
          <MetricsDashboard open={metricsOpen} onClose={() => setMetricsOpen(false)} />
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
      <Toasts />
    </div>
  )
}
