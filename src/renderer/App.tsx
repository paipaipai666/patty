import { useEffect, useCallback, useRef, useState } from 'react'
import { useSessionStore, teardownSessionIPC, SESSION_COLORS, buildSessionPersistedState } from './store/sessionStore'
import {
  createTerminal,
  createSshTerminal,
  createTerminalSplit,
  closeSession,
  closeAllSessions,
  selectSession,
  createTerminalInCollection as lifecycleCreateTerminalInCollection
} from './store/sessionLifecycle'
import { useWorkspaceStore, getFocusedSessionId } from './store/workspaceStore'
import { configureDirtyScheduler, markDirty } from './store/dirtyScheduler'
import { normalizeWorkspaces } from '../shared/workspaceNormalize'
import { useSettingsStore } from './store/settingsStore'
import { perfMark, perfMeasure } from '../shared/perf'
import { TitleBar } from './components/TitleBar/TitleBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { TerminalArea } from './components/Terminal/TerminalArea'
import { CommandBar } from './components/CommandBar/CommandBar'
import { StatusBar } from './components/StatusBar/StatusBar'
import { MetricsDashboard } from './components/MetricsDashboard/MetricsDashboard'
import { SshMonitorPanel } from './components/SshMonitor/SshMonitorPanel'
import { ContextMenu, type MenuItem } from './components/App/ContextMenu'
import { PromptDialog, type PromptOptions } from './components/App/PromptDialog'
import { SettingsModal } from './components/Settings/SettingsModal'
import { Toasts } from './components/App/Toasts'
import { toast } from './store/toastStore'
import type { SshProfile, SshAuthRequest, SshHostkeyRequest } from '../shared/settingsTypes'
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
  const setActive = useSessionStore((s) => s.setActive)
  const renameSession = useSessionStore((s) => s.renameSession)
  const setColor = useSessionStore((s) => s.setColor)
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const sidebarWidth = useSessionStore((s) => s.sidebarWidth)
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)
  const endSidebarTransition = useSessionStore((s) => s.endSidebarTransition)
  const sidebarWrapperRef = useRef<HTMLDivElement>(null)
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
  const [sshMonitorOpen, setSshMonitorOpen] = useState(false)

  const [sshAuthQueue, setSshAuthQueue] = useState<Array<{ id: string; info: SshAuthRequest }>>([])
  const [sshHostkeyQueue, setSshHostkeyQueue] = useState<Array<{ id: string; info: SshHostkeyRequest }>>([])

  useEffect(() => {
    const api = window.terminalAPI
    const unAuth = api.onSshAuth?.((id, info) => setSshAuthQueue((q) => [...q, { id, info }]))
    const unHostkey = api.onSshHostkey?.((id, info) => setSshHostkeyQueue((q) => [...q, { id, info }]))
    return () => {
      unAuth?.()
      unHostkey?.()
    }
  }, [])

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


  useEffect(() => {
    const splash = document.getElementById('patty-splash')
    if (!splash) return
    splash.classList.add('patty-splash-hide')
    setTimeout(() => splash.remove(), 200)
  }, [])


  useEffect(() => {
    if (perfEnabled) perfMark('renderer:settings-init-start')
    settingsInit().then(() => {
      if (perfEnabled) perfMeasure('renderer:settings-init', 'renderer:settings-init-start')
    })
  }, [settingsInit])


  useEffect(() => {
    void window.terminalAPI.hookServerStatus?.().then((s) => {
      if (s && !s.available) toast('AI notifications unavailable: hook server failed to start')
    })
  }, [])


  useEffect(() => {
    window.terminalAPI.metricsSetSampling(metricsOpen)
    return () => window.terminalAPI.metricsSetSampling(false)
  }, [metricsOpen])


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
        knownIds,
        { paneTree: persisted.paneTree, focusedPaneId: persisted.focusedPaneId }
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

    const cwd = localStorage.getItem(LAST_CWD_KEY) || undefined
    createTerminal({ cwd, shell: defaultShell })
  }, [defaultShell])

  const handleNewSsh = useCallback((profile: SshProfile) => {
    createSshTerminal(profile)
  }, [])

  const handleNewTerminalPickFolder = useCallback(async () => {
    try {
      const result = await window.terminalAPI.selectDirectory()
      if (result.canceled) return
      if (result.directory) localStorage.setItem(LAST_CWD_KEY, result.directory)
      createTerminal({ cwd: result.directory || undefined, shell: defaultShell })
    } catch (err) {
      console.error('Failed to create terminal:', err)
    }
  }, [defaultShell])

  const handleCloseSession = useCallback((id: string) => {
    closeSession(id)
  }, [])

  const handleCloseAllSessions = useCallback(() => {
    closeAllSessions()
  }, [])


  const handleSplit = useCallback((direction: 'horizontal' | 'vertical') => {
    createTerminalSplit(direction)
  }, [])


  const handleClosePane = useCallback(() => {
    const focusedId = getFocusedSessionId()
    useWorkspaceStore.getState().closeFocused()

    if (focusedId) {
      useSessionStore.getState().setAiType(focusedId, null)
    }

    const nextFocused = getFocusedSessionId()
    const currentActive = useSessionStore.getState().activeSessionId
    if (nextFocused === currentActive) return
    if (nextFocused) {
      setActive(nextFocused)
    } else {

      useSessionStore.setState({ activeSessionId: null })
      markDirty()
    }
  }, [setActive])


  const handleSelectSession = useCallback((id: string) => {
    selectSession(id)
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId })
  }, [])

  const handleCollectionContextMenu = useCallback((e: React.MouseEvent, collectionId: string) => {
    e.preventDefault()
    setCollectionContextMenu({ x: e.clientX, y: e.clientY, collectionId })
  }, [])


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
      },
      {
        label: 'Close All Terminals',
        action: () => handleCloseAllSessions()
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
        action: () => void lifecycleCreateTerminalInCollection(collectionId, defaultShell)
      }
    ]
  }

  const sidebarOnRight = sidebarPosition === 'right'


  useEffect(() => {
    const el = sidebarWrapperRef.current
    if (!el) return
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== 'width' || e.target !== el) return
      endSidebarTransition()
    }
    el.addEventListener('transitionend', onEnd)
    return () => el.removeEventListener('transitionend', onEnd)
  }, [endSidebarTransition])

  return (
    <div className={styles.app}>
      <TitleBar onOpenSettings={openSettings} sidebarVisible={sidebarVisible} onToggleSidebar={toggleSidebar} />
      <div className={styles.main} style={sidebarOnRight ? { flexDirection: 'row-reverse' } : undefined}>
        <div ref={sidebarWrapperRef} className={styles.sidebarWrapper} style={{ width: sidebarVisible ? sidebarWidth : 0 }}>
          <Sidebar onNewTerminal={handleNewTerminal} onNewTerminalPickFolder={handleNewTerminalPickFolder} onNewSsh={handleNewSsh} onCloseSession={handleCloseSession} onSelectSession={handleSelectSession} onCollectionContextMenu={handleCollectionContextMenu} />
        </div>
        <div
          className={styles.content}
          style={{ [sidebarOnRight ? 'borderRight' : 'borderLeft']: '1px solid var(--border-subtle)' }}
          onContextMenu={(e) => {

          const activeId = useSessionStore.getState().activeSessionId
          if (activeId) handleContextMenu(e, activeId)
        }}>
          <TerminalArea />
          <CommandBar />
          <StatusBar
            metricsOpen={metricsOpen}
            onToggleMetrics={() => setMetricsOpen((o) => !o)}
            sshMonitorOpen={sshMonitorOpen}
            onToggleSshMonitor={() => setSshMonitorOpen((o) => !o)}
          />
          <MetricsDashboard open={metricsOpen} onClose={() => setMetricsOpen(false)} />
          <SshMonitorPanel open={sshMonitorOpen} onClose={() => setSshMonitorOpen(false)} />
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
      <PromptDialog
        show={sshAuthQueue.length > 0}
        options={
          sshAuthQueue[0]
            ? {
                title: sshAuthQueue[0].info.prompt,
                secret: true,
                okLabel: 'Connect',
                onSubmit: (value) => {
                  window.terminalAPI.sshAuthRespond(sshAuthQueue[0].id, value)
                  setSshAuthQueue((q) => q.slice(1))
                },
                onCancel: () => {
                  window.terminalAPI.sshAuthRespond(sshAuthQueue[0].id, null)
                  setSshAuthQueue((q) => q.slice(1))
                }
              }
            : { title: '', onSubmit: () => {}, onCancel: () => {} }
        }
      />
      <PromptDialog
        show={sshHostkeyQueue.length > 0}
        options={
          sshHostkeyQueue[0]
            ? {
                title: 'Unknown host key',
                body: `${sshHostkeyQueue[0].info.keyType} key fingerprint ${sshHostkeyQueue[0].info.fingerprint} for ${sshHostkeyQueue[0].info.host}:${sshHostkeyQueue[0].info.port}. Trust and continue connecting?`,
                okLabel: 'Trust & Connect',
                hideInput: true,
                onSubmit: () => {
                  window.terminalAPI.sshHostkeyRespond(sshHostkeyQueue[0].id, true)
                  setSshHostkeyQueue((q) => q.slice(1))
                },
                onCancel: () => {
                  window.terminalAPI.sshHostkeyRespond(sshHostkeyQueue[0].id, false)
                  setSshHostkeyQueue((q) => q.slice(1))
                }
              }
            : { title: '', onSubmit: () => {}, onCancel: () => {} }
        }
      />
      <SettingsModal />
      <Toasts />
    </div>
  )
}
