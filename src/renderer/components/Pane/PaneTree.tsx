import { useMemo, useRef } from 'react'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useSessionStore } from '../../store/sessionStore'
import type { PaneTree as PaneTreeNode, PaneSplit } from '../../../shared/paneTypes'
import { PaneView } from './PaneView'
import { Sash } from './Sash'
import styles from './PaneTree.module.css'


   
export function PaneTreeRoot() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const focusPane = useWorkspaceStore((s) => s.focusPane)
  const sessions = useSessionStore((s) => s.sessions)


  const mountedRef = useRef<Set<string>>(new Set())

  const sessionById = useMemo(() => {
    const m = new Map<string, (typeof sessions)[number]>()
    for (const s of sessions) m.set(s.id, s)
    return m
  }, [sessions])

  const list = useMemo((): { id: string; tree: PaneTreeNode; focusedPaneId: string | null }[] => {
    return workspaces.map((w) => ({ id: w.id, tree: w.paneTree, focusedPaneId: w.focusedPaneId }))
  }, [workspaces])

  const activeId = activeWorkspaceId ?? (list[0]?.id ?? null)

  if (list.length === 0) return null

  return (
    <>
      {list.map((ws) => {
        const active = ws.id === activeId
        if (active) mountedRef.current.add(ws.id)
        if (!active && !mountedRef.current.has(ws.id)) return null
        return (
          <div
            key={ws.id}
            className={active ? styles.workspaceActive : styles.workspaceHidden}
          >
            {ws.tree && renderNode(ws.tree, ws.tree.id, ws.focusedPaneId, focusPane, sessionById, active)}
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
      <div className={styles.paneContent}>
        <div className={styles.panePlaceholder}>session missing</div>
      </div>
    </div>
  )
}
