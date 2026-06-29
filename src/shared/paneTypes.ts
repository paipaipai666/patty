/**
 * Pane tree model for the multi-terminal split layout.
 *
 * The terminal area is a single recursive split tree. A leaf holds one
 * terminal session; a split divides its area between two subtrees along a
 * direction with a `ratio` in (0, 1) describing the first subtree's share.
 *
 * Default state is a single leaf = today's single-tab behavior, so the model
 * is backward compatible. Sessions not present in the tree remain as
 * background tabs in the sidebar.
 *
 * Tree nodes are immutable: every operation returns a new tree. Node ids are
 * stable across edits so React keys and focus tracking survive restructures.
 */

export type SplitDirection = 'horizontal' | 'vertical'

/** A leaf node holding one terminal session. */
export interface PaneLeaf {
  id: string
  type: 'leaf'
  sessionId: string
}

/** An internal node splitting area between two subtrees. */
export interface PaneSplit {
  id: string
  type: 'split'
  direction: SplitDirection
  /** Share of the area assigned to `first`; `second` gets the rest. Range (0, 1). */
  ratio: number
  first: PaneTree
  second: PaneTree
}

export type PaneTree = PaneLeaf | PaneSplit

/** Shape persisted to disk. sessionId is the only field that must survive. */
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

/** Clamp a ratio into the usable range, keeping a minimum visible share per side. */
export function clampRatio(ratio: number): number {
  const MIN = 0.1
  const MAX = 1 - MIN
  return Math.min(MAX, Math.max(MIN, ratio))
}
