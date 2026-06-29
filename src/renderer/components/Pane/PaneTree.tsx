import { useMemo } from 'react'
import { usePaneStore } from '../../store/paneStore'
import { useSessionStore } from '../../store/sessionStore'
import type { PaneTree as PaneTreeNode, PaneSplit } from '../../../shared/paneTypes'
import { PaneView } from './PaneView'
import { Sash } from './Sash'
import styles from './Pane.module.css'

/**
 * Recursively render the pane split tree.
 *
 * A leaf → PaneView (with the session from sessionStore). A split → two
 * subtrees with a Sash between them, laid out via flex: the first subtree's
 * flex-basis comes from the split ratio, the second takes the remainder.
 *
 * Pane nodes are keyed by their stable pane id so React preserves subtree
 * instances across restructures (split/close/drag-in). This matters because
 * the real TerminalPane holds an xterm instance — remounting it would lose
 * scrollback and respawn the PTY.
 */
export function PaneTreeRoot() {
  const tree = usePaneStore((s) => s.tree)
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId)
  const focusPane = usePaneStore((s) => s.focusPane)
  const sessions = useSessionStore((s) => s.sessions)

  // Index sessions by id once per render change; lookup is O(1) per leaf.
  const sessionById = useMemo(() => {
    const m = new Map<string, (typeof sessions)[number]>()
    for (const s of sessions) m.set(s.id, s)
    return m
  }, [sessions])

  if (!tree) return null

  return renderNode(tree, tree.id, focusedPaneId, focusPane, sessionById)
}

function renderNode(
  node: PaneTreeNode,
  key: string,
  focusedPaneId: string | null,
  focusPane: (id: string) => void,
  sessionById: Map<string, import('../../store/sessionStore').TerminalSession>
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
      />
    )
  }

  return renderSplit(node, key, focusedPaneId, focusPane, sessionById)
}

function renderSplit(
  node: PaneSplit,
  key: string,
  focusedPaneId: string | null,
  focusPane: (id: string) => void,
  sessionById: Map<string, import('../../store/sessionStore').TerminalSession>
): React.ReactNode {
  const dirClass = node.direction === 'horizontal' ? styles.splitHorizontal : styles.splitVertical
  // ratio is the first subtree's share; express as flex-basis percentage.
  const firstBasis = `${(node.ratio * 100).toFixed(4)}%`

  return (
    <div key={key} className={`${styles.split} ${dirClass}`}>
      <div className={styles.first} style={{ flexBasis: firstBasis, flexGrow: 0, flexShrink: 0 }}>
        {renderNode(node.first, node.first.id, focusedPaneId, focusPane, sessionById)}
      </div>
      <Sash splitId={node.id} direction={node.direction} />
      <div className={styles.second}>
        {renderNode(node.second, node.second.id, focusedPaneId, focusPane, sessionById)}
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
