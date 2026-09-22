import type { PaneTree, PersistedPaneTree } from './paneTypes'

                                                                             
export interface Workspace {
  id: string
  name: string
  collectionId: string | null
  paneTree: PaneTree
  focusedPaneId: string | null
}

                                                                                       
export interface PersistedWorkspace {
  id: string
  name: string
  collectionId: string | null
  paneTree: PersistedPaneTree | null
  focusedPaneId: string | null
}
