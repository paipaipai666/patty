import type { PersistedWorkspace, Workspace } from './workspaceTypes'
import type { PersistedPaneTree } from './paneTypes'
import {
  normalizePersistedTree,
  firstLeafId,
  findLeaf
} from './paneTreeNormalize'

export function newWorkspaceId(): string {
  return crypto.randomUUID()
}

/** Legacy top-level layout fields from pre-workspace state files. */
export interface LegacyLayout {
  paneTree?: PersistedPaneTree | null
  focusedPaneId?: string | null
}

export function normalizeWorkspaces(
  persistedWorkspaces: PersistedWorkspace[] | undefined,
  persistedActiveWorkspaceId: string | null | undefined,
  knownSessionIds: Set<string>,
  legacy?: LegacyLayout
): { workspaces: Workspace[]; activeWorkspaceId: string | null } {
  // Pre-workspace state files stored the layout in top-level
  // paneTree/focusedPaneId fields. Wrap them as one workspace and let the
  // normal path validate/prune it, so old files upgrade without losing the
  // split layout (REVIEW.md P1-9).
  if ((!persistedWorkspaces || persistedWorkspaces.length === 0) && legacy?.paneTree) {
    const id = newWorkspaceId()
    persistedWorkspaces = [
      {
        id,
        name: 'Workspace 1',
        collectionId: null,
        paneTree: legacy.paneTree,
        focusedPaneId: legacy.focusedPaneId ?? null
      }
    ]
    persistedActiveWorkspaceId = id
  }
  if (!persistedWorkspaces || persistedWorkspaces.length === 0) {
    return { workspaces: [], activeWorkspaceId: null }
  }

  const workspaces: Workspace[] = []

  for (const pw of persistedWorkspaces) {
    const tree = normalizePersistedTree(pw.paneTree, knownSessionIds)
    if (!tree) continue

    let focused = pw.focusedPaneId
    if (!focused || !findLeaf(tree, focused)) {
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
