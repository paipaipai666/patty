import { create } from 'zustand'
import type { PaneTree, SplitDirection } from '../../shared/paneTypes'
import {
  normalizePersistedTree,
  singleLeafTree,
  toPersistedTree,
  newPaneId,
  treeHasSession
} from '../../shared/paneTreeNormalize'
import {
  splitLeaf,
  removeLeaf,
  replaceLeafSession,
  setRatio,
  insertNeighbor,
  findLeaf,
  firstLeafId,
  nextLeafId,
  prevLeafId,
  collectSessionIds
} from './paneTreeOps'

/**
 * Pane split-tree store.
 *
 * Holds the visible pane tree and the focused pane id. All tree transforms
 * go through the pure functions in paneTreeOps; this store only wires them to
 * state + persistence and keeps focus consistent.
 *
 * Coordination with sessionStore is done by the caller (App): after
 * sessionStore.addSession returns a new sessionId, the caller calls the
 * relevant paneStore op (replaceFocusedLeaf / splitFocused). The two stores
 * do not import each other, avoiding a dependency cycle.
 */

interface PaneStore {
  tree: PaneTree | null
  focusedPaneId: string | null
  /** True once loadFromPersisted has run, so renderers can avoid stale flashes. */
  loaded: boolean

  /** Restore the tree from persisted state + the live session ids. */
  loadFromPersisted: (
    persistedTree: import('../../shared/paneTypes').PersistedPaneTree | null,
    persistedFocusedId: string | null,
    knownSessionIds: string[],
    fallbackSessionId: string | null
  ) => void

  /** Split the focused pane: new session `newSessionId` takes `side`. */
  splitFocused: (
    newSessionId: string,
    direction: SplitDirection,
    side?: 'first' | 'second'
  ) => void

  /** Replace the focused leaf's session with `sessionId` (sidebar click on a background session). */
  replaceFocusedLeaf: (sessionId: string) => void

  /** Drop-in from sidebar: insert `sessionId` as a neighbor of the focused pane. */
  insertNeighborFocused: (
    sessionId: string,
    direction: SplitDirection,
    side: 'first' | 'second'
  ) => void

  /** Remove the focused pane's leaf from the tree; focus moves to nearest. */
  closeFocused: () => void

  /** Remove every leaf referencing `sessionId` (called when a session is deleted). */
  removeSessionEverywhere: (sessionId: string) => void

  /** Set a split's ratio (drag sash). */
  setSplitRatio: (splitId: string, ratio: number) => void

  /** Move focus to a pane. */
  focusPane: (paneId: string) => void
  focusNext: () => void
  focusPrev: () => void

  /** Ensure `sessionId` is visible: if absent, replace the focused leaf with it. Returns true if it was already present. */
  ensureVisible: (sessionId: string) => boolean

  /** Persisted shape for the save path. */
  toPersisted: () => { paneTree: import('../../shared/paneTypes').PersistedPaneTree | null; focusedPaneId: string | null }
}

export const usePaneStore = create<PaneStore>((set, get) => ({
  tree: null,
  focusedPaneId: null,
  loaded: false,

  loadFromPersisted: (persistedTree, persistedFocusedId, knownSessionIds, fallbackSessionId) => {
    const known = new Set(knownSessionIds)
    let tree = normalizePersistedTree(persistedTree, known)

    if (!tree) {
      // No persisted tree, or it pruned away entirely.
      if (fallbackSessionId && known.has(fallbackSessionId)) {
        tree = singleLeafTree(fallbackSessionId)
      }
    }

    // Validate persisted focus still exists; otherwise pick the first leaf.
    let focused = tree && persistedFocusedId && findLeaf(tree, persistedFocusedId) ? persistedFocusedId : null
    if (!focused && tree) focused = firstLeafId(tree)

    set({ tree, focusedPaneId: focused, loaded: true })
  },

  splitFocused: (newSessionId, direction, side = 'second') => {
    const { tree, focusedPaneId } = get()
    if (!tree || !focusedPaneId) return
    const next = splitLeaf(tree, focusedPaneId, newSessionId, direction, side)
    // After split, focus the NEW session's leaf so the user lands on it.
    // The new leaf is the `side` child of the new split under focusedPaneId's node.
    // Easiest: find the leaf holding newSessionId.
    const newLeafId = findLeafIdBySession(next, newSessionId)
    set({ tree: next, focusedPaneId: newLeafId ?? focusedPaneId })
  },

  replaceFocusedLeaf: (sessionId) => {
    const { tree, focusedPaneId } = get()
    if (!tree || !focusedPaneId) {
      // No tree yet → start one with this session.
      const t = singleLeafTree(sessionId)
      set({ tree: t, focusedPaneId: t.id })
      return
    }
    set({ tree: replaceLeafSession(tree, focusedPaneId, sessionId) })
  },

  insertNeighborFocused: (sessionId, direction, side) => {
    const { tree, focusedPaneId } = get()
    if (!tree || !focusedPaneId) {
      const t = singleLeafTree(sessionId)
      set({ tree: t, focusedPaneId: t.id })
      return
    }
    const next = insertNeighbor(tree, focusedPaneId, sessionId, direction, side)
    const newLeafId = findLeafIdBySession(next, sessionId)
    set({ tree: next, focusedPaneId: newLeafId ?? focusedPaneId })
  },

  closeFocused: () => {
    const { tree, focusedPaneId } = get()
    if (!tree || !focusedPaneId) return
    const { tree: next, nextFocusId } = removeLeaf(tree, focusedPaneId)
    set({ tree: next, focusedPaneId: nextFocusId })
  },

  removeSessionEverywhere: (sessionId) => {
    const { tree } = get()
    if (!tree) return
    // Repeatedly remove leaves holding sessionId until none remain.
    let cur: PaneTree | null = tree
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const leafId = findLeafIdBySession(cur, sessionId)
      if (!leafId) break
      const res = removeLeaf(cur, leafId)
      cur = res.tree
    }
    let focused = get().focusedPaneId
    if (focused && (!cur || !findLeaf(cur, focused))) {
      focused = cur ? firstLeafId(cur) : null
    }
    set({ tree: cur, focusedPaneId: focused })
  },

  setSplitRatio: (splitId, ratio) => {
    const { tree } = get()
    if (!tree) return
    set({ tree: setRatio(tree, splitId, ratio) })
  },

  focusPane: (paneId) => {
    const { tree } = get()
    if (tree && findLeaf(tree, paneId)) set({ focusedPaneId: paneId })
  },

  focusNext: () => {
    const { tree, focusedPaneId } = get()
    if (!tree) return
    const next = nextLeafId(tree, focusedPaneId)
    if (next) set({ focusedPaneId: next })
  },

  focusPrev: () => {
    const { tree, focusedPaneId } = get()
    if (!tree) return
    const prev = prevLeafId(tree, focusedPaneId)
    if (prev) set({ focusedPaneId: prev })
  },

  ensureVisible: (sessionId) => {
    const { tree } = get()
    if (tree && treeHasSession(tree, sessionId)) {
      // Already visible → focus its pane (sidebar click on a visible session
      // should move focus there, not be a no-op).
      const leafId = findLeafIdBySession(tree, sessionId)
      if (leafId) set({ focusedPaneId: leafId })
      return true
    }
    get().replaceFocusedLeaf(sessionId)
    return false
  },

  toPersisted: () => {
    const { tree, focusedPaneId } = get()
    return { paneTree: toPersistedTree(tree), focusedPaneId }
  }
}))

/** Find the leaf id holding a given session id, or null. */
function findLeafIdBySession(tree: PaneTree | null, sessionId: string): string | null {
  if (!tree) return null
  if (tree.type === 'leaf') return tree.sessionId === sessionId ? tree.id : null
  return findLeafIdBySession(tree.first, sessionId) ?? findLeafIdBySession(tree.second, sessionId)
}

// Re-export for callers that need session visibility without importing ops directly.
export { collectSessionIds, newPaneId }

/**
 * Read the sessionId of the currently focused leaf, or null if there is no
 * tree / no focused leaf. Used by App to derive the cwd for a split (the new
 * pane inherits the focused pane's session cwd, tmux-style).
 */
export function getFocusedSessionId(): string | null {
  const { tree, focusedPaneId } = usePaneStore.getState()
  if (!tree || !focusedPaneId) return null
  const leaf = findLeaf(tree, focusedPaneId)
  return leaf?.sessionId ?? null
}
