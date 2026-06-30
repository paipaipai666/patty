import type { SessionColor, ShellType, Collection } from '../renderer/store/sessionStore'
import type { PersistedPaneTree } from './paneTypes'
import type { PersistedWorkspace } from './workspaceTypes'

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
  /** Workspace list (post-migration). Each owns its sessions and pane tree. */
  workspaces: PersistedWorkspace[]
  /** Currently active workspace id, or null if no workspaces exist. */
  activeWorkspaceId: string | null
  /**
   * Legacy pre-workspace pane tree. Present in state files saved before the
   * workspace feature. Read by the normalization step on load; no longer
   * written by the save path once workspaceStore is wired.
   */
  paneTree?: PersistedPaneTree | null
  /** Legacy focused pane id (paired with `paneTree`). */
  focusedPaneId?: string | null
}
