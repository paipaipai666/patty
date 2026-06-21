import type { SessionColor, ShellType, Collection } from '../renderer/store/sessionStore'

export interface PersistedSession {
  id: string
  title: string
  color: SessionColor
  cwd: string
  shell: ShellType
  collectionId: string | null
}

export interface PersistedState {
  sessions: PersistedSession[]
  collections: Collection[]
  activeSessionId: string | null
  sidebarVisible: boolean
  sidebarWidth: number
}
