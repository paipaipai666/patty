import { describe, it, expect } from 'vitest'
import { normalizeWorkspaces } from './workspaceNormalize'
import type { PersistedWorkspace } from './workspaceTypes'
import type { PersistedPaneTree } from './paneTypes'

function known(...ids: string[]): Set<string> {
  return new Set(ids)
}

/** Persisted shape of a single-leaf tree over a session. */
function pLeaf(sessionId: string, id = sessionId): PersistedPaneTree {
  return { id, type: 'leaf', sessionId }
}

/** Persisted shape of a split. */
function pSplit(
  id: string,
  direction: 'horizontal' | 'vertical',
  ratio: number,
  first: PersistedPaneTree,
  second: PersistedPaneTree
): PersistedPaneTree {
  return { id, type: 'split', direction, ratio, first, second }
}

describe('normalizeWorkspaces — modern path', () => {
  it('normalizes persisted workspaces with valid sessions', () => {
    const ws: PersistedWorkspace = {
      id: 'w1',
      name: 'Work',
      collectionId: null,
      paneTree: pLeaf('s1'),
      focusedPaneId: 's1'
    }
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
      [ws],
      'w1',
      null,
      null,
      known('s1'),
      null
    )
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0].id).toBe('w1')
    expect(workspaces[0].name).toBe('Work')
    expect(workspaces[0].paneTree.type).toBe('leaf')
    expect(activeWorkspaceId).toBe('w1')
  })

  it('drops a workspace whose sessions are all gone', () => {
    const ws: PersistedWorkspace = {
      id: 'w1',
      name: 'Stale',
      collectionId: null,
      paneTree: pLeaf('dead'),
      focusedPaneId: 'dead'
    }
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
      [ws],
      'w1',
      null,
      null,
      known('s1'),
      null
    )
    expect(workspaces).toHaveLength(0)
    expect(activeWorkspaceId).toBeNull()
  })

  it('prunes dead leaves inside a split and collapses the survivor', () => {
    // split: s1 | dead → should collapse to a single s1 leaf
    const ws: PersistedWorkspace = {
      id: 'w1',
      name: 'W',
      collectionId: null,
      paneTree: pSplit('sp', 'horizontal', 0.5, pLeaf('s1', 'a'), pLeaf('dead', 'b')),
      focusedPaneId: 'a'
    }
    const { workspaces } = normalizeWorkspaces([ws], 'w1', null, null, known('s1'), null)
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0].paneTree.type).toBe('leaf')
    expect((workspaces[0].paneTree as any).sessionId).toBe('s1')
  })

  it('falls back to first leaf when persisted focus is invalid', () => {
    const ws: PersistedWorkspace = {
      id: 'w1',
      name: 'W',
      collectionId: null,
      paneTree: pSplit('sp', 'horizontal', 0.5, pLeaf('s1', 'a'), pLeaf('s2', 'b')),
      focusedPaneId: 'gone'
    }
    const { workspaces } = normalizeWorkspaces([ws], 'w1', null, null, known('s1', 's2'), null)
    expect(workspaces[0].focusedPaneId).toBe('a')
  })

  it('resets activeWorkspaceId when it points to a dropped workspace', () => {
    const live: PersistedWorkspace = { id: 'w1', name: 'A', collectionId: null, paneTree: pLeaf('s1'), focusedPaneId: 's1' }
    const dead: PersistedWorkspace = { id: 'w2', name: 'B', collectionId: null, paneTree: pLeaf('dead'), focusedPaneId: 'dead' }
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
      [live, dead],
      'w2', // active points at the dead one
      null,
      null,
      known('s1'),
      null
    )
    expect(workspaces.map((w) => w.id)).toEqual(['w1'])
    expect(activeWorkspaceId).toBe('w1') // falls back to first survivor
  })

  it('defaults a missing name to "Workspace N"', () => {
    const ws: PersistedWorkspace = { id: 'w1', name: '', collectionId: null, paneTree: pLeaf('s1'), focusedPaneId: 's1' }
    const { workspaces } = normalizeWorkspaces([ws], 'w1', null, null, known('s1'), null)
    expect(workspaces[0].name).toBe('Workspace 1')
  })

  it('activates the first workspace when persistedActiveWorkspaceId is null', () => {
    const ws: PersistedWorkspace = { id: 'w1', name: 'A', collectionId: null, paneTree: pLeaf('s1'), focusedPaneId: 's1' }
    const { activeWorkspaceId } = normalizeWorkspaces([ws], null, null, null, known('s1'), null)
    expect(activeWorkspaceId).toBe('w1')
  })

  it('activates the first workspace when persistedActiveWorkspaceId is undefined', () => {
    const ws: PersistedWorkspace = { id: 'w1', name: 'A', collectionId: null, paneTree: pLeaf('s1'), focusedPaneId: 's1' }
    const { activeWorkspaceId } = normalizeWorkspaces([ws], undefined, null, null, known('s1'), null)
    expect(activeWorkspaceId).toBe('w1')
  })
})

describe('normalizeWorkspaces — legacy migration', () => {
  it('wraps a legacy paneTree into Workspace 1 and gives background sessions their own workspaces', () => {
    // Legacy: a split tree s1 | s2, plus a background session s3 not in the tree.
    const legacyTree = pSplit('sp', 'horizontal', 0.5, pLeaf('s1', 'a'), pLeaf('s2', 'b'))
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
      undefined, // no modern workspaces
      null,
      legacyTree,
      'a',
      known('s1', 's2', 's3'),
      's1'
    )

    expect(workspaces.length).toBe(2)
    // First workspace carries the split layout.
    expect(workspaces[0].paneTree.type).toBe('split')
    expect((workspaces[0].paneTree as any).first.sessionId).toBe('s1')
    // Background session s3 became its own single-leaf workspace.
    const s3Ws = workspaces.find((w) => w.paneTree.type === 'leaf' && (w.paneTree as any).sessionId === 's3')
    expect(s3Ws).toBeDefined()
    // activeWorkspaceId points at the workspace holding legacyActiveSessionId s1.
    expect(activeWorkspaceId).toBe(workspaces[0].id)
  })

  it('with no legacy tree, every known session becomes its own single-leaf workspace', () => {
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
      undefined,
      null,
      null,
      null,
      known('s1', 's2'),
      's2'
    )
    expect(workspaces).toHaveLength(2)
    expect(workspaces.every((w) => w.paneTree.type === 'leaf')).toBe(true)
    // active = the workspace holding legacyActiveSessionId s2.
    const active = workspaces.find((w) => w.id === activeWorkspaceId)
    expect((active?.paneTree as any).sessionId).toBe('s2')
  })

  it('returns empty workspaces and null active when there are no known sessions', () => {
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
      undefined,
      null,
      null,
      null,
      known(),
      null
    )
    expect(workspaces).toHaveLength(0)
    expect(activeWorkspaceId).toBeNull()
  })

  it('preserves the legacy focused pane id when it still exists', () => {
    const legacyTree = pSplit('sp', 'horizontal', 0.5, pLeaf('s1', 'a'), pLeaf('s2', 'b'))
    const { workspaces } = normalizeWorkspaces(undefined, null, legacyTree, 'b', known('s1', 's2'), 's1')
    expect(workspaces[0].focusedPaneId).toBe('b')
  })

  it('falls back to first leaf when legacy focused pane id is pruned', () => {
    const legacyTree = pSplit('sp', 'horizontal', 0.5, pLeaf('s1', 'a'), pLeaf('dead', 'b'))
    const { workspaces } = normalizeWorkspaces(undefined, null, legacyTree, 'dead', known('s1'), 's1')
    expect(workspaces[0].focusedPaneId).toBe('a')
  })

  it('defaults active workspace to first when legacyActiveSessionId is null', () => {
    const legacyTree = pSplit('sp', 'horizontal', 0.5, pLeaf('s1', 'a'), pLeaf('s2', 'b'))
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
      undefined, null, legacyTree, 'a', known('s1', 's2'), null
    )
    expect(activeWorkspaceId).toBe(workspaces[0].id)
  })

  it('defaults active workspace to first when legacyActiveSessionId does not match any', () => {
    const legacyTree = pSplit('sp', 'horizontal', 0.5, pLeaf('s1', 'a'), pLeaf('s2', 'b'))
    const { activeWorkspaceId } = normalizeWorkspaces(
      undefined, null, legacyTree, 'a', known('s1', 's2'), 'nonexistent'
    )
    expect(activeWorkspaceId).toBeDefined()
  })
})

describe('normalizeWorkspaces — immutability', () => {
  it('does not mutate the input persisted workspace array', () => {
    const ws: PersistedWorkspace = { id: 'w1', name: 'A', collectionId: null, paneTree: pLeaf('s1'), focusedPaneId: 's1' }
    const input = [ws]
    const snapshot = JSON.stringify(input)
    normalizeWorkspaces(input, 'w1', null, null, known('s1'), null)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
