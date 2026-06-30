import type { PaneTree, PersistedPaneTree } from './paneTypes'

/** Runtime workspace: owns a set of sessions and their pane split layout. */
export interface Workspace {
  id: string
  name: string
  collectionId: string | null
  paneTree: PaneTree
  focusedPaneId: string | null
}

/** Persisted shape. paneTree uses PersistedPaneTree so it round-trips through JSON. */
export interface PersistedWorkspace {
  id: string
  name: string
  collectionId: string | null
  paneTree: PersistedPaneTree | null
  focusedPaneId: string | null
}
