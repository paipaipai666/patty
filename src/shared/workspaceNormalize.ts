import type { PersistedWorkspace, Workspace } from './workspaceTypes'
import type { PersistedPaneTree } from './paneTypes'
import {
  normalizePersistedTree,
  singleLeafTree,
  treeHasSession,
  firstLeafId,
  collectTreeSessionIds,
  findLeafById
} from './paneTreeNormalize'

export function newWorkspaceId(): string {
  return crypto.randomUUID()
}

/**
 * Normalize persisted workspace data into trusted runtime workspace objects.
 *
 * Two code paths:
 *
 * 1. **Modern** — `persistedWorkspaces` is non-empty: each workspace's pane
 *    tree is normalized (dead sessions pruned), empty workspaces are dropped,
 *    and the active workspace id is validated.
 *
 * 2. **Legacy migration** — no modern workspace data: the old `paneTree` +
 *    `focusedPaneId` (`legacyPaneTree` / `legacyFocusedPaneId`) are wrapped
 *    into a single "Workspace 1". Sessions in `knownSessionIds` that were NOT
 *    in the old pane tree each become their own single-leaf workspace. This
 *    preserves the user's existing split layout while giving background
 *    sessions their own workspace.
 *
 * @returns Normalized workspace list and valid active workspace id (null if
 *          no workspaces survive).
 */
export function normalizeWorkspaces(
  persistedWorkspaces: PersistedWorkspace[] | undefined,
  persistedActiveWorkspaceId: string | null | undefined,
  legacyPaneTree: PersistedPaneTree | null | undefined,
  legacyFocusedPaneId: string | null | undefined,
  knownSessionIds: Set<string>,
  legacyActiveSessionId: string | null
): { workspaces: Workspace[]; activeWorkspaceId: string | null } {
  // ── Modern path ──────────────────────────────────────────────────────
  if (persistedWorkspaces && persistedWorkspaces.length > 0) {
    const workspaces: Workspace[] = []

    for (const pw of persistedWorkspaces) {
      const tree = normalizePersistedTree(pw.paneTree, knownSessionIds)
      if (!tree) continue // all leaves pruned → drop this workspace

      let focused = pw.focusedPaneId
      if (!focused || !findLeafById(tree, focused)) {
        focused = firstLeafId(tree)
      }

      workspaces.push({
        id: pw.id,
        name: pw.name || `Workspace ${workspaces.length + 1}`,
        collectionId: pw.collectionId ?? null,
        paneTree: tree,
        focusedPaneId: focused
      })
    }

    let activeId = persistedActiveWorkspaceId ?? null
    if (activeId && !workspaces.some((w) => w.id === activeId)) {
      activeId = workspaces[0]?.id ?? null
    }
    if (activeId === null && workspaces.length > 0) {
      activeId = workspaces[0].id
    }

    return { workspaces, activeWorkspaceId: activeId }
  }

  // ── Legacy migration ─────────────────────────────────────────────────
  const workspaces: Workspace[] = []
  const defaultTree = normalizePersistedTree(legacyPaneTree ?? null, knownSessionIds)

  if (defaultTree) {
    const treeSessionIds = collectTreeSessionIds(defaultTree)

    let focused = legacyFocusedPaneId ?? null
    if (!focused || !findLeafById(defaultTree, focused)) {
      focused = firstLeafId(defaultTree)
    }

    workspaces.push({
      id: newWorkspaceId(),
      name: 'Workspace 1',
      collectionId: null,
      paneTree: defaultTree,
      focusedPaneId: focused
    })

    for (const sid of knownSessionIds) {
      if (!treeSessionIds.has(sid)) {
        const leaf = singleLeafTree(sid)
        workspaces.push({
          id: newWorkspaceId(),
          name: `Workspace ${workspaces.length + 1}`,
          collectionId: null,
          paneTree: leaf,
          focusedPaneId: leaf.id
        })
      }
    }
  } else {
    for (const sid of knownSessionIds) {
      const leaf = singleLeafTree(sid)
      workspaces.push({
        id: newWorkspaceId(),
        name: `Workspace ${workspaces.length + 1}`,
        collectionId: null,
        paneTree: leaf,
        focusedPaneId: leaf.id
      })
    }
  }

  let activeId: string | null = null
  if (legacyActiveSessionId) {
    for (const w of workspaces) {
      if (treeHasSession(w.paneTree, legacyActiveSessionId)) {
        activeId = w.id
        break
      }
    }
  }
  if (!activeId && workspaces.length > 0) {
    activeId = workspaces[0].id
  }

  return { workspaces, activeWorkspaceId: activeId }
}
