import { create } from 'zustand'
import type { PersistedState, SessionColor, Collection } from '../shared/stateTypes'
import type { ShellType } from '../shared/settingsTypes'
import { requestStateSave, saveStateNow } from './statePersistence'

export interface TerminalSession {
  id: string
  title: string
  color: SessionColor
  cwd: string
  shell: ShellType
  pid: number
  createdAt: number
  collectionId: string | null
  aiType?: 'claude' | 'opencode' | 'codex' | null
}

export const SESSION_COLORS: SessionColor[] = ['blue', 'green', 'amber', 'coral', 'purple', 'gray']

export const SESSION_COLOR_VARS: Record<SessionColor, string> = {
  blue: 'var(--color-blue)',
  green: 'var(--color-green)',
  amber: 'var(--color-amber)',
  coral: 'var(--color-coral)',
  purple: 'var(--color-purple)',
  gray: 'var(--color-gray)'
}

function getNextColor(index: number): SessionColor {
  return SESSION_COLORS[index % SESSION_COLORS.length]
}

interface SessionStore {
  sessions: TerminalSession[]
  collections: Collection[]
  activeSessionId: string | null
  sidebarVisible: boolean
  sidebarWidth: number
  loaded: boolean
  attentionMap: Record<string, string | null>

  addSession: (opts?: { cwd?: string; shell?: string; collectionId?: string | null }) => string
  removeSession: (id: string) => void
  setActive: (id: string) => void
  renameSession: (id: string, title: string) => void
  setColor: (id: string, color: SessionColor) => void
  updatePid: (id: string, pid: number) => void
  moveSessionToCollection: (sessionId: string, collectionId: string | null) => void

  addCollection: (name: string, parentId?: string | null) => string
  removeCollection: (id: string) => void
  renameCollection: (id: string, name: string) => void
  toggleCollectionCollapse: (id: string) => void
  moveCollection: (collectionId: string, newParentId: string | null) => void

  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  navigateNext: () => void
  navigatePrev: () => void
  navigateToIndex: (index: number) => void

  setAttention: (id: string, eventType: string | null) => void
  resetAttention: (id: string) => void
  setAiType: (id: string, aiType: 'claude' | 'opencode' | 'codex' | null) => void

  loadState: () => Promise<PersistedState | null>
  saveState: () => Promise<void>
}

const attentionTimers: Record<string, ReturnType<typeof setTimeout>> = {}
let ipcCleanup: (() => void) | null = null

export function teardownSessionIPC() {
  if (ipcCleanup) ipcCleanup()
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  collections: [],
  activeSessionId: null,
  sidebarVisible: true,
  sidebarWidth: 220,
  loaded: false,
  attentionMap: {},

  loadState: async () => {
    try {
      const state = await window.terminalAPI.stateLoad()
      set({
        sessions: state.sessions.map((s) => ({ ...s, pid: 0, aiType: null })),
        collections: state.collections,
        activeSessionId: state.activeSessionId,
        sidebarVisible: state.sidebarVisible,
        sidebarWidth: state.sidebarWidth,
        loaded: true
      })

      // Listen for attention changes from hook server
      // Guard against duplicate registration (e.g. React StrictMode remount)
      if (ipcCleanup) ipcCleanup()
      const offAttention = window.terminalAPI.onAttentionChange((paneId, eventType, aiType) => {
        get().setAttention(paneId, eventType)
        // Sync aiType when the parameter is not undefined
        if (aiType !== undefined) {
          get().setAiType(paneId, aiType ?? null)
        }
      })

      // Listen for PTY exit to cleanup attention state
      // Don't remove the session — let the user close it manually.
      // TerminalPane's onExit handler writes "[Process exited]" to the terminal.
      const offPtyExit = window.terminalAPI.onPtyExit((paneId) => {
        get().setAttention(paneId, null)
      })

      ipcCleanup = () => {
        offAttention()
        offPtyExit()
        ipcCleanup = null
      }

      // Return the raw persisted state so the caller (App) can forward the
      // workspaces/activeWorkspaceId to workspaceStore without a second IPC
      // or a cross-store import. sessionStore does not own workspace state.
      return state
    } catch (err) {
      console.error('Failed to load state:', err)
      set({ loaded: true })
      return null
    }
  },

  saveState: async () => {
    await saveStateNow()
  },

  addSession: (opts = {}) => {
    const id = crypto.randomUUID()
    const { sessions } = get()
    const shellName = (opts.shell || 'powershell') as ShellType
    const newSession: TerminalSession = {
      id,
      title: `Terminal ${sessions.length + 1}`,
      color: getNextColor(sessions.length),
      cwd: opts.cwd || '',
      shell: shellName,
      pid: 0,
      createdAt: Date.now(),
      collectionId: opts.collectionId ?? null
    }
    set((state) => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: id
    }))
    requestStateSave()
    return id
  },

  removeSession: (id: string) => {
    if (attentionTimers[id]) {
      clearTimeout(attentionTimers[id])
      delete attentionTimers[id]
    }
    set((state) => {
      const filtered = state.sessions.filter((s) => s.id !== id)
      let newActiveId = state.activeSessionId

      if (state.activeSessionId === id) {
        const idx = state.sessions.findIndex((s) => s.id === id)
        if (filtered.length === 0) {
          newActiveId = null
        } else if (idx < filtered.length) {
          newActiveId = filtered[idx].id
        } else {
          newActiveId = filtered[filtered.length - 1].id
        }
      }

      return {
        sessions: filtered,
        activeSessionId: newActiveId
      }
    })
    requestStateSave()
  },

  setActive: (id: string) => {
    set({ activeSessionId: id })
    requestStateSave()
  },

  renameSession: (id: string, title: string) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, title } : s))
    }))
    requestStateSave()
  },

  setColor: (id: string, color: SessionColor) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, color } : s))
    }))
    requestStateSave()
  },

  updatePid: (id: string, pid: number) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, pid } : s))
    }))
  },

  moveSessionToCollection: (sessionId: string, collectionId: string | null) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, collectionId } : s
      )
    }))
    requestStateSave()
  },

  addCollection: (name: string, parentId: string | null = null) => {
    const id = crypto.randomUUID()
    const newCollection: Collection = {
      id,
      name,
      parentId,
      collapsed: false,
      createdAt: Date.now()
    }
    set((state) => ({
      collections: [...state.collections, newCollection]
    }))
    requestStateSave()
    return id
  },

  removeCollection: (id: string) => {
    set((state) => {
      const collectionIdsToRemove = new Set<string>()
      const findDescendants = (collId: string) => {
        collectionIdsToRemove.add(collId)
        state.collections
          .filter((c) => c.parentId === collId)
          .forEach((c) => findDescendants(c.id))
      }
      findDescendants(id)

      return {
        collections: state.collections.filter((c) => !collectionIdsToRemove.has(c.id)),
        sessions: state.sessions.map((s) =>
          collectionIdsToRemove.has(s.collectionId ?? '') ? { ...s, collectionId: null } : s
        )
      }
    })
    requestStateSave()
  },

  renameCollection: (id: string, name: string) => {
    set((state) => ({
      collections: state.collections.map((c) =>
        c.id === id ? { ...c, name } : c
      )
    }))
    requestStateSave()
  },

  toggleCollectionCollapse: (id: string) => {
    set((state) => ({
      collections: state.collections.map((c) =>
        c.id === id ? { ...c, collapsed: !c.collapsed } : c
      )
    }))
    requestStateSave()
  },

  moveCollection: (collectionId: string, newParentId: string | null) => {
    set((state) => {
      const isDescendant = (parentId: string, childId: string): boolean => {
        if (parentId === childId) return true
        const children = state.collections.filter((c) => c.parentId === parentId)
        return children.some((c) => isDescendant(c.id, childId))
      }

      if (newParentId && isDescendant(collectionId, newParentId)) {
        return state
      }

      return {
        collections: state.collections.map((c) =>
          c.id === collectionId ? { ...c, parentId: newParentId } : c
        )
      }
    })
    requestStateSave()
  },

  toggleSidebar: () => {
    set((state) => ({ sidebarVisible: !state.sidebarVisible }))
    requestStateSave()
  },

  setSidebarWidth: (width: number) => {
    // Keep in sync with --sidebar-min-width / --sidebar-max-width in variables.css
    const clamped = Math.min(320, Math.max(160, width))
    set({ sidebarWidth: clamped })
    requestStateSave()
  },

  navigateNext: () => {
    const { sessions, activeSessionId } = get()
    if (sessions.length <= 1) return
    const idx = sessions.findIndex((s) => s.id === activeSessionId)
    const nextIdx = (idx + 1) % sessions.length
    set({ activeSessionId: sessions[nextIdx].id })
    requestStateSave()
  },

  navigatePrev: () => {
    const { sessions, activeSessionId } = get()
    if (sessions.length <= 1) return
    const idx = sessions.findIndex((s) => s.id === activeSessionId)
    const prevIdx = (idx - 1 + sessions.length) % sessions.length
    set({ activeSessionId: sessions[prevIdx].id })
    requestStateSave()
  },

  navigateToIndex: (index: number) => {
    const { sessions } = get()
    if (index >= 0 && index < sessions.length) {
      set({ activeSessionId: sessions[index].id })
      requestStateSave()
    }
  },

  setAttention: (id: string, eventType: string | null) => {
    if (eventType !== null) {
      // Setting attention: debounce if within 1 second window
      if (attentionTimers[id]) return
      attentionTimers[id] = setTimeout(() => {
        delete attentionTimers[id]
      }, 1000)
    } else {
      // Reset: clear debounce timer so next notification isn't blocked
      if (attentionTimers[id]) {
        clearTimeout(attentionTimers[id])
        delete attentionTimers[id]
      }
    }
    set((state) => ({
      attentionMap: { ...state.attentionMap, [id]: eventType }
    }))
  },

  resetAttention: (id: string) => {
    get().setAttention(id, null)
    window.terminalAPI.resetAttention(id)
  },

  setAiType: (id: string, aiType: 'claude' | 'opencode' | 'codex' | null) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, aiType } : s
      )
    }))
  }
}))

/** Build the session-owned part of persisted state. Workspace fields are
 *  filled by the statePersistence coordinator via workspaceStore. */
export function buildSessionPersistedState(): Pick<PersistedState, 'sessions' | 'collections' | 'activeSessionId' | 'sidebarVisible' | 'sidebarWidth'> {
  const state = useSessionStore.getState()
  return {
    sessions: state.sessions.map(({ pid, aiType, ...rest }) => rest),
    collections: state.collections,
    activeSessionId: state.activeSessionId,
    sidebarVisible: state.sidebarVisible,
    sidebarWidth: state.sidebarWidth
  }
}
