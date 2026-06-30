import { useMemo } from 'react'
import { usePaneStore } from '../../store/paneStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useSessionStore } from '../../store/sessionStore'
import type { PaneTree as PaneTreeNode, PaneSplit } from '../../../shared/paneTypes'
import { PaneView } from './PaneView'
import { Sash } from './Sash'
import styles from './Pane.module.css'

/**
 * Recursively render the pane split trees of all workspaces.
 *
 * The active workspace renders normally (display:contents so children
 * participate in the parent flex layout). Non-active workspaces render
 * with display:none — their xterm instances stay mounted (preserving PTY
 * and scrollback) but don't paint or consume WebGL contexts.
 *
 * During transition (before App operations switch to workspaceStore) the
 * component falls back to deriving a single workspace from paneStore so
 * existing pane operations continue to render correctly.
 */
export function PaneTreeRoot() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const paneTree = usePaneStore((s) => s.tree)
  const paneFocusedPaneId = usePaneStore((s) => s.focusedPaneId)
  const focusPane = usePaneStore((s) => s.focusPane)
  const sessions = useSessionStore((s) => s.sessions)

  const sessionById = useMemo(() => {
    const m = new Map<string, (typeof sessions)[number]>()
    for (const s of sessions) m.set(s.id, s)
    return m
  }, [sessions])

  const list = useMemo((): { id: string; tree: PaneTreeNode; focusedPaneId: string | null }[] => {
    if (workspaces.length > 0) {
      return workspaces.map((w) => ({ id: w.id, tree: w.paneTree, focusedPaneId: w.focusedPaneId }))
    }
    if (paneTree) {
      return [{ id: 'default', tree: paneTree, focusedPaneId: paneFocusedPaneId }]
    }
    return []
  }, [workspaces, paneTree, paneFocusedPaneId])

  const activeId = activeWorkspaceId ?? (list[0]?.id ?? null)

  if (list.length === 0) return null

  return (
    <>
      {list.map((ws) => {
        const active = ws.id === activeId
        return (
          <div
            key={ws.id}
            style={{
              display: active ? 'contents' : 'none',
              width: '100%',
              height: '100%'
            }}
          >
            {renderNode(ws.tree, ws.tree.id, ws.focusedPaneId, focusPane, sessionById, active)}
          </div>
        )
      })}
    </>
  )
}

function renderNode(
  node: PaneTreeNode,
  key: string,
  focusedPaneId: string | null,
  focusPane: (id: string) => void,
  sessionById: Map<string, import('../../store/sessionStore').TerminalSession>,
  visible: boolean = true
): React.ReactNode {
  if (node.type === 'leaf') {
    const session = sessionById.get(node.sessionId)
    if (!session) {
      // The tree should never reference a missing session (loadFromPersisted
      // prunes them), but guard anyway: render an empty pane instead of crashing.
      return <PaneViewPlaceholder key={key} paneId={node.id} focused={focusedPaneId === node.id} onFocus={focusPane} />
    }
    return (
      <PaneView
        key={node.id}
        session={session}
        paneId={node.id}
        focused={focusedPaneId === node.id}
        onFocus={focusPane}
        visible={visible}
      />
    )
  }

  return renderSplit(node, key, focusedPaneId, focusPane, sessionById, visible)
}

function renderSplit(
  node: PaneSplit,
  key: string,
  focusedPaneId: string | null,
  focusPane: (id: string) => void,
  sessionById: Map<string, import('../../store/sessionStore').TerminalSession>,
  visible: boolean = true
): React.ReactNode {
  const dirClass = node.direction === 'horizontal' ? styles.splitHorizontal : styles.splitVertical
  // ratio is the first subtree's share; express as flex-basis percentage.
  const firstBasis = `${(node.ratio * 100).toFixed(4)}%`

  return (
    <div key={key} className={`${styles.split} ${dirClass}`}>
      <div className={styles.first} style={{ flexBasis: firstBasis, flexGrow: 0, flexShrink: 0 }}>
        {renderNode(node.first, node.first.id, focusedPaneId, focusPane, sessionById, visible)}
      </div>
      <Sash splitId={node.id} direction={node.direction} />
      <div className={styles.second}>
        {renderNode(node.second, node.second.id, focusedPaneId, focusPane, sessionById, visible)}
      </div>
    </div>
  )
}

/** Fallback for a leaf whose session was removed but not yet pruned from the tree. */
function PaneViewPlaceholder({
  paneId,
  focused,
  onFocus
}: {
  paneId: string
  focused: boolean
  onFocus: (id: string) => void
}) {
  return (
    <div
      className={`${styles.paneView} ${focused ? styles.paneViewFocused : ''}`}
      onPointerDown={() => onFocus(paneId)}
    >
      <div className={styles.paneHeader}>
        <span className={styles.paneDot} />
        <span className={styles.paneTitle}>—</span>
      </div>
      <div className={styles.paneContent}>
        <div className={styles.panePlaceholder}>session missing</div>
      </div>
    </div>
  )
}
