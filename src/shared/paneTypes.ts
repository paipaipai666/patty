
   

export type SplitDirection = 'horizontal' | 'vertical'

                                                
export interface PaneLeaf {
  id: string
  type: 'leaf'
  sessionId: string
}

                                                            
export interface PaneSplit {
  id: string
  type: 'split'
  direction: SplitDirection
                                                                                     
  ratio: number
  first: PaneTree
  second: PaneTree
}

export type PaneTree = PaneLeaf | PaneSplit

                                                                              
export interface PersistedPaneLeaf {
  id: string
  type: 'leaf'
  sessionId: string
}

export interface PersistedPaneSplit {
  id: string
  type: 'split'
  direction: SplitDirection
  ratio: number
  first: PersistedPaneTree
  second: PersistedPaneTree
}

export type PersistedPaneTree = PersistedPaneLeaf | PersistedPaneSplit

                                                                                     
export function clampRatio(ratio: number): number {
  const MIN = 0.1
  const MAX = 1 - MIN
  return Math.min(MAX, Math.max(MIN, ratio))
}
