import { create } from 'zustand'
import type { PersistedState, SessionColor, Collection } from '../../shared/stateTypes'
import type { ShellType, SshTarget } from '../../shared/settingsTypes'
import { markDirty } from './dirtyScheduler'

export type { Collection }

export interface TerminalSession {
  id: string
  title: string
  color: SessionColor
  cwd: string
  shell: ShellType
  pid: number
  createdAt: number
  collectionId: string | null
  aiType?: 'claude' | 'opencode' | 'codex' | 'omp' | 'qwen' | 'copilot' | null
                                                                 
  ssh?: SshTarget | null
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

                                                                 
  sidebarTransitioning: boolean
  loaded: boolean
  attentionMap: Record<string, string | null>

                                                                        
  draggingSessionId: string | null

  addSession: (opts?: { cwd?: string; shell?: string; collectionId?: string | null; title?: string; ssh?: SshTarget | null }) => string
  removeSession: (id: string) => void
  setActive: (id: string) => void
  renameSession: (id: string, title: string) => void
  setColor: (id: string, color: SessionColor) => void
  updatePid: (id: string, pid: number) => void
  updateCwd: (id: string, cwd: string) => void
  moveSessionToCollection: (sessionId: string, collectionId: string | null) => void

  addCollection: (name: string, parentId?: string | null) => string
  removeCollection: (id: string) => void
  renameCollection: (id: string, name: string) => void
  toggleCollectionCollapse: (id: string) => void
  moveCollection: (collectionId: string, newParentId: string | null) => void

  toggleSidebar: () => void

                                 
  endSidebarTransition: () => void
  setSidebarWidth: (width: number) => void
  navigateNext: () => void
  navigatePrev: () => void
  navigateToIndex: (index: number) => void

  setAttention: (id: string, eventType: string | null) => void
  resetAttention: (id: string) => void
  setAiType: (id: string, aiType: 'claude' | 'opencode' | 'codex' | 'omp' | 'qwen' | 'copilot' | null) => void
  setDraggingSession: (id: string | null) => void

  loadState: () => Promise<PersistedState | null>
}

let ipcCleanup: (() => void) | null = null

const SIDEBAR_TRANSITION_FALLBACK_MS = 450
let sidebarTransitionTimer: ReturnType<typeof setTimeout> | null = null

export function teardownSessionIPC() {
  if (ipcCleanup) ipcCleanup()

  if (sidebarTransitionTimer) {
    clearTimeout(sidebarTransitionTimer)
    sidebarTransitionTimer = null
  }
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  collections: [],
  activeSessionId: null,
  sidebarVisible: true,
  sidebarWidth: 220,
  sidebarTransitioning: false,
  loaded: false,
  attentionMap: {},
  draggingSessionId: null,

  loadState: async () => {
    try {

      if (ipcCleanup) ipcCleanup()
      const offAttention = window.terminalAPI.onAttentionChange((sessionId, eventType, aiType) => {
        get().setAttention(sessionId, eventType)
        if (aiType !== undefined) {
          get().setAiType(sessionId, (aiType ?? null) as 'claude' | 'opencode' | 'codex' | 'omp' | 'qwen' | 'copilot' | null)
        }
      })



      ipcCleanup = () => {
        offAttention()
        ipcCleanup = null
      }

      const state = await window.terminalAPI.stateLoad()
      set({
        sessions: state.sessions.map((s) => ({ ...s, createdAt: s.createdAt ?? Date.now(), pid: 0, aiType: null })),
        collections: state.collections,
        activeSessionId: state.activeSessionId,
        sidebarVisible: state.sidebarVisible,
        sidebarWidth: state.sidebarWidth,
        loaded: true
      })


      return state
    } catch (err) {
      console.error('Failed to load state:', err)
      set({ loaded: true })
      return null
    }
  },

  addSession: (opts = {}) => {
    const id = crypto.randomUUID()
    const { sessions } = get()
    const shellName = (opts.shell || 'powershell') as ShellType
    const newSession: TerminalSession = {
      id,
      title: opts.title ?? `Terminal ${sessions.length + 1}`,
      color: getNextColor(sessions.length),
      cwd: opts.cwd || '',
      shell: shellName,
      pid: 0,
      createdAt: Date.now(),
      collectionId: opts.collectionId ?? null,
      ssh: opts.ssh ?? null
    }
    set((state) => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: id
    }))
    markDirty()
    return id
  },

  removeSession: (id: string) => {

    const api = (window as any)?.terminalAPI
    if (api && typeof api.kill === 'function') {
      api.kill(id)
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
    markDirty()
  },

  setActive: (id: string) => {
    set({ activeSessionId: id })
  },

  setDraggingSession: (id: string | null) => {
    set({ draggingSessionId: id })
  },

  renameSession: (id: string, title: string) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, title } : s))
    }))
    markDirty()
  },

  setColor: (id: string, color: SessionColor) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, color } : s))
    }))
    markDirty()
  },

  updatePid: (id: string, pid: number) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, pid } : s))
    }))
  },

  updateCwd: (id: string, cwd: string) => {
    const session = get().sessions.find((s) => s.id === id)
    if (!session || session.cwd === cwd) return
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, cwd } : s))
    }))
    markDirty()
  },

  moveSessionToCollection: (sessionId: string, collectionId: string | null) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, collectionId } : s
      )
    }))
    markDirty()
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
    markDirty()
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
    markDirty()
  },

  renameCollection: (id: string, name: string) => {
    set((state) => ({
      collections: state.collections.map((c) =>
        c.id === id ? { ...c, name } : c
      )
    }))
    markDirty()
  },

  toggleCollectionCollapse: (id: string) => {
    set((state) => ({
      collections: state.collections.map((c) =>
        c.id === id ? { ...c, collapsed: !c.collapsed } : c
      )
    }))
    markDirty()
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
    markDirty()
  },

  toggleSidebar: () => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches


    if (prefersReduced) {
      set((state) => ({ sidebarVisible: !state.sidebarVisible }))
      markDirty()
      return
    }

    set((state) => ({ sidebarVisible: !state.sidebarVisible, sidebarTransitioning: true }))
    if (sidebarTransitionTimer) clearTimeout(sidebarTransitionTimer)
    sidebarTransitionTimer = setTimeout(() => {
      sidebarTransitionTimer = null
      set({ sidebarTransitioning: false })
    }, SIDEBAR_TRANSITION_FALLBACK_MS)
    markDirty()
  },

  endSidebarTransition: () => {
    if (sidebarTransitionTimer) {
      clearTimeout(sidebarTransitionTimer)
      sidebarTransitionTimer = null
    }
    if (get().sidebarTransitioning) {
      set({ sidebarTransitioning: false })
    }
  },

  setSidebarWidth: (width: number) => {

    const clamped = Math.min(320, Math.max(160, width))
    set({ sidebarWidth: clamped })
    markDirty()
  },

  navigateNext: () => {
    const { sessions, activeSessionId } = get()
    if (sessions.length <= 1) return
    const idx = sessions.findIndex((s) => s.id === activeSessionId)
    const nextIdx = (idx + 1) % sessions.length
    set({ activeSessionId: sessions[nextIdx].id })
    markDirty()
  },

  navigatePrev: () => {
    const { sessions, activeSessionId } = get()
    if (sessions.length <= 1) return
    const idx = sessions.findIndex((s) => s.id === activeSessionId)
    const prevIdx = (idx - 1 + sessions.length) % sessions.length
    set({ activeSessionId: sessions[prevIdx].id })
    markDirty()
  },

  navigateToIndex: (index: number) => {
    const { sessions } = get()
    if (index >= 0 && index < sessions.length) {
      set({ activeSessionId: sessions[index].id })
      markDirty()
    }
  },

  setAttention: (id: string, eventType: string | null) => {

    set((state) => {
      if (eventType === null) {

        if (!(id in state.attentionMap)) return state
        const next = { ...state.attentionMap }
        delete next[id]
        return { attentionMap: next }
      }
      if (state.attentionMap[id] === eventType) return state
      return { attentionMap: { ...state.attentionMap, [id]: eventType } }
    })
  },

  resetAttention: (id: string) => {
    get().setAttention(id, null)
  },

  setAiType: (id: string, aiType: 'claude' | 'opencode' | 'codex' | 'omp' | 'qwen' | 'copilot' | null) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, aiType } : s
      )
    }))
  }
}))


                                                                   
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
