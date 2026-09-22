
   
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

                                                                            
export function newPaneId(): string {

  return crypto.randomUUID()
}

function isPersistedLeaf(node: unknown): node is PersistedPaneLeaf {
  return typeof node === 'object' && node !== null && (node as any).type === 'leaf'
}

function isPersistedSplit(node: unknown): node is PersistedPaneSplit {
  return typeof node === 'object' && node !== null && (node as any).type === 'split'
}


   
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

    return first ?? second ?? null
  }

  return null
}


   
export function singleLeafTree(sessionId: string, paneId: string = newPaneId()): PaneTree {
  return { id: paneId, type: 'leaf', sessionId }
}

                                                                                    
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

                                               
export function findLeaf(node: PaneTree | null, paneId: string): PaneLeaf | null {
  if (!node) return null
  if (node.type === 'leaf') return node.id === paneId ? node : null
  return findLeaf(node.first, paneId) ?? findLeaf(node.second, paneId)
}

                                                           
export function treeHasSession(node: PaneTree | null, sessionId: string): boolean {
  if (!node) return false
  if (node.type === 'leaf') return node.sessionId === sessionId
  return treeHasSession(node.first, sessionId) || treeHasSession(node.second, sessionId)
}

                                                                        
export function firstLeafId(node: PaneTree | null): string | null {
  if (!node) return null
  if (node.type === 'leaf') return node.id
  return firstLeafId(node.first)
}

                                                                 
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
