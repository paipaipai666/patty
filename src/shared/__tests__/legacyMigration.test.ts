import { describe, it, expect } from 'vitest'
import { normalizeWorkspaces } from '../workspaceNormalize'
import type { PersistedState } from '../stateTypes'

// REVIEW.md P1-9 — state files written before the workspace feature carry the
// layout in legacy top-level `paneTree`/`focusedPaneId` fields (with an empty
// `workspaces` array). App.tsx's load effect claims "Legacy paneTree/
// focusedPaneId fields are normalized into workspaces by normalizeWorkspaces
// so old state files upgrade seamlessly" — but normalizeWorkspaces never
// reads those fields, so the split layout is silently dropped and every
// session lands in a fresh single-pane workspace.
//
// This test replays the App load path with a legacy-format state and requires
// the layout to survive the upgrade.

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
  // Pre-workspace schema: the split layout lived at the top level.
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
    // Same call App.tsx makes on load.
    const { workspaces, activeWorkspaceId } = normalizeWorkspaces(
      legacyState.workspaces,
      legacyState.activeWorkspaceId,
      new Set(legacyState.sessions.map((s) => s.id))
    )
    // DESIRED: one workspace holding the legacy split, focused pane preserved.
    // Currently fails: workspaces comes back empty and the layout is gone.
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0].paneTree).toEqual(legacyState.paneTree)
    expect(workspaces[0].focusedPaneId).toBe('l2')
    expect(activeWorkspaceId).toBe(workspaces[0].id)
  })
})
