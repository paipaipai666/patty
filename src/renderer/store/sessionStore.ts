import { create } from 'zustand'
import type { PersistedState } from '../shared/stateTypes'

const perfEnabled = (window as any).terminalAPI?.perfEnabled === true

export type SessionColor = 'blue' | 'green' | 'amber' | 'coral' | 'purple' | 'gray'
export type ShellType = 'powershell' | 'pwsh' | 'cmd' | 'gitbash' | 'wsl'

export interface Collection {
  id: string
  name: string
  parentId: string | null
  collapsed: boolean
  createdAt: number
}

export interface TerminalSession {
  id: string
  title: string
  color: SessionColor
  cwd: string
  shell: ShellType
  pid: number
  createdAt: number
  collectionId: string | null
  aiType?: 'claude' | 'opencode' | null
}

export const SESSION_COLORS: SessionColor[] = ['blue', 'green', 'amber', 'coral', 'purple', 'gray']

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
  setAiType: (id: string, aiType: 'claude' | 'opencode' | null) => void

  loadState: () => Promise<PersistedState | null>
  saveState: () => Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
const attentionTimers: Record<string, ReturnType<typeof setTimeout>> = {}
let ipcCleanup: (() => void) | null = null

function debouncedSave(getState: () => SessionStore) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const state = getState()
    if (!state.loaded) return
    const t0 = perfEnabled ? performance.now() : 0
    const persistedState: PersistedState = {
      sessions: state.sessions.map(({ pid, aiType, ...rest }) => rest),
      collections: state.collections,
      activeSessionId: state.activeSessionId,
      sidebarVisible: state.sidebarVisible,
      sidebarWidth: state.sidebarWidth,
      // paneTree/focusedPaneId are owned by paneStore; sessionStore saves null
      // here and paneStore writes the real tree via its own save path. Keeping
      // the field present preserves the PersistedState shape and is harmless
      // (legacy readers ignore it). See commit "persist and restore pane tree".
      paneTree: null,
      focusedPaneId: null
    }
    if (perfEnabled) {
      const serializeTime = performance.now() - t0
      console.log(`[perf] state:serialize ${serializeTime.toFixed(2)}ms (${persistedState.sessions.length} sessions)`)
    }
    const saveStart = perfEnabled ? performance.now() : 0
    window.terminalAPI.stateSave(persistedState).then(() => {
      if (perfEnabled) {
        console.log(`[perf] state:save-ipc ${(performance.now() - saveStart).toFixed(2)}ms`)
      }
    }).catch(console.error)
  }, 500)
}

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
      // paneTree/focusedPaneId to paneStore without a second IPC or a
      // cross-store import. sessionStore does not own pane state.
      return state
    } catch (err) {
      console.error('Failed to load state:', err)
      set({ loaded: true })
      return null
    }
  },

  saveState: async () => {
    const state = get()
    const persistedState: PersistedState = {
      sessions: state.sessions.map(({ pid, aiType, ...rest }) => rest),
      collections: state.collections,
      activeSessionId: state.activeSessionId,
      sidebarVisible: state.sidebarVisible,
      sidebarWidth: state.sidebarWidth,
      paneTree: null,
      focusedPaneId: null
    }
    await window.terminalAPI.stateSave(persistedState)
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
    debouncedSave(get)
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
    debouncedSave(get)
  },

  setActive: (id: string) => {
    set({ activeSessionId: id })
    debouncedSave(get)
  },

  renameSession: (id: string, title: string) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, title } : s))
    }))
    debouncedSave(get)
  },

  setColor: (id: string, color: SessionColor) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, color } : s))
    }))
    debouncedSave(get)
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
    debouncedSave(get)
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
    debouncedSave(get)
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
    debouncedSave(get)
  },

  renameCollection: (id: string, name: string) => {
    set((state) => ({
      collections: state.collections.map((c) =>
        c.id === id ? { ...c, name } : c
      )
    }))
    debouncedSave(get)
  },

  toggleCollectionCollapse: (id: string) => {
    set((state) => ({
      collections: state.collections.map((c) =>
        c.id === id ? { ...c, collapsed: !c.collapsed } : c
      )
    }))
    debouncedSave(get)
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
    debouncedSave(get)
  },

  toggleSidebar: () => {
    set((state) => ({ sidebarVisible: !state.sidebarVisible }))
    debouncedSave(get)
  },

  setSidebarWidth: (width: number) => {
    // Keep in sync with --sidebar-min-width / --sidebar-max-width in variables.css
    const clamped = Math.min(320, Math.max(160, width))
    set({ sidebarWidth: clamped })
    debouncedSave(get)
  },

  navigateNext: () => {
    const { sessions, activeSessionId } = get()
    if (sessions.length <= 1) return
    const idx = sessions.findIndex((s) => s.id === activeSessionId)
    const nextIdx = (idx + 1) % sessions.length
    set({ activeSessionId: sessions[nextIdx].id })
    debouncedSave(get)
  },

  navigatePrev: () => {
    const { sessions, activeSessionId } = get()
    if (sessions.length <= 1) return
    const idx = sessions.findIndex((s) => s.id === activeSessionId)
    const prevIdx = (idx - 1 + sessions.length) % sessions.length
    set({ activeSessionId: sessions[prevIdx].id })
    debouncedSave(get)
  },

  navigateToIndex: (index: number) => {
    const { sessions } = get()
    if (index >= 0 && index < sessions.length) {
      set({ activeSessionId: sessions[index].id })
      debouncedSave(get)
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

  setAiType: (id: string, aiType: 'claude' | 'opencode' | null) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, aiType } : s
      )
    }))
  }
}))
