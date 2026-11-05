import { create } from 'zustand'
import { activityFromStatus, type AgentActivity, type AgentType, type AgentStates, type AgentUpdate } from '../../shared/agentTypes'
import { programSession, type ProgramBatch, type ProgramStates, type ProgramUpdate } from '../../shared/programTypes'
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
  aiType?: AgentType | null
                                                                 
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
  agentStates: AgentStates
  agentRevisions: Readonly<Record<string, number | undefined>>
  agentRevisionFloor: number
  programStates: ProgramStates
  programRevisionFloor: number

                                                                        
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

  applyAgentUpdate: (update: AgentUpdate) => void
  applyProgramBatch: (batch: ProgramBatch) => void
  markAgentRead: (id: string) => void
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
  sidebarWidth: 264,
  sidebarTransitioning: false,
  loaded: false,
  agentStates: {},
  agentRevisions: {},
  agentRevisionFloor: 0,
  programStates: {},
  programRevisionFloor: 0,
  draggingSessionId: null,

  loadState: async () => {
    if (ipcCleanup) ipcCleanup()
    let cancelled = false
    let unsubscribe: (() => void) | null = null
    let unsubscribePrograms: (() => void) | null = null
    const cleanup = () => {
      cancelled = true
      unsubscribe?.()
      unsubscribePrograms?.()
      if (ipcCleanup === cleanup) ipcCleanup = null
    }
    ipcCleanup = cleanup
    try {
      const pendingUpdates = new Map<string, AgentUpdate>()
      const pendingPrograms = new Map<string, ProgramUpdate>()
      let stateReady = false
      const listener = window.terminalAPI.onAgentUpdate((update) => {
        if (cancelled) return
        if (stateReady) get().applyAgentUpdate(update)
        else if (update.revision > (pendingUpdates.get(update.paneId)?.revision ?? 0)) pendingUpdates.set(update.paneId, update)
      })
      unsubscribe = listener.unsubscribe
      const programs = window.terminalAPI.onProgramUpdate(batch => {
        if (cancelled) return
        if (stateReady) get().applyProgramBatch(batch)
        else for (const update of batch.programs) {
          if (update.revision > (pendingPrograms.get(update.paneId)?.revision ?? 0)) pendingPrograms.set(update.paneId, update)
        }
      })
      unsubscribePrograms = programs.unsubscribe
      await Promise.all([listener.ready, programs.ready])
      if (cancelled) return null
      const state = await window.terminalAPI.stateLoad()
      if (cancelled) return null
      const [snapshot, programSnapshot] = await Promise.all([
        window.terminalAPI.agentStateSnapshot(), window.terminalAPI.programStateSnapshot()
      ])
      if (cancelled) return null
      const updates = new Map(snapshot.agents.map((update) => [update.paneId, update]))
      for (const update of pendingUpdates.values()) {
        if (update.revision > snapshot.revision && update.revision > (updates.get(update.paneId)?.revision ?? 0)) updates.set(update.paneId, update)
      }
      const activities = new Map<string, AgentActivity>()
      const programUpdates = new Map(programSnapshot.programs.map(update => [update.paneId, update]))
      for (const update of pendingPrograms.values()) {
        if (update.revision > programSnapshot.revision && update.revision > (programUpdates.get(update.paneId)?.revision ?? 0)) programUpdates.set(update.paneId, update)
      }
      const programStates = Object.fromEntries(state.sessions.flatMap(session => {
        const update = programUpdates.get(session.id)
        return update ? [[session.id, programSession(update)]] : []
      }))
      const revisions = new Map<string, number>()
      const sessions = state.sessions.map((session) => {
        const update = updates.get(session.id)
        if (update) {
          revisions.set(session.id, update.revision)
          if (update.agent) activities.set(session.id, activityFromStatus(update.agent.status))
        }
        return { ...session, createdAt: session.createdAt ?? Date.now(), pid: 0, aiType: update?.agent?.aiType ?? null }
      })
      set({
        sessions, collections: state.collections, activeSessionId: state.activeSessionId,
        sidebarVisible: state.sidebarVisible, sidebarWidth: state.sidebarWidth, loaded: true,
        agentStates: Object.fromEntries(activities), agentRevisions: Object.fromEntries(revisions), agentRevisionFloor: snapshot.revision,
        programStates, programRevisionFloor: programSnapshot.revision
      })
      stateReady = true
      pendingUpdates.clear()
      pendingPrograms.clear()
      return state
    } catch (err) {
      if (!cancelled) {
        cleanup()
        console.error('Failed to load state:', err)
        set({ loaded: true })
      }
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

      const agentStates = { ...state.agentStates }
      delete agentStates[id]
      const agentRevisions = { ...state.agentRevisions }
      delete agentRevisions[id]
      const programStates = { ...state.programStates }
      delete programStates[id]

      return {
        sessions: filtered,
        activeSessionId: newActiveId,
        agentStates,
        agentRevisions,
        programStates
      }
    })
    markDirty()
  },

  setActive: (id: string) => {
    set({ activeSessionId: id })
    get().markAgentRead(id)
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
    get().setActive(sessions[nextIdx].id)
    markDirty()
  },

  navigatePrev: () => {
    const { sessions, activeSessionId } = get()
    if (sessions.length <= 1) return
    const idx = sessions.findIndex((s) => s.id === activeSessionId)
    const prevIdx = (idx - 1 + sessions.length) % sessions.length
    get().setActive(sessions[prevIdx].id)
    markDirty()
  },

  navigateToIndex: (index: number) => {
    const { sessions } = get()
    if (index >= 0 && index < sessions.length) {
      get().setActive(sessions[index].id)
      markDirty()
    }
  },

  applyAgentUpdate: ({ paneId, revision, agent }) => {
    set((state) => {
      const session = state.sessions.find((item) => item.id === paneId)
      if (!session || revision <= state.agentRevisionFloor || revision <= (state.agentRevisions[paneId] ?? 0)) return state
      const agentRevisions = { ...state.agentRevisions, [paneId]: revision }
      const previous = state.agentStates[paneId]
      const aiType = agent?.aiType ?? null
      if (previous?.status === agent?.status && session.aiType === aiType) return { agentRevisions }
      const agentStates = agent
        ? { ...state.agentStates, [paneId]: activityFromStatus(agent.status) }
        : { ...state.agentStates }
      if (!agent) delete agentStates[paneId]
      return {
        agentStates,
        agentRevisions,
        sessions: session.aiType === aiType ? state.sessions
          : state.sessions.map((item) => item.id === paneId ? { ...item, aiType } : item)
      }
    })
  },

  applyProgramBatch: batch => {
    set(state => {
      const programStates = { ...state.programStates }
      const sessions = new Set(state.sessions.map(session => session.id))
      let changed = false
      for (const update of batch.programs) {
        if (!sessions.has(update.paneId)
          || update.revision <= state.programRevisionFloor || update.revision <= (programStates[update.paneId]?.revision ?? 0)) continue
        programStates[update.paneId] = programSession(update, programStates[update.paneId])
        changed = true
      }
      return changed ? { programStates } : state
    })
  },

  markAgentRead: (id: string) => {
    set((state) => {
      const activity = state.agentStates[id]
      if (activity) return activity.unread ? { agentStates: { ...state.agentStates, [id]: { ...activity, unread: false } } } : state
      const program = state.programStates[id]
      if (!program?.activity?.unread || !program.program) return state
      return { programStates: { ...state.programStates, [id]: { ...program, readThrough: Math.max(program.readThrough, program.program.revision), activity: { ...program.activity, unread: false } } } }
    })
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
