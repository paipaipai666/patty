/**
 * Normalization helpers for the pane tree.
 *
 * Pure functions used both at load time (turn a persisted/legacy tree into a
 * trusted one) and inside workspaceStore operations. Kept out of the store so
 * it imports nothing that depends on React/zustand.
 */
import type {
  PersistedPaneTree,
  PersistedPaneLeaf,
  PersistedPaneSplit,
  PaneTree,
  PaneLeaf,
  PaneSplit,
  SplitDirection
} from './paneTypes'
import { clampRatio } from './paneTypes'

/** Generate a new pane node id. Centralized so the format is consistent. */
export function newPaneId(): string {
  // crypto.randomUUID is available in both renderer and main (Node 19+/Electron 33+).
  return crypto.randomUUID()
}

function isPersistedLeaf(node: unknown): node is PersistedPaneLeaf {
  return typeof node === 'object' && node !== null && (node as any).type === 'leaf'
}

function isPersistedSplit(node: unknown): node is PersistedPaneSplit {
  return typeof node === 'object' && node !== null && (node as any).type === 'split'
}

/**
 * Convert a persisted tree (untrusted, possibly legacy/missing) into a trusted
 * runtime tree. Drops any leaf whose sessionId is no longer in `knownSessionIds`
 * and collapses the resulting empty splits. Returns null if nothing survives.
 *
 * Use this when restoring from disk, where sessions may have been removed
 * since the tree was saved.
 */
export function normalizePersistedTree(
  node: PersistedPaneTree | null | undefined,
  knownSessionIds: Set<string>
): PaneTree | null {
  if (!node) return null

  if (isPersistedLeaf(node)) {
    if (!knownSessionIds.has(node.sessionId)) return null
    const leaf: PaneLeaf = { id: node.id, type: 'leaf', sessionId: node.sessionId }
    return leaf
  }

  if (isPersistedSplit(node)) {
    const first = normalizePersistedTree(node.first, knownSessionIds)
    const second = normalizePersistedTree(node.second, knownSessionIds)
    if (first && second) {
      const split: PaneSplit = {
        id: node.id,
        type: 'split',
        direction: node.direction,
        ratio: clampRatio(node.ratio),
        first,
        second
      }
      return split
    }
    // One side survived a prune → collapse to the survivor (drop this split).
    return first ?? second ?? null
  }

  return null
}

/**
 * Build a single-leaf tree over a session. Used as the default/legacy fallback
 * when there is no persisted tree, or when the persisted tree prunes away to
 * nothing but a session still exists.
 */
export function singleLeafTree(sessionId: string, paneId: string = newPaneId()): PaneTree {
  return { id: paneId, type: 'leaf', sessionId }
}

/** Convert a runtime tree back to the persisted shape (currently identity-like). */
export function toPersistedTree(node: PaneTree | null): PersistedPaneTree | null {
  if (!node) return null
  if (node.type === 'leaf') {
    return { id: node.id, type: 'leaf', sessionId: node.sessionId }
  }
  return {
    id: node.id,
    type: 'split',
    direction: node.direction as SplitDirection,
    ratio: node.ratio,
    first: toPersistedTree(node.first)!,
    second: toPersistedTree(node.second)!
  }
}

/** Find a leaf node by pane id, if present. */
export function findLeafById(node: PaneTree | null, paneId: string): PaneLeaf | null {
  if (!node) return null
  if (node.type === 'leaf') return node.id === paneId ? node : null
  return findLeafById(node.first, paneId) ?? findLeafById(node.second, paneId)
}

/** True if `sessionId` is currently a leaf in the tree. */
export function treeHasSession(node: PaneTree | null, sessionId: string): boolean {
  if (!node) return false
  if (node.type === 'leaf') return node.sessionId === sessionId
  return treeHasSession(node.first, sessionId) || treeHasSession(node.second, sessionId)
}

/** First (leftmost / topmost) leaf id in depth-first order, or null. */
export function firstLeafId(node: PaneTree | null): string | null {
  if (!node) return null
  if (node.type === 'leaf') return node.id
  return firstLeafId(node.first)
}

/** Collect every session id referenced by leaves in the tree. */
export function collectTreeSessionIds(node: PaneTree | null): Set<string> {
  const ids = new Set<string>()
  function walk(n: PaneTree): void {
    if (n.type === 'leaf') {
      ids.add(n.sessionId)
      return
    }
    walk(n.first)
    walk(n.second)
  }
  if (node) walk(node)
  return ids
}
