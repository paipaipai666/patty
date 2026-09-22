import { describe, it, expect } from 'vitest'
import { normalizeWorkspaces } from '../workspaceNormalize'
import type { PersistedState } from '../stateTypes'



const legacyState: PersistedState = {
  sessions: [
    { id: 's1', title: 'T1', color: 'blue', cwd: '', shell: 'powershell', createdAt: 1, collectionId: null },
    { id: 's2', title: 'T2', color: 'green', cwd: '', shell: 'cmd', createdAt: 2, collectionId: null }
  ],
  collections: [],
  activeSessionId: 's1',
  sidebarVisible: true,
  sidebarWidth: 220,
  workspaces: [],
  activeWorkspaceId: null,

  paneTree: {
    type: 'split',
    id: 'sp1',
    direction: 'horizontal',
    ratio: 0.4,
    first: { type: 'leaf', id: 'l1', sessionId: 's1' },
    second: { type: 'leaf', id: 'l2', sessionId: 's2' }
  },
  focusedPaneId: 'l2'
}

describe('legacy paneTree migration into workspaces (REVIEW P1-9)', () => {
  it('upgrades a pre-workspace state file without losing the split layout', () => {

    const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
      legacyState.workspaces,
      legacyState.activeWorkspaceId,
      new Set(legacyState.sessions.map((s) => s.id)),
      { paneTree: legacyState.paneTree, focusedPaneId: legacyState.focusedPaneId }
    )

    expect(workspaces).toHaveLength(1)
    expect(workspaces[0].paneTree).toEqual(legacyState.paneTree)
    expect(workspaces[0].focusedPaneId).toBe('l2')
    expect(activeWorkspaceId).toBe(workspaces[0].id)
  })
})
