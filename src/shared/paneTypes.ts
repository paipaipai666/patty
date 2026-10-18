
   

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

export const MIN_PANE_PX = 80

export function clampRatioToPixels(ratio: number, containerPx: number): number {
  if (!Number.isFinite(containerPx) || containerPx <= 0) return clampRatio(ratio)
  if (containerPx < MIN_PANE_PX * 2) return 0.5
  const floor = MIN_PANE_PX / containerPx
  const ceiling = 1 - floor
  return Math.min(ceiling, Math.max(floor, clampRatio(ratio)))
}
