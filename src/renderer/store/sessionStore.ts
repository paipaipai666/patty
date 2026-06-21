import { create } from 'zustand'

export type SessionColor = 'blue' | 'green' | 'amber' | 'coral' | 'purple' | 'gray'
export type ShellType = 'powershell' | 'pwsh' | 'cmd' | 'gitbash' | 'wsl'

export interface TerminalSession {
  id: string
  title: string
  color: SessionColor
  cwd: string
  shell: ShellType
  pid: number
  createdAt: number
}

const COLORS: SessionColor[] = ['blue', 'green', 'amber', 'coral', 'purple', 'gray']

function getNextColor(index: number): SessionColor {
  return COLORS[index % COLORS.length]
}

interface SessionStore {
  sessions: TerminalSession[]
  activeSessionId: string | null
  sidebarVisible: boolean
  sidebarWidth: number

  addSession: (opts?: { cwd?: string; shell?: string }) => string
  removeSession: (id: string) => void
  setActive: (id: string) => void
  renameSession: (id: string, title: string) => void
  setColor: (id: string, color: SessionColor) => void
  updatePid: (id: string, pid: number) => void
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  navigateNext: () => void
  navigatePrev: () => void
  navigateToIndex: (index: number) => void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  sidebarVisible: true,
  sidebarWidth: 220,

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
      createdAt: Date.now()
    }
    set((state) => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: id
    }))
    return id
  },

  removeSession: (id: string) => {
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
  },

  setActive: (id: string) => {
    set({ activeSessionId: id })
  },

  renameSession: (id: string, title: string) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, title } : s))
    }))
  },

  setColor: (id: string, color: SessionColor) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, color } : s))
    }))
  },

  updatePid: (id: string, pid: number) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, pid } : s))
    }))
  },

  toggleSidebar: () => {
    set((state) => ({ sidebarVisible: !state.sidebarVisible }))
  },

  setSidebarWidth: (width: number) => {
    const clamped = Math.min(320, Math.max(160, width))
    set({ sidebarWidth: clamped })
  },

  navigateNext: () => {
    const { sessions, activeSessionId } = get()
    if (sessions.length <= 1) return
    const idx = sessions.findIndex((s) => s.id === activeSessionId)
    const nextIdx = (idx + 1) % sessions.length
    set({ activeSessionId: sessions[nextIdx].id })
  },

  navigatePrev: () => {
    const { sessions, activeSessionId } = get()
    if (sessions.length <= 1) return
    const idx = sessions.findIndex((s) => s.id === activeSessionId)
    const prevIdx = (idx - 1 + sessions.length) % sessions.length
    set({ activeSessionId: sessions[prevIdx].id })
  },

  navigateToIndex: (index: number) => {
    const { sessions } = get()
    if (index >= 0 && index < sessions.length) {
      set({ activeSessionId: sessions[index].id })
    }
  }
}))
