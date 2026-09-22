
   
import type { PaneTree, PaneLeaf, PaneSplit, SplitDirection } from '../../shared/paneTypes'
import { clampRatio } from '../../shared/paneTypes'
import { newPaneId, firstLeafId as normalizeFirstLeafId, findLeaf } from '../../shared/paneTreeNormalize'

                                                                                  
type NodeUpdate = (node: PaneTree) => PaneTree

                                                                                        
function updateNode(tree: PaneTree, targetId: string, update: NodeUpdate): PaneTree {
  if (tree.id === targetId) return update(tree)
  if (tree.type === 'split') {
    return { ...tree, first: updateNode(tree.first, targetId, update), second: updateNode(tree.second, targetId, update) }
  }
  return tree
}


   
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
    if (node.type !== 'leaf') return node
    const origLeaf: PaneLeaf = { id: newPaneId(), type: 'leaf', sessionId: node.sessionId }

    const first = side === 'first' ? newLeaf : origLeaf
    const second = side === 'first' ? origLeaf : newLeaf
    const split: PaneSplit = {
      id: node.id,
      type: 'split',
      direction,
      ratio: side === 'first' ? 1 - origRatio : origRatio,
      first,
      second
    }
    return split
  })
}


   
export interface RemoveResult {
  tree: PaneTree | null
  nextFocusId: string | null
}

export function removeLeaf(tree: PaneTree, leafId: string): RemoveResult {

  const target = findLeaf(tree, leafId)
  if (!target) return { tree, nextFocusId: null }

  const after = removeNode(tree, leafId)
  if (after === null) return { tree: null, nextFocusId: null }


  const next = normalizeFirstLeafId(after)!
  return { tree: after, nextFocusId: next }
}

export interface RemoveManyResult {
  tree: PaneTree | null
  removedCount: number
}


   
export function removeLeavesBySession(tree: PaneTree, sessionId: string): RemoveManyResult {
  let removedCount = 0

  function recurse(node: PaneTree): PaneTree | null {
    if (node.type === 'leaf') {
      if (node.sessionId === sessionId) {
        removedCount++
        return null
      }
      return node
    }
    const first = recurse(node.first)
    const second = recurse(node.second)
    if (first && second) {
      if (first === node.first && second === node.second) return node
      return { ...node, first, second }
    }
    return first ?? second ?? null
  }

  return { tree: recurse(tree), removedCount }
}

                                                                   
function removeNode(tree: PaneTree, removeId: string): PaneTree | null {
  if (tree.id === removeId) return null
  if (tree.type === 'leaf') return tree

  const first = removeNode(tree.first, removeId)
  const second = removeNode(tree.second, removeId)

  if (first && second) return { ...tree, first, second }

  return first ?? second ?? null
}

                                                                             
export function replaceLeafSession(tree: PaneTree, leafId: string, sessionId: string): PaneTree {
  return updateNode(tree, leafId, (node) =>
    node.type === 'leaf' ? { ...node, sessionId } : node
  )
}

                                                                                  
export function setRatio(tree: PaneTree, splitId: string, ratio: number): PaneTree {
  return updateNode(tree, splitId, (node) =>
    node.type === 'split' ? { ...node, ratio: clampRatio(ratio) } : node
  )
}


   
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
