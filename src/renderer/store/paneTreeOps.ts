/**
 * Pure, immutable tree operations for the pane split tree.
 *
 * Every function returns a new tree (or a result object) and never mutates
 * its input. Kept dependency-free so it can be unit-tested in isolation and
 * reused by paneStore without pulling in zustand/React.
 */
import type { PaneTree, PaneLeaf, PaneSplit, SplitDirection } from '../../shared/paneTypes'
import { clampRatio } from '../../shared/paneTypes'
import { newPaneId } from '../../shared/paneTreeNormalize'

/** A update applied to the node whose id == targetId. Returns the new subtree. */
type NodeUpdate = (node: PaneTree) => PaneTree

/** Recursively rebuild the tree, replacing the node with id `targetId` via `update`. */
function updateNode(tree: PaneTree, targetId: string, update: NodeUpdate): PaneTree {
  if (tree.id === targetId) return update(tree)
  if (tree.type === 'split') {
    return { ...tree, first: updateNode(tree.first, targetId, update), second: updateNode(tree.second, targetId, update) }
  }
  return tree
}

/**
 * Split a leaf node into a split holding the original session and a new leaf.
 * The new leaf's sessionId is `newSessionId`. `side` controls which side the
 * NEW session lands on; the original session takes the other side. Ratio is
 * the original session's share after split.
 *
 * If `targetId` points at a split (already divided), this is a no-op — only
 * leaves can be split. The caller is expected to split the focused leaf.
 */
export function splitLeaf(
  tree: PaneTree,
  targetLeafId: string,
  newSessionId: string,
  direction: SplitDirection,
  side: 'first' | 'second' = 'second',
  ratio = 0.5
): PaneTree {
  const newLeaf: PaneLeaf = { id: newPaneId(), type: 'leaf', sessionId: newSessionId }
  const origRatio = clampRatio(ratio)

  return updateNode(tree, targetLeafId, (node) => {
    if (node.type !== 'leaf') return node // only leaves split
    const origLeaf: PaneLeaf = { id: newPaneId(), type: 'leaf', sessionId: node.sessionId }
    // Re-id the original leaf so the focused-pane tracking moves to the
    // surviving original rather than the stale parent. The new leaf keeps
    // its fresh id.
    const first = side === 'first' ? newLeaf : origLeaf
    const second = side === 'first' ? origLeaf : newLeaf
    const split: PaneSplit = {
      id: node.id, // reuse the leaf's id as the split id (focus stays put)
      type: 'split',
      direction,
      ratio: side === 'first' ? 1 - origRatio : origRatio,
      first,
      second
    }
    return split
  })
}

/**
 * Remove the leaf with id `leafId`. If it was half of a split, the sibling
 * subtree takes the parent's place (collapse). Recurses upward: when a split
 * collapses to one child, that child replaces the split, preserving depth.
 *
 * Returns the new tree, or null if the tree becomes empty (the only leaf was
 * removed). Also returns the id of the pane that should receive focus next
 * (the nearest preceding leaf in document order), or null if none.
 */
export interface RemoveResult {
  tree: PaneTree | null
  nextFocusId: string | null
}

export function removeLeaf(tree: PaneTree, leafId: string): RemoveResult {
  // Find the leaf to confirm it exists; if not, no-op.
  const target = findLeaf(tree, leafId)
  if (!target) return { tree, nextFocusId: null }

  const after = removeNode(tree, leafId)
  if (after === null) return { tree: null, nextFocusId: null }

  // Choose focus: the first leaf of the collapsed result. This is a stable,
  // predictable choice (top-left-most pane) and avoids tracking the sibling
  // explicitly through the recursion.
  const next = firstLeafId(after)
  return { tree: after, nextFocusId: next }
}

/** Remove a node by id; returns null if the whole tree is gone. */
function removeNode(tree: PaneTree, removeId: string): PaneTree | null {
  if (tree.id === removeId) return null // this node is the one being removed
  if (tree.type === 'leaf') return tree

  const first = removeNode(tree.first, removeId)
  const second = removeNode(tree.second, removeId)

  if (first && second) return { ...tree, first, second }
  // One side gone → collapse to the survivor.
  return first ?? second ?? null
}

/** Replace the session of the leaf with id `leafId`. No-op if not a leaf. */
export function replaceLeafSession(tree: PaneTree, leafId: string, sessionId: string): PaneTree {
  return updateNode(tree, leafId, (node) =>
    node.type === 'leaf' ? { ...node, sessionId } : node
  )
}

/** Adjust a split's ratio. No-op if target is a leaf. Clamped to usable range. */
export function setRatio(tree: PaneTree, splitId: string, ratio: number): PaneTree {
  return updateNode(tree, splitId, (node) =>
    node.type === 'split' ? { ...node, ratio: clampRatio(ratio) } : node
  )
}

/**
 * Insert a new leaf as a neighbor of `targetPaneId` along `direction`, on
 * `side`. Used by sidebar drag-in: drop on the right edge of a pane → insert
 * as its right sibling via a horizontal split.
 *
 * `targetPaneId` may be a leaf or a split; the new leaf becomes the
 * `side` child of a new split that replaces the target, and the target
 * subtree becomes the other child. Ratio is the target's share after insert.
 */
export function insertNeighbor(
  tree: PaneTree,
  targetPaneId: string,
  newSessionId: string,
  direction: SplitDirection,
  side: 'first' | 'second',
  ratio = 0.5
): PaneTree {
  const newLeaf: PaneLeaf = { id: newPaneId(), type: 'leaf', sessionId: newSessionId }
  const targetRatio = clampRatio(ratio)

  return updateNode(tree, targetPaneId, (node) => {
    const split: PaneSplit = {
      id: newPaneId(),
      type: 'split',
      direction,
      ratio: side === 'first' ? 1 - targetRatio : targetRatio,
      first: side === 'first' ? newLeaf : node,
      second: side === 'first' ? node : newLeaf
    }
    return split
  })
}

/** Find a leaf node by id. */
export function findLeaf(tree: PaneTree, leafId: string): PaneLeaf | null {
  if (tree.type === 'leaf') return tree.id === leafId ? tree : null
  return findLeaf(tree.first, leafId) ?? findLeaf(tree.second, leafId)
}

/** First leaf id in document order (top-left-most). */
export function firstLeafId(tree: PaneTree): string {
  if (tree.type === 'leaf') return tree.id
  return firstLeafId(tree.first)
}

/** All leaf pane ids in document order. */
export function collectLeafIds(tree: PaneTree | null): string[] {
  if (!tree) return []
  if (tree.type === 'leaf') return [tree.id]
  return [...collectLeafIds(tree.first), ...collectLeafIds(tree.second)]
}

/** All session ids currently visible in the tree, in document order. */
export function collectSessionIds(tree: PaneTree | null): string[] {
  if (!tree) return []
  if (tree.type === 'leaf') return [tree.sessionId]
  return [...collectSessionIds(tree.first), ...collectSessionIds(tree.second)]
}

/** Nearest leaf id following `currentId` in document order, wrapping around. */
export function nextLeafId(tree: PaneTree, currentId: string | null): string | null {
  const ids = collectLeafIds(tree)
  if (ids.length === 0) return null
  if (currentId === null) return ids[0]
  const idx = ids.indexOf(currentId)
  if (idx === -1) return ids[0]
  return ids[(idx + 1) % ids.length]
}

/** Nearest leaf id preceding `currentId` in document order, wrapping around. */
export function prevLeafId(tree: PaneTree, currentId: string | null): string | null {
  const ids = collectLeafIds(tree)
  if (ids.length === 0) return null
  if (currentId === null) return ids[ids.length - 1]
  const idx = ids.indexOf(currentId)
  if (idx === -1) return ids[ids.length - 1]
  return ids[(idx - 1 + ids.length) % ids.length]
}
