import { create } from 'zustand'
import type { PaneTree, SplitDirection } from '../../shared/paneTypes'
import type { Workspace, PersistedWorkspace } from '../../shared/workspaceTypes'
import { newWorkspaceId } from '../../shared/workspaceNormalize'
import {
  singleLeafTree,
  toPersistedTree,
  firstLeafId,
  treeHasSession,
  newPaneId
} from '../../shared/paneTreeNormalize'
import {
  splitLeaf,
  removeLeaf,
  removeLeavesBySession,
  replaceLeafSession,
  setRatio,
  insertNeighbor,
  findLeaf,
  nextLeafId,
  prevLeafId,
  collectSessionIds
} from './paneTreeOps'
import { requestStateSave } from './statePersistence'

interface WorkspaceStore {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  loaded: boolean

  /** Restore workspaces from normalized data (called by App after loadState). */
  loadFromPersisted: (workspaces: Workspace[], activeId: string | null) => void

  // ── Workspace management ────────────────────────────────────────────

  createWorkspace: (sessionId: string, collectionId?: string | null) => string
  switchWorkspace: (id: string) => void
  deleteWorkspace: (id: string) => void
  renameWorkspace: (id: string, name: string) => void
  moveWorkspaceToCollection: (id: string, collectionId: string | null) => void

  // ── Tree ops (scoped to active workspace) ───────────────────────────

  splitFocused: (newSessionId: string, direction: SplitDirection, side?: 'first' | 'second') => void
  replaceFocusedLeaf: (sessionId: string) => void
  insertNeighborFocused: (sessionId: string, direction: SplitDirection, side: 'first' | 'second') => void
  insertNeighborAt: (paneId: string, sessionId: string, direction: SplitDirection, side: 'first' | 'second') => void
  replaceLeafAt: (paneId: string, sessionId: string) => void
  closeFocused: () => void
  removeSessionEverywhere: (sessionId: string) => void
  setSplitRatio: (splitId: string, ratio: number) => void
  focusPane: (paneId: string) => void
  focusNext: () => void
  focusPrev: () => void
  ensureVisible: (sessionId: string) => boolean

  // ── Persistence ─────────────────────────────────────────────────────

  toPersisted: () => { workspaces: PersistedWorkspace[]; activeWorkspaceId: string | null }
}

/** Update a single workspace in the list immutably. Returns a new array. */
function patchWorkspace(
  workspaces: Workspace[],
  id: string,
  patch: Partial<Workspace> | ((w: Workspace) => Workspace)
): Workspace[] {
  const idx = workspaces.findIndex((w) => w.id === id)
  if (idx === -1) return workspaces
  const updated = typeof patch === 'function' ? patch(workspaces[idx]) : { ...workspaces[idx], ...patch }
  const next = [...workspaces]
  next[idx] = updated
  return next
}

/** Find the leaf id holding a given session id, or null. */
function findLeafIdBySession(tree: PaneTree | null, sessionId: string): string | null {
  if (!tree) return null
  if (tree.type === 'leaf') return tree.sessionId === sessionId ? tree.id : null
  return findLeafIdBySession(tree.first, sessionId) ?? findLeafIdBySession(tree.second, sessionId)
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  loaded: false,

  loadFromPersisted: (workspaces, activeId) => {
    set({ workspaces, activeWorkspaceId: activeId, loaded: true })
  },

  // ── Workspace management ────────────────────────────────────────────

  createWorkspace: (sessionId, collectionId = null) => {
    const id = newWorkspaceId()
    const tree = singleLeafTree(sessionId)
    const workspace: Workspace = {
      id,
      name: `Workspace ${get().workspaces.length + 1}`,
      collectionId,
      paneTree: tree,
      focusedPaneId: tree.id
    }
    set((state) => ({
      workspaces: [...state.workspaces, workspace],
      activeWorkspaceId: id
    }))
    requestStateSave()
    return id
  },

  switchWorkspace: (id) => {
    const { workspaces, activeWorkspaceId } = get()
    if (id === activeWorkspaceId) return
    if (!workspaces.some((w) => w.id === id)) return
    set({ activeWorkspaceId: id })
    requestStateSave()
  },

  deleteWorkspace: (id) => {
    const { workspaces, activeWorkspaceId } = get()
    const filtered = workspaces.filter((w) => w.id !== id)
    if (filtered.length === workspaces.length) return
    let nextActive = activeWorkspaceId
    if (nextActive === id) {
      nextActive = filtered[0]?.id ?? null
    }
    set({ workspaces: filtered, activeWorkspaceId: nextActive })
    requestStateSave()
  },

  renameWorkspace: (id, name) => {
    set((state) => ({
      workspaces: patchWorkspace(state.workspaces, id, { name })
    }))
    requestStateSave()
  },

  moveWorkspaceToCollection: (id, collectionId) => {
    set((state) => ({
      workspaces: patchWorkspace(state.workspaces, id, { collectionId })
    }))
    requestStateSave()
  },

  // ── Tree ops ────────────────────────────────────────────────────────

  splitFocused: (newSessionId, direction, side = 'second') => {
    const { workspaces, activeWorkspaceId } = get()
    if (!activeWorkspaceId) return
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws || !ws.focusedPaneId) return
    const next = splitLeaf(ws.paneTree, ws.focusedPaneId, newSessionId, direction, side)
    const newLeafId = findLeafIdBySession(next, newSessionId)
    set({
      workspaces: patchWorkspace(workspaces, activeWorkspaceId, {
        paneTree: next,
        focusedPaneId: newLeafId ?? ws.focusedPaneId
      })
    })
    requestStateSave()
  },

  replaceFocusedLeaf: (sessionId) => {
    const { workspaces, activeWorkspaceId } = get()
    if (!activeWorkspaceId) {
      get().createWorkspace(sessionId)
      return
    }
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws || !ws.focusedPaneId) {
      get().createWorkspace(sessionId)
      return
    }
    set({
      workspaces: patchWorkspace(workspaces, activeWorkspaceId, {
        paneTree: replaceLeafSession(ws.paneTree, ws.focusedPaneId, sessionId)
      })
    })
    requestStateSave()
  },

  insertNeighborFocused: (sessionId, direction, side) => {
    const { workspaces, activeWorkspaceId } = get()
    if (!activeWorkspaceId) {
      get().createWorkspace(sessionId)
      return
    }
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws || !ws.focusedPaneId) {
      get().createWorkspace(sessionId)
      return
    }
    const next = insertNeighbor(ws.paneTree, ws.focusedPaneId, sessionId, direction, side)
    const newLeafId = findLeafIdBySession(next, sessionId)
    set({
      workspaces: patchWorkspace(workspaces, activeWorkspaceId, {
        paneTree: next,
        focusedPaneId: newLeafId ?? ws.focusedPaneId
      })
    })
    requestStateSave()
  },

  insertNeighborAt: (paneId, sessionId, direction, side) => {
    const { workspaces, activeWorkspaceId } = get()
    if (!activeWorkspaceId) {
      get().createWorkspace(sessionId)
      return
    }
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws) {
      get().createWorkspace(sessionId)
      return
    }
    const next = insertNeighbor(ws.paneTree, paneId, sessionId, direction, side)
    const newLeafId = findLeafIdBySession(next, sessionId)
    set({
      workspaces: patchWorkspace(workspaces, activeWorkspaceId, {
        paneTree: next,
        focusedPaneId: newLeafId ?? paneId
      })
    })
    requestStateSave()
  },

  replaceLeafAt: (paneId, sessionId) => {
    const { workspaces, activeWorkspaceId } = get()
    if (!activeWorkspaceId) {
      get().createWorkspace(sessionId)
      return
    }
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws) {
      get().createWorkspace(sessionId)
      return
    }
    set({
      workspaces: patchWorkspace(workspaces, activeWorkspaceId, {
        paneTree: replaceLeafSession(ws.paneTree, paneId, sessionId),
        focusedPaneId: paneId
      })
    })
    requestStateSave()
  },

  closeFocused: () => {
    const { workspaces, activeWorkspaceId } = get()
    if (!activeWorkspaceId) return
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws || !ws.focusedPaneId) return
    const { tree: next, nextFocusId } = removeLeaf(ws.paneTree, ws.focusedPaneId)
    // Removing the last leaf yields a null tree — remove the workspace and
    // drop the active workspace id so the terminal area shows the empty
    // state and the sidebar highlight clears. Other workspaces remain in
    // the sidebar and can be re-entered by clicking their sessions.
    if (!next) {
      const nextWorkspaces = workspaces.filter((w) => w.id !== activeWorkspaceId)
      set({ workspaces: nextWorkspaces, activeWorkspaceId: null })
      requestStateSave()
      return
    }
    set({
      workspaces: patchWorkspace(workspaces, activeWorkspaceId, {
        paneTree: next,
        focusedPaneId: nextFocusId
      })
    })
    requestStateSave()
  },

  removeSessionEverywhere: (sessionId) => {
    const { workspaces, activeWorkspaceId } = get()
    const nextWorkspaces = workspaces
      .map((w) => {
        const { tree, removedCount } = removeLeavesBySession(w.paneTree, sessionId)
        if (removedCount === 0) return w
        if (!tree) return null
        let focused = w.focusedPaneId
        if (focused && !findLeaf(tree, focused)) {
          focused = firstLeafId(tree)
        }
        return { ...w, paneTree: tree, focusedPaneId: focused }
      })
      .filter(Boolean) as Workspace[]

    const nextActiveId =
      activeWorkspaceId && nextWorkspaces.some((w) => w.id === activeWorkspaceId)
        ? activeWorkspaceId
        : nextWorkspaces[0]?.id ?? null

    set({ workspaces: nextWorkspaces, activeWorkspaceId: nextActiveId })
    requestStateSave()
  },

  setSplitRatio: (splitId, ratio) => {
    const { workspaces, activeWorkspaceId } = get()
    if (!activeWorkspaceId) return
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws) return
    set({
      workspaces: patchWorkspace(workspaces, activeWorkspaceId, {
        paneTree: setRatio(ws.paneTree, splitId, ratio)
      })
    })
    requestStateSave()
  },

  focusPane: (paneId) => {
    const { workspaces, activeWorkspaceId } = get()
    if (!activeWorkspaceId) return
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws || ws.focusedPaneId === paneId) return
    if (!findLeaf(ws.paneTree, paneId)) return
    set({
      workspaces: patchWorkspace(workspaces, activeWorkspaceId, { focusedPaneId: paneId })
    })
    requestStateSave()
  },

  focusNext: () => {
    const { workspaces, activeWorkspaceId } = get()
    if (!activeWorkspaceId) return
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws) return
    const next = nextLeafId(ws.paneTree, ws.focusedPaneId)
    if (next && next !== ws.focusedPaneId) {
      set({
        workspaces: patchWorkspace(workspaces, activeWorkspaceId, { focusedPaneId: next })
      })
      requestStateSave()
    }
  },

  focusPrev: () => {
    const { workspaces, activeWorkspaceId } = get()
    if (!activeWorkspaceId) return
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws) return
    const prev = prevLeafId(ws.paneTree, ws.focusedPaneId)
    if (prev && prev !== ws.focusedPaneId) {
      set({
        workspaces: patchWorkspace(workspaces, activeWorkspaceId, { focusedPaneId: prev })
      })
      requestStateSave()
    }
  },

  ensureVisible: (sessionId) => {
    const { workspaces, activeWorkspaceId } = get()

    const activeWs = activeWorkspaceId
      ? workspaces.find((w) => w.id === activeWorkspaceId)
      : undefined

    if (activeWs && treeHasSession(activeWs.paneTree, sessionId)) {
      const leafId = findLeafIdBySession(activeWs.paneTree, sessionId)
      if (leafId && leafId !== activeWs.focusedPaneId) {
        set({
          workspaces: patchWorkspace(workspaces, activeWorkspaceId!, { focusedPaneId: leafId })
        })
        requestStateSave()
      }
      return true
    }

    for (const w of workspaces) {
      if (treeHasSession(w.paneTree, sessionId)) {
        get().switchWorkspace(w.id)
        return true
      }
    }

    get().createWorkspace(sessionId)
    return false
  },

  // ── Persistence ─────────────────────────────────────────────────────

  toPersisted: () => {
    const { workspaces, activeWorkspaceId } = get()
    return {
      workspaces: workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        collectionId: w.collectionId,
        paneTree: toPersistedTree(w.paneTree),
        focusedPaneId: w.focusedPaneId
      })),
      activeWorkspaceId
    }
  }
}))

// Re-export for callers that need session visibility without importing ops directly.
export { collectSessionIds, newPaneId }

/**
 * Read the sessionId of the currently focused leaf in the active workspace,
 * or null if there is no active workspace / no focused leaf.
 */
export function getFocusedSessionId(): string | null {
  const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState()
  if (!activeWorkspaceId) return null
  const ws = workspaces.find((w) => w.id === activeWorkspaceId)
  if (!ws || !ws.focusedPaneId) return null
  const leaf = findLeaf(ws.paneTree, ws.focusedPaneId)
  return leaf?.sessionId ?? null
}
