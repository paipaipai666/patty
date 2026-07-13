import { describe, it, expect } from 'vitest'
import { normalizeWorkspaces } from '../workspaceNormalize'
import type { PersistedWorkspace } from '../workspaceTypes'
import type { PersistedPaneTree } from '../paneTypes'

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

describe('normalizeWorkspaces', () => {
  it('normalizes persisted workspaces with valid sessions', () => {
    const ws: PersistedWorkspace = {
      id: 'w1',
      name: 'Work',
      collectionId: null,
      paneTree: pLeaf('s1'),
      focusedPaneId: 's1'
    }
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces([ws], 'w1', known('s1'))
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
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces([ws], 'w1', known('s1'))
    expect(workspaces).toHaveLength(0)
    expect(activeWorkspaceId).toBeNull()
  })

  it('prunes dead leaves inside a split and collapses the survivor', () => {
    const ws: PersistedWorkspace = {
      id: 'w1',
      name: 'W',
      collectionId: null,
      paneTree: pSplit('sp', 'horizontal', 0.5, pLeaf('s1', 'a'), pLeaf('dead', 'b')),
      focusedPaneId: 'a'
    }
    const { workspaces } = normalizeWorkspaces([ws], 'w1', known('s1'))
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
    const { workspaces } = normalizeWorkspaces([ws], 'w1', known('s1', 's2'))
    expect(workspaces[0].focusedPaneId).toBe('a')
  })

  it('resets activeWorkspaceId when it points to a dropped workspace', () => {
    const live: PersistedWorkspace = { id: 'w1', name: 'A', collectionId: null, paneTree: pLeaf('s1'), focusedPaneId: 's1' }
    const dead: PersistedWorkspace = { id: 'w2', name: 'B', collectionId: null, paneTree: pLeaf('dead'), focusedPaneId: 'dead' }
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces([live, dead], 'w2', known('s1'))
    expect(workspaces.map((w) => w.id)).toEqual(['w1'])
    expect(activeWorkspaceId).toBe('w1')
  })

  it('defaults a missing name to "Workspace N"', () => {
    const ws: PersistedWorkspace = { id: 'w1', name: '', collectionId: null, paneTree: pLeaf('s1'), focusedPaneId: 's1' }
    const { workspaces } = normalizeWorkspaces([ws], 'w1', known('s1'))
    expect(workspaces[0].name).toBe('Workspace 1')
  })

  it('activates the first workspace when persistedActiveWorkspaceId is null', () => {
    const ws: PersistedWorkspace = { id: 'w1', name: 'A', collectionId: null, paneTree: pLeaf('s1'), focusedPaneId: 's1' }
    const { activeWorkspaceId } = normalizeWorkspaces([ws], null, known('s1'))
    expect(activeWorkspaceId).toBe('w1')
  })

  it('activates the first workspace when persistedActiveWorkspaceId is undefined', () => {
    const ws: PersistedWorkspace = { id: 'w1', name: 'A', collectionId: null, paneTree: pLeaf('s1'), focusedPaneId: 's1' }
    const { activeWorkspaceId } = normalizeWorkspaces([ws], undefined, known('s1'))
    expect(activeWorkspaceId).toBe('w1')
  })

  it('returns empty workspaces when no persisted workspaces', () => {
    const { workspaces } = normalizeWorkspaces(undefined, null, known())
    expect(workspaces).toHaveLength(0)
  })

  it('does not mutate the input persisted workspace array', () => {
    const ws: PersistedWorkspace = { id: 'w1', name: 'A', collectionId: null, paneTree: pLeaf('s1'), focusedPaneId: 's1' }
    const input = [ws]
    const snapshot = JSON.stringify(input)
    normalizeWorkspaces(input, 'w1', known('s1'))
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
