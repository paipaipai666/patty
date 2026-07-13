import { describe, it, expect } from 'vitest'
import {
  newPaneId,
  normalizePersistedTree,
  singleLeafTree,
  toPersistedTree,
  findLeaf,
  treeHasSession,
  firstLeafId,
  collectTreeSessionIds
} from '../paneTreeNormalize'
import type { PersistedPaneTree, PaneTree } from '../paneTypes'

function known(...ids: string[]): Set<string> {
  return new Set(ids)
}

function pLeaf(sessionId: string, id = sessionId): PersistedPaneTree {
  return { id, type: 'leaf', sessionId }
}

function pSplit(
  id: string,
  direction: 'horizontal' | 'vertical',
  ratio: number,
  first: PersistedPaneTree,
  second: PersistedPaneTree
): PersistedPaneTree {
  return { id, type: 'split', direction, ratio, first, second }
}

describe('newPaneId', () => {
  it('returns a string in UUID format', () => {
    const id = newPaneId()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('returns unique ids on each call', () => {
    expect(newPaneId()).not.toBe(newPaneId())
  })
})

describe('singleLeafTree', () => {
  it('creates a leaf with the given sessionId', () => {
    const leaf = singleLeafTree('s1')
    expect(leaf).toEqual({ id: expect.any(String), type: 'leaf', sessionId: 's1' })
  })

  it('accepts a custom pane id', () => {
    const leaf = singleLeafTree('s1', 'custom-id')
    expect(leaf.id).toBe('custom-id')
  })
})

describe('normalizePersistedTree', () => {
  it('returns null for null/undefined input', () => {
    expect(normalizePersistedTree(null, known('s1'))).toBeNull()
    expect(normalizePersistedTree(undefined, known('s1'))).toBeNull()
  })

  it('keeps a leaf whose session is known', () => {
    const result = normalizePersistedTree(pLeaf('s1', 'p1'), known('s1'))
    expect(result).toEqual({ id: 'p1', type: 'leaf', sessionId: 's1' })
  })

  it('drops a leaf whose session is unknown', () => {
    expect(normalizePersistedTree(pLeaf('dead', 'p1'), known('s1'))).toBeNull()
  })

  it('normalizes a split with both children surviving', () => {
    const persisted = pSplit('sp', 'horizontal', 0.5, pLeaf('s1', 'a'), pLeaf('s2', 'b'))
    const result = normalizePersistedTree(persisted, known('s1', 's2'))
    expect(result).not.toBeNull()
    if (result?.type !== 'split') return
    expect(result.id).toBe('sp')
    expect(result.direction).toBe('horizontal')
    expect(result.ratio).toBe(0.5)
    expect(result.first).toEqual({ id: 'a', type: 'leaf', sessionId: 's1' })
    expect(result.second).toEqual({ id: 'b', type: 'leaf', sessionId: 's2' })
  })

  it('collapses a split when one child is pruned', () => {
    const persisted = pSplit('sp', 'horizontal', 0.5, pLeaf('s1', 'a'), pLeaf('dead', 'b'))
    const result = normalizePersistedTree(persisted, known('s1'))
    expect(result?.type).toBe('leaf')
    expect((result as any).sessionId).toBe('s1')
  })

  it('returns null when both children are pruned', () => {
    const persisted = pSplit('sp', 'horizontal', 0.5, pLeaf('dead1', 'a'), pLeaf('dead2', 'b'))
    expect(normalizePersistedTree(persisted, known('s1'))).toBeNull()
  })

  it('clamps ratio to valid range', () => {
    const persisted = pSplit('sp', 'horizontal', 5, pLeaf('s1', 'a'), pLeaf('s2', 'b'))
    const result = normalizePersistedTree(persisted, known('s1', 's2'))
    expect(result).not.toBeNull()
    if (result?.type !== 'split') return
    expect(result.ratio).toBeLessThanOrEqual(0.9)
  })

  it('returns null for non-leaf non-split objects', () => {
    expect(normalizePersistedTree({ type: 'unknown' } as any, known('s1'))).toBeNull()
  })

  it('does not mutate the input', () => {
    const persisted = pSplit('sp', 'horizontal', 0.5, pLeaf('s1', 'a'), pLeaf('s2', 'b'))
    const snapshot = JSON.stringify(persisted)
    normalizePersistedTree(persisted, known('s1', 's2'))
    expect(JSON.stringify(persisted)).toBe(snapshot)
  })
})

describe('toPersistedTree', () => {
  it('returns null for null input', () => {
    expect(toPersistedTree(null)).toBeNull()
  })

  it('converts a leaf', () => {
    const tree: PaneTree = { id: 'p1', type: 'leaf', sessionId: 's1' }
    expect(toPersistedTree(tree)).toEqual({ id: 'p1', type: 'leaf', sessionId: 's1' })
  })

  it('converts a split recursively', () => {
    const tree: PaneTree = {
      id: 'sp',
      type: 'split',
      direction: 'vertical',
      ratio: 0.3,
      first: { id: 'a', type: 'leaf', sessionId: 's1' },
      second: { id: 'b', type: 'leaf', sessionId: 's2' }
    }
    const result = toPersistedTree(tree)
    expect(result).toEqual({
      id: 'sp',
      type: 'split',
      direction: 'vertical',
      ratio: 0.3,
      first: { id: 'a', type: 'leaf', sessionId: 's1' },
      second: { id: 'b', type: 'leaf', sessionId: 's2' }
    })
  })
})

describe('findLeaf', () => {
  const tree: PaneTree = {
    id: 'sp',
    type: 'split',
    direction: 'horizontal',
    ratio: 0.5,
    first: { id: 'a', type: 'leaf', sessionId: 's1' },
    second: { id: 'b', type: 'leaf', sessionId: 's2' }
  }

  it('finds a leaf by id', () => {
    expect(findLeaf(tree, 'a')?.sessionId).toBe('s1')
    expect(findLeaf(tree, 'b')?.sessionId).toBe('s2')
  })

  it('returns null when the id is not found', () => {
    expect(findLeaf(tree, 'nope')).toBeNull()
  })

  it('returns null for null tree', () => {
    expect(findLeaf(null, 'a')).toBeNull()
  })
})

describe('treeHasSession', () => {
  const tree: PaneTree = {
    id: 'sp',
    type: 'split',
    direction: 'horizontal',
    ratio: 0.5,
    first: { id: 'a', type: 'leaf', sessionId: 's1' },
    second: { id: 'b', type: 'leaf', sessionId: 's2' }
  }

  it('returns true when session exists', () => {
    expect(treeHasSession(tree, 's1')).toBe(true)
    expect(treeHasSession(tree, 's2')).toBe(true)
  })

  it('returns false when session does not exist', () => {
    expect(treeHasSession(tree, 's3')).toBe(false)
  })

  it('returns false for null tree', () => {
    expect(treeHasSession(null, 's1')).toBe(false)
  })
})

describe('firstLeafId', () => {
  it('returns the id of a single leaf', () => {
    expect(firstLeafId(singleLeafTree('s1', 'p1'))).toBe('p1')
  })

  it('returns the leftmost leaf of a split', () => {
    const tree: PaneTree = {
      id: 'sp',
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: { id: 'a', type: 'leaf', sessionId: 's1' },
      second: { id: 'b', type: 'leaf', sessionId: 's2' }
    }
    expect(firstLeafId(tree)).toBe('a')
  })

  it('returns null for null tree', () => {
    expect(firstLeafId(null)).toBeNull()
  })
})

describe('collectTreeSessionIds', () => {
  it('returns an empty set for null tree', () => {
    expect(collectTreeSessionIds(null)).toEqual(new Set())
  })

  it('collects session ids from a single leaf', () => {
    expect(collectTreeSessionIds(singleLeafTree('s1'))).toEqual(new Set(['s1']))
  })

  it('collects session ids from a split', () => {
    const tree: PaneTree = {
      id: 'sp',
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: { id: 'a', type: 'leaf', sessionId: 's1' },
      second: { id: 'b', type: 'leaf', sessionId: 's2' }
    }
    expect(collectTreeSessionIds(tree)).toEqual(new Set(['s1', 's2']))
  })
})
