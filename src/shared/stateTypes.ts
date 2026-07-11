import type { ShellType } from './settingsTypes'
import type { PersistedPaneTree } from './paneTypes'
import type { PersistedWorkspace } from './workspaceTypes'

export type SessionColor = 'blue' | 'green' | 'amber' | 'coral' | 'purple' | 'gray'

export interface Collection {
  id: string
  name: string
  parentId: string | null
  collapsed: boolean
  createdAt: number
}

export interface PersistedSession {
  id: string
  title: string
  color: SessionColor
  cwd: string
  shell: ShellType
  createdAt: number
  collectionId: string | null
}

export interface PersistedState {
  sessions: PersistedSession[]
  collections: Collection[]
  activeSessionId: string | null
  sidebarVisible: boolean
  sidebarWidth: number
  /** Workspace list (post-migration). Each owns its sessions and pane tree. */
  workspaces: PersistedWorkspace[]
  /** Currently active workspace id, or null if no workspaces exist. */
  activeWorkspaceId: string | null
  paneTree?: PersistedPaneTree | null
  focusedPaneId?: string | null
}
