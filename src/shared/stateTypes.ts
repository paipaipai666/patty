import type { SessionColor, ShellType, Collection } from '../renderer/store/sessionStore'
import type { PersistedPaneTree } from './paneTypes'

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
  /**
   * Split tree of visible panes. null/missing on legacy state files → the
   * loader normalizes to a single-leaf tree over `activeSessionId`. Legacy
   * readers ignore an unknown field, so new state files stay readable by
   * older versions.
   */
  paneTree: PersistedPaneTree | null
  /** Pane node id currently holding keyboard focus. */
  focusedPaneId: string | null
}
