import { describe, it, expect } from 'vitest'
import {
  splitLeaf,
  removeLeaf,
  replaceLeafSession,
  setRatio,
  insertNeighbor,
  findLeaf,
  firstLeafId,
  collectLeafIds,
  collectSessionIds,
  nextLeafId,
  prevLeafId
} from './paneTreeOps'
import { singleLeafTree } from '../../shared/paneTreeNormalize'
import type { PaneTree } from '../../shared/paneTypes'

describe('splitLeaf', () => {
  it('turns a leaf into a split holding the original and new session', () => {
    const tree = singleLeafTree('s1', 'p1')
    const next = splitLeaf(tree, 'p1', 's2', 'horizontal', 'second', 0.5)

    expect(next.type).toBe('split')
    if (next.type !== 'split') return
    expect(next.direction).toBe('horizontal')
    // New session on `second`; original on `first`.
    expect(next.first).toEqual(expect.objectContaining({ type: 'leaf', sessionId: 's1' }))
    expect(next.second).toEqual(expect.objectContaining({ type: 'leaf', sessionId: 's2' }))
    expect(next.ratio).toBe(0.5)
  })

  it('places the new session on the first side when side=first', () => {
    const tree = singleLeafTree('s1', 'p1')
    const next = splitLeaf(tree, 'p1', 's2', 'vertical', 'first', 0.3)

    if (next.type !== 'split') return
    expect(next.first).toEqual(expect.objectContaining({ sessionId: 's2' }))
    expect(next.second).toEqual(expect.objectContaining({ sessionId: 's1' }))
    // side=first → ratio becomes 1 - origRatio (first subtree share = new leaf)
    expect(next.ratio).toBeCloseTo(0.7, 10)
  })

  it('is a no-op when the target id is a split, not a leaf', () => {
    const tree = splitLeaf(singleLeafTree('s1', 'p1'), 'p1', 's2', 'horizontal')
    const again = splitLeaf(tree, 'p1', 's3', 'horizontal')
    // p1 is now a split id; splitting it should not change the tree.
    expect(again).toBe(tree)
  })

  it('does not mutate the input tree', () => {
    const tree = singleLeafTree('s1', 'p1')
    const snapshot = JSON.stringify(tree)
    splitLeaf(tree, 'p1', 's2', 'horizontal')
    expect(JSON.stringify(tree)).toBe(snapshot)
  })

  it('clamps ratio into the usable range', () => {
    const tree = singleLeafTree('s1', 'p1')
    const next = splitLeaf(tree, 'p1', 's2', 'horizontal', 'second', 0.001)
    if (next.type !== 'split') return
    // MIN is 0.1; the original session is on `first` so its share is clamped.
    expect(next.ratio).toBeGreaterThanOrEqual(0.1)
    expect(next.ratio).toBeLessThanOrEqual(0.9)
  })
})

describe('removeLeaf (collapse)', () => {
  it('collapses a split to the surviving sibling', () => {
    const tree = splitLeaf(singleLeafTree('s1', 'p1'), 'p1', 's2', 'horizontal')
    // Find the new leaf's id (session s2), then remove it.
    const s2Leaf = findLeaf(tree, collectLeafIds(tree).find((id) => {
      const l = findLeaf(tree, id)
      return l?.sessionId === 's2'
    })!)
    expect(s2Leaf).not.toBeNull()

    const { tree: next, nextFocusId } = removeLeaf(tree, s2Leaf!.id)
    // After removing s2's leaf, the split collapses back to the s1 leaf.
    expect(next?.type).toBe('leaf')
    expect((next as any)?.sessionId).toBe('s1')
    expect(nextFocusId).not.toBeNull()
  })

  it('returns null tree when the last leaf is removed', () => {
    const tree = singleLeafTree('s1', 'p1')
    const { tree: next, nextFocusId } = removeLeaf(tree, 'p1')
    expect(next).toBeNull()
    expect(nextFocusId).toBeNull()
  })

  it('is a no-op when the leaf id does not exist', () => {
    const tree = singleLeafTree('s1', 'p1')
    const { tree: next, nextFocusId } = removeLeaf(tree, 'nope')
    expect(next).toBe(tree)
    expect(nextFocusId).toBeNull()
  })

  it('collapses recursively: removing a deeply nested leaf unwinds parents', () => {
    // p1 split → (p1 split → s1, s2), s3
    let tree = singleLeafTree('s1', 'p1')
    tree = splitLeaf(tree, 'p1', 's2', 'horizontal') // p1 split: s1 | s2
    const s2LeafId = collectLeafIds(tree).find((id) => findLeaf(tree, id)?.sessionId === 's2')!
    tree = splitLeaf(tree, s2LeafId, 's3', 'vertical') // s2 split: s2 / s3

    // Remove s3 → s2 split collapses to s2 → top split becomes s1 | s2
    const s3LeafId = collectLeafIds(tree).find((id) => findLeaf(tree, id)?.sessionId === 's3')!
    const { tree: next } = removeLeaf(tree, s3LeafId)

    expect(next?.type).toBe('split')
    if (next?.type !== 'split') return
    expect(collectSessionIds(next)).toEqual(['s1', 's2'])
  })
})

describe('replaceLeafSession', () => {
  it('swaps the session of a leaf', () => {
    const tree = singleLeafTree('s1', 'p1')
    const next = replaceLeafSession(tree, 'p1', 'sX')
    expect((next as any).sessionId).toBe('sX')
  })

  it('is a no-op on a split id', () => {
    const tree = splitLeaf(singleLeafTree('s1', 'p1'), 'p1', 's2', 'horizontal')
    expect(replaceLeafSession(tree, 'p1', 'sX')).toBe(tree)
  })
})

describe('setRatio', () => {
  it('updates a split ratio and clamps it', () => {
    const tree = splitLeaf(singleLeafTree('s1', 'p1'), 'p1', 's2', 'horizontal')
    const next = setRatio(tree, 'p1', 5) // way out of range
    if (next.type !== 'split') return
    expect(next.ratio).toBeLessThanOrEqual(0.9)
  })

  it('is a no-op on a leaf id', () => {
    const tree = singleLeafTree('s1', 'p1')
    expect(setRatio(tree, 'p1', 0.5)).toBe(tree)
  })
})

describe('insertNeighbor', () => {
  it('inserts a new leaf as the second child of a new split over the target', () => {
    const tree = singleLeafTree('s1', 'p1')
    const next = insertNeighbor(tree, 'p1', 's2', 'horizontal', 'second', 0.5)
    if (next.type !== 'split') return
    expect(next.first).toEqual(expect.objectContaining({ sessionId: 's1' }))
    expect(next.second).toEqual(expect.objectContaining({ sessionId: 's2' }))
  })

  it('does not mutate the input tree', () => {
    const tree = singleLeafTree('s1', 'p1')
    const snapshot = JSON.stringify(tree)
    insertNeighbor(tree, 'p1', 's2', 'horizontal', 'second')
    expect(JSON.stringify(tree)).toBe(snapshot)
  })
})

describe('navigation helpers', () => {
  // tree: split(p1) → [ s1, split → [ s2, s3 ] ]
  function buildTree(): PaneTree {
    let t = singleLeafTree('s1', 'p1')
    t = splitLeaf(t, 'p1', 's2', 'horizontal')
    const s2Id = collectLeafIds(t).find((id) => findLeaf(t, id)?.sessionId === 's2')!
    t = splitLeaf(t, s2Id, 's3', 'vertical')
    return t
  }

  it('collectLeafIds returns ids in document order', () => {
    expect(collectLeafIds(buildTree()).length).toBe(3)
  })

  it('collectSessionIds returns sessions in document order', () => {
    expect(collectSessionIds(buildTree())).toEqual(['s1', 's2', 's3'])
  })

  it('firstLeafId returns the top-left-most leaf', () => {
    const t = buildTree()
    expect(findLeaf(t, firstLeafId(t))?.sessionId).toBe('s1')
  })

  it('nextLeafId wraps around the document order', () => {
    const t = buildTree()
    const ids = collectLeafIds(t)
    expect(nextLeafId(t, ids[0])).toBe(ids[1])
    expect(nextLeafId(t, ids[2])).toBe(ids[0]) // wrap
    expect(nextLeafId(t, null)).toBe(ids[0])
  })

  it('prevLeafId wraps around the document order', () => {
    const t = buildTree()
    const ids = collectLeafIds(t)
    expect(prevLeafId(t, ids[1])).toBe(ids[0])
    expect(prevLeafId(t, ids[0])).toBe(ids[2]) // wrap
  })
})
