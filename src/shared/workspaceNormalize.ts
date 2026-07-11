import type { PersistedWorkspace, Workspace } from './workspaceTypes'
import {
  normalizePersistedTree,
  firstLeafId,
  findLeaf
} from './paneTreeNormalize'

export function newWorkspaceId(): string {
  return crypto.randomUUID()
}

export function normalizeWorkspaces(
  persistedWorkspaces: PersistedWorkspace[] | undefined,
  persistedActiveWorkspaceId: string | null | undefined,
  knownSessionIds: Set<string>
): { workspaces: Workspace[]; activeWorkspaceId: string | null } {
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
