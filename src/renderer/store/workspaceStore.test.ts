import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./dirtyScheduler', () => ({
  markDirty: vi.fn()
}))

import { useWorkspaceStore, getFocusedSessionId } from './workspaceStore'
import type { Workspace } from '../../shared/workspaceTypes'

function makeWorkspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    name: `Workspace`,
    collectionId: null,
    paneTree: { id: 'leaf1', type: 'leaf', sessionId: 's1' },
    focusedPaneId: 'leaf1',
    ...overrides
  }
}

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null
  })
})

describe('loadFromPersisted', () => {
  it('restores workspaces and active id', () => {
    const ws = [makeWorkspace({ id: 'w1' })]
    useWorkspaceStore.getState().loadFromPersisted(ws, 'w1')
    const state = useWorkspaceStore.getState()
    expect(state.workspaces).toHaveLength(1)
    expect(state.activeWorkspaceId).toBe('w1')
  })
})

describe('createWorkspace', () => {
  it('creates a workspace with a single-leaf tree', () => {
    const id = useWorkspaceStore.getState().createWorkspace('s1')
    const state = useWorkspaceStore.getState()
    expect(state.workspaces).toHaveLength(1)
    expect(state.activeWorkspaceId).toBe(id)
    expect(state.workspaces[0].paneTree).toEqual({ id: expect.any(String), type: 'leaf', sessionId: 's1' })
  })

  it('accepts an optional collectionId', () => {
    useWorkspaceStore.getState().createWorkspace('s1', 'col1')
    expect(useWorkspaceStore.getState().workspaces[0].collectionId).toBe('col1')
  })
})

describe('switchWorkspace', () => {
  it('switches to a different workspace', () => {
    useWorkspaceStore.getState().loadFromPersisted([
      makeWorkspace({ id: 'w1' }),
      makeWorkspace({ id: 'w2', paneTree: { id: 'l2', type: 'leaf', sessionId: 's2' }, focusedPaneId: 'l2' })
    ], 'w1')
    useWorkspaceStore.getState().switchWorkspace('w2')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('w2')
  })

  it('ignores switching to the already active workspace', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.getState().switchWorkspace('w1')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('w1')
  })

  it('ignores switching to a non-existent workspace', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.getState().switchWorkspace('nope')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('w1')
  })
})

describe('deleteWorkspace', () => {
  it('removes a workspace and switches to another', () => {
    useWorkspaceStore.getState().loadFromPersisted([
      makeWorkspace({ id: 'w1' }),
      makeWorkspace({ id: 'w2', paneTree: { id: 'l2', type: 'leaf', sessionId: 's2' }, focusedPaneId: 'l2' })
    ], 'w1')
    useWorkspaceStore.getState().deleteWorkspace('w1')
    const state = useWorkspaceStore.getState()
    expect(state.workspaces).toHaveLength(1)
    expect(state.activeWorkspaceId).toBe('w2')
  })

  it('sets active to null when deleting the last workspace', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.getState().deleteWorkspace('w1')
    const state = useWorkspaceStore.getState()
    expect(state.workspaces).toHaveLength(0)
    expect(state.activeWorkspaceId).toBeNull()
  })

  it('is a no-op when workspace does not exist', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.getState().deleteWorkspace('nope')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
  })
})

describe('renameWorkspace', () => {
  it('renames a workspace', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1', name: 'Old' })], 'w1')
    useWorkspaceStore.getState().renameWorkspace('w1', 'New')
    expect(useWorkspaceStore.getState().workspaces[0].name).toBe('New')
  })
})

describe('moveWorkspaceToCollection', () => {
  it('sets collectionId on a workspace', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.getState().moveWorkspaceToCollection('w1', 'col1')
    expect(useWorkspaceStore.getState().workspaces[0].collectionId).toBe('col1')
  })

  it('clears collectionId when null', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1', collectionId: 'col1' })], 'w1')
    useWorkspaceStore.getState().moveWorkspaceToCollection('w1', null)
    expect(useWorkspaceStore.getState().workspaces[0].collectionId).toBeNull()
  })
})

describe('splitFocused', () => {
  it('splits the focused leaf in the active workspace', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.getState().splitFocused('s2', 'horizontal')
    const tree = useWorkspaceStore.getState().workspaces[0].paneTree
    expect(tree.type).toBe('split')
  })

  it('is a no-op when there is no active workspace', () => {
    useWorkspaceStore.getState().splitFocused('s2', 'horizontal')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0)
  })
})

describe('replaceFocusedLeaf', () => {
  it('replaces the session in the focused leaf', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.getState().replaceFocusedLeaf('sX')
    expect((useWorkspaceStore.getState().workspaces[0].paneTree as any).sessionId).toBe('sX')
  })

  it('creates a new workspace when none exists', () => {
    useWorkspaceStore.getState().replaceFocusedLeaf('s1')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
    expect((useWorkspaceStore.getState().workspaces[0].paneTree as any).sessionId).toBe('s1')
  })

  it('creates a new workspace when active workspace has no focused pane', () => {
    const ws = makeWorkspace({ id: 'w1' })
    ws.focusedPaneId = null
    useWorkspaceStore.getState().loadFromPersisted([ws], 'w1')
    useWorkspaceStore.getState().replaceFocusedLeaf('s1')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2)
  })
})

describe('closeFocused', () => {
  it('removes the focused leaf and removes the workspace when last leaf', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.getState().closeFocused()
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0)
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull()
  })

  it('removes the focused leaf but preserves the workspace when other leaves remain', () => {
    const tree: any = {
      id: 'sp',
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: { id: 'a', type: 'leaf', sessionId: 's1' },
      second: { id: 'b', type: 'leaf', sessionId: 's2' }
    }
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1', paneTree: tree, focusedPaneId: 'a' })], 'w1')
    useWorkspaceStore.getState().closeFocused()
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('w1')
  })

  it('is a no-op when there is no active workspace', () => {
    useWorkspaceStore.getState().closeFocused()
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0)
  })
})

describe('insertNeighborFocused / insertNeighborAt / replaceLeafAt', () => {
  it('insertNeighborFocused creates workspace when none exists', () => {
    useWorkspaceStore.getState().insertNeighborFocused('s1', 'horizontal', 'second')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
  })

  it('insertNeighborAt creates workspace when none exists', () => {
    useWorkspaceStore.getState().insertNeighborAt('p1', 's1', 'horizontal', 'second')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
  })

  it('replaceLeafAt creates workspace when none exists', () => {
    useWorkspaceStore.getState().replaceLeafAt('p1', 's1')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
  })

  it('replaceLeafAt replaces session at a specific pane when workspace exists', () => {
    const tree: any = {
      id: 'sp', type: 'split', direction: 'horizontal', ratio: 0.5,
      first: { id: 'a', type: 'leaf', sessionId: 's1' },
      second: { id: 'b', type: 'leaf', sessionId: 's2' }
    }
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1', paneTree: tree, focusedPaneId: 'a' })], 'w1')
    useWorkspaceStore.getState().replaceLeafAt('b', 's3')
    const tree2 = useWorkspaceStore.getState().workspaces[0].paneTree as any
    expect(tree2.second.sessionId).toBe('s3')
  })

  it('insertNeighborFocused splits focused leaf when workspace exists', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.getState().insertNeighborFocused('s2', 'horizontal', 'second')
    const tree = useWorkspaceStore.getState().workspaces[0].paneTree
    expect(tree.type).toBe('split')
    expect((tree as any).second.sessionId).toBe('s2')
  })

  it('insertNeighborFocused creates workspace when active workspace has no focused pane', () => {
    const ws = makeWorkspace({ id: 'w1' })
    ws.focusedPaneId = null
    useWorkspaceStore.getState().loadFromPersisted([ws], 'w1')
    useWorkspaceStore.getState().insertNeighborFocused('s2', 'horizontal', 'second')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2)
  })

  it('insertNeighborAt splits at a specific pane when workspace exists', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.getState().insertNeighborAt('leaf1', 's2', 'horizontal', 'second')
    const tree = useWorkspaceStore.getState().workspaces[0].paneTree
    expect(tree.type).toBe('split')
  })

  it('insertNeighborAt creates workspace when active workspace id has no match', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.setState({ workspaces: [] })
    useWorkspaceStore.getState().insertNeighborAt('p1', 's2', 'horizontal', 'second')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
  })

  it('replaceLeafAt creates workspace when active workspace id has no match', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.setState({ workspaces: [] })
    useWorkspaceStore.getState().replaceLeafAt('p1', 'sX')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
  })
})

describe('removeSessionEverywhere', () => {
  it('removes a session from all workspaces', () => {
    useWorkspaceStore.getState().loadFromPersisted([
      makeWorkspace({ id: 'w1', paneTree: { id: 'a', type: 'leaf', sessionId: 's1' }, focusedPaneId: 'a' }),
      makeWorkspace({ id: 'w2', paneTree: { id: 'b', type: 'leaf', sessionId: 's2' }, focusedPaneId: 'b' })
    ], 'w1')
    useWorkspaceStore.getState().removeSessionEverywhere('s1')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('w2')
  })

  it('removes all workspaces when session is in all of them', () => {
    useWorkspaceStore.getState().loadFromPersisted([
      makeWorkspace({ id: 'w1', paneTree: { id: 'a', type: 'leaf', sessionId: 's1' }, focusedPaneId: 'a' }),
      makeWorkspace({ id: 'w2', paneTree: { id: 'b', type: 'leaf', sessionId: 's1' }, focusedPaneId: 'b' })
    ], 'w1')
    useWorkspaceStore.getState().removeSessionEverywhere('s1')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0)
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull()
  })

  it('is a no-op when the session does not exist in any workspace', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.getState().removeSessionEverywhere('nope')
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
  })

  it('heals focusedPaneId when the removed session was focused', () => {
    const tree: any = {
      id: 'sp',
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: { id: 'a', type: 'leaf', sessionId: 's1' },
      second: { id: 'b', type: 'leaf', sessionId: 's2' }
    }
    useWorkspaceStore.getState().loadFromPersisted([
      makeWorkspace({ id: 'w1', paneTree: tree, focusedPaneId: 'a' })
    ], 'w1')
    useWorkspaceStore.getState().removeSessionEverywhere('s1')
    expect(useWorkspaceStore.getState().workspaces[0].focusedPaneId).toBe('b')
  })
})

describe('focusPane / focusNext / focusPrev', () => {
  it('focusPane updates focusedPaneId to a different pane', () => {
    const tree: any = {
      id: 'sp', type: 'split', direction: 'horizontal', ratio: 0.5,
      first: { id: 'a', type: 'leaf', sessionId: 's1' },
      second: { id: 'b', type: 'leaf', sessionId: 's2' }
    }
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1', paneTree: tree, focusedPaneId: 'a' })], 'w1')
    useWorkspaceStore.getState().focusPane('b')
    expect(useWorkspaceStore.getState().workspaces[0].focusedPaneId).toBe('b')
  })

  it('focusPane ignores non-existent pane id', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    useWorkspaceStore.getState().focusPane('nonexistent')
    expect(useWorkspaceStore.getState().workspaces[0].focusedPaneId).toBe('leaf1')
  })

  it('focusNext and focusPrev navigate within a multi-pane tree', () => {
    const tree: any = {
      id: 'sp',
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: { id: 'a', type: 'leaf', sessionId: 's1' },
      second: { id: 'b', type: 'leaf', sessionId: 's2' }
    }
    const ws = makeWorkspace({ id: 'w1', paneTree: tree, focusedPaneId: 'a' })
    useWorkspaceStore.getState().loadFromPersisted([ws], 'w1')
    useWorkspaceStore.getState().focusNext()
    expect(useWorkspaceStore.getState().workspaces[0].focusedPaneId).toBe('b')
    useWorkspaceStore.getState().focusPrev()
    expect(useWorkspaceStore.getState().workspaces[0].focusedPaneId).toBe('a')
  })

  it('is a no-op when there is no active workspace', () => {
    useWorkspaceStore.getState().focusNext()
    useWorkspaceStore.getState().focusPrev()
  })
})

describe('ensureVisible', () => {
  it('returns true when session is in the active workspace', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    expect(useWorkspaceStore.getState().ensureVisible('s1')).toBe(true)
  })

  it('switches workspace when session is in another workspace', () => {
    useWorkspaceStore.getState().loadFromPersisted([
      makeWorkspace({ id: 'w1' }),
      makeWorkspace({ id: 'w2', paneTree: { id: 'l2', type: 'leaf', sessionId: 's2' }, focusedPaneId: 'l2' })
    ], 'w1')
    expect(useWorkspaceStore.getState().ensureVisible('s2')).toBe(true)
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('w2')
  })

  it('creates a new workspace when session is not found anywhere', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    expect(useWorkspaceStore.getState().ensureVisible('new-session')).toBe(false)
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2)
  })

  it('focuses the leaf if session exists but is not focused', () => {
    const tree: any = {
      id: 'sp',
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: { id: 'a', type: 'leaf', sessionId: 's1' },
      second: { id: 'b', type: 'leaf', sessionId: 's2' }
    }
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1', paneTree: tree, focusedPaneId: 'a' })], 'w1')
    useWorkspaceStore.getState().ensureVisible('s2')
    expect(useWorkspaceStore.getState().workspaces[0].focusedPaneId).toBe('b')
  })
})

describe('setSplitRatio', () => {
  it('sets ratio on a split in the active workspace', () => {
    const tree: any = {
      id: 'sp',
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: { id: 'a', type: 'leaf', sessionId: 's1' },
      second: { id: 'b', type: 'leaf', sessionId: 's2' }
    }
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1', paneTree: tree })], 'w1')
    useWorkspaceStore.getState().setSplitRatio('sp', 0.7)
    expect((useWorkspaceStore.getState().workspaces[0].paneTree as any).ratio).toBeCloseTo(0.7)
  })
})

describe('toPersisted', () => {
  it('serializes workspaces to persisted format', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    const result = useWorkspaceStore.getState().toPersisted()
    expect(result.workspaces).toHaveLength(1)
    expect(result.activeWorkspaceId).toBe('w1')
    expect(result.workspaces[0].id).toBe('w1')
    expect(result.workspaces[0].paneTree).toEqual({ id: 'leaf1', type: 'leaf', sessionId: 's1' })
  })
})

describe('getFocusedSessionId', () => {
  it('returns the sessionId of the focused leaf', () => {
    useWorkspaceStore.getState().loadFromPersisted([makeWorkspace({ id: 'w1' })], 'w1')
    expect(getFocusedSessionId()).toBe('s1')
  })

  it('returns null when there is no active workspace', () => {
    expect(getFocusedSessionId()).toBeNull()
  })
})
