import { create } from 'zustand'
import type { PaneTree, SplitDirection } from '../../shared/paneTypes'
import type { Workspace, PersistedWorkspace } from '../../shared/workspaceTypes'
import { newWorkspaceId } from '../../shared/workspaceNormalize'
import {
  singleLeafTree,
  toPersistedTree,
  firstLeafId,
  treeHasSession,
  findLeaf
} from '../../shared/paneTreeNormalize'
import {
  splitLeaf,
  removeLeaf,
  removeLeavesBySession,
  replaceLeafSession,
  setRatio,
  insertNeighbor
} from './paneTreeOps'
import { markDirty } from './dirtyScheduler'

interface WorkspaceStore {
  workspaces: Workspace[]
  activeWorkspaceId: string | null

                                                                                 
  loadFromPersisted: (workspaces: Workspace[], activeId: string | null) => void



  createWorkspace: (sessionId: string, collectionId?: string | null) => string
  switchWorkspace: (id: string) => void
  deleteWorkspace: (id: string) => void
  renameWorkspace: (id: string, name: string) => void
  moveWorkspaceToCollection: (id: string, collectionId: string | null) => void



  splitFocused: (newSessionId: string, direction: SplitDirection, side?: 'first' | 'second') => void
  insertNeighborAt: (paneId: string, sessionId: string, direction: SplitDirection, side: 'first' | 'second') => void
  replaceLeafAt: (paneId: string, sessionId: string) => void
  closeFocused: () => void
  removeSessionEverywhere: (sessionId: string) => void
  setSplitRatio: (splitId: string, ratio: number) => void
  focusPane: (paneId: string) => void
  ensureVisible: (sessionId: string) => boolean



  toPersisted: () => { workspaces: PersistedWorkspace[]; activeWorkspaceId: string | null }
}

                                                                            
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

                                                            
function findLeafIdBySession(tree: PaneTree | null, sessionId: string): string | null {
  if (!tree) return null
  if (tree.type === 'leaf') return tree.sessionId === sessionId ? tree.id : null
  return findLeafIdBySession(tree.first, sessionId) ?? findLeafIdBySession(tree.second, sessionId)
}

                                                                                                                           
function getActiveWsOrCreate(sessionId: string): { ws: Workspace; workspaces: Workspace[]; activeWorkspaceId: string } | null {
  const state = useWorkspaceStore.getState()
  if (!state.activeWorkspaceId) {
    state.createWorkspace(sessionId)
    return null
  }
  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
  if (!ws) {
    state.createWorkspace(sessionId)
    return null
  }
  return { ws, workspaces: state.workspaces, activeWorkspaceId: state.activeWorkspaceId }
}


function pruneSessionFromTrees(workspaces: Workspace[], sessionId: string): Workspace[] {
  return workspaces
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
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,

  loadFromPersisted: (workspaces, activeId) => {
    set({ workspaces, activeWorkspaceId: activeId })
  },



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
    markDirty()
    return id
  },

  switchWorkspace: (id) => {
    const { workspaces, activeWorkspaceId } = get()
    if (id === activeWorkspaceId) return
    if (!workspaces.some((w) => w.id === id)) return
    set({ activeWorkspaceId: id })
    markDirty()
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
    markDirty()
  },

  renameWorkspace: (id, name) => {
    set((state) => ({
      workspaces: patchWorkspace(state.workspaces, id, { name })
    }))
    markDirty()
  },

  moveWorkspaceToCollection: (id, collectionId) => {
    set((state) => ({
      workspaces: patchWorkspace(state.workspaces, id, { collectionId })
    }))
    markDirty()
  },



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
    markDirty()
  },

  insertNeighborAt: (paneId, sessionId, direction, side) => {
    const r = getActiveWsOrCreate(sessionId)
    if (!r) return

    if (findLeaf(r.ws.paneTree, paneId)?.sessionId === sessionId) return

    const pruned = pruneSessionFromTrees(r.workspaces, sessionId)
    const targetTree = pruned.find((w) => w.id === r.activeWorkspaceId)?.paneTree ?? null
    if (!targetTree || !findLeaf(targetTree, paneId)) {

      set({ workspaces: pruned })
      get().createWorkspace(sessionId)
      return
    }
    const next = insertNeighbor(targetTree, paneId, sessionId, direction, side)
    const newLeafId = findLeafIdBySession(next, sessionId)
    set({
      workspaces: patchWorkspace(pruned, r.activeWorkspaceId, {
        paneTree: next,
        focusedPaneId: newLeafId ?? paneId
      })
    })
    markDirty()
  },

  replaceLeafAt: (paneId, sessionId) => {
    const r = getActiveWsOrCreate(sessionId)
    if (!r) return
    if (findLeaf(r.ws.paneTree, paneId)?.sessionId === sessionId) return
    const pruned = pruneSessionFromTrees(r.workspaces, sessionId)
    const targetTree = pruned.find((w) => w.id === r.activeWorkspaceId)?.paneTree ?? null
    if (!targetTree || !findLeaf(targetTree, paneId)) {
      set({ workspaces: pruned })
      get().createWorkspace(sessionId)
      return
    }
    set({
      workspaces: patchWorkspace(pruned, r.activeWorkspaceId, {
        paneTree: replaceLeafSession(targetTree, paneId, sessionId),
        focusedPaneId: paneId
      })
    })
    markDirty()
  },

  closeFocused: () => {
    const { workspaces, activeWorkspaceId } = get()
    if (!activeWorkspaceId) return
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws || !ws.focusedPaneId) return
    const { tree: next, nextFocusId } = removeLeaf(ws.paneTree, ws.focusedPaneId)

    if (!next) {
      const nextWorkspaces = workspaces.filter((w) => w.id !== activeWorkspaceId)
      set({ workspaces: nextWorkspaces, activeWorkspaceId: null })
      markDirty()
      return
    }
    set({
      workspaces: patchWorkspace(workspaces, activeWorkspaceId, {
        paneTree: next,
        focusedPaneId: nextFocusId
      })
    })
    markDirty()
  },

  removeSessionEverywhere: (sessionId) => {
    const { workspaces, activeWorkspaceId } = get()
    const nextWorkspaces = pruneSessionFromTrees(workspaces, sessionId)

    const nextActiveId =
      activeWorkspaceId && nextWorkspaces.some((w) => w.id === activeWorkspaceId)
        ? activeWorkspaceId
        : nextWorkspaces[0]?.id ?? null

    set({ workspaces: nextWorkspaces, activeWorkspaceId: nextActiveId })
    markDirty()
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
    markDirty()
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
    markDirty()
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
        markDirty()
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


   
export function getFocusedSessionId(): string | null {
  const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState()
  if (!activeWorkspaceId) return null
  const ws = workspaces.find((w) => w.id === activeWorkspaceId)
  if (!ws || !ws.focusedPaneId) return null
  const leaf = findLeaf(ws.paneTree, ws.focusedPaneId)
  return leaf?.sessionId ?? null
}
