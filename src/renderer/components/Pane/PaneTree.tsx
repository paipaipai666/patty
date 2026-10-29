import { useMemo, useRef, type CSSProperties } from 'react'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useSessionStore } from '../../store/sessionStore'
import { PaneView } from './PaneView'
import { Sash } from './Sash'
import { layoutPanes } from './paneLayout'
import styles from './PaneTree.module.css'

interface SashStyle extends CSSProperties {
  '--sash-offset': string
}

export function PaneTreeRoot() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const focusPane = useWorkspaceStore((s) => s.focusPane)
  const sessions = useSessionStore((s) => s.sessions)
  const mountedWorkspacesRef = useRef(new Set<string>())
  const mountedSessionsRef = useRef(new Set<string>())
  const sessionById = useMemo(() => new Map(sessions.map(session => [session.id, session])), [sessions])
  const layouts = useMemo(() => workspaces.map(workspace => ({
    workspace,
    layout: layoutPanes(workspace.paneTree)
  })), [workspaces])
  const activeId = activeWorkspaceId ?? workspaces[0]?.id

  if (workspaces.length === 0) return null
  if (activeId) mountedWorkspacesRef.current.add(activeId)

  return (
    <div className={styles.paneTree}>
      {layouts.flatMap(({ workspace, layout }) => {
        const visible = workspace.id === activeId
        const visited = mountedWorkspacesRef.current.has(workspace.id)
        return layout.panes.flatMap(({ leaf, style }) => {
          if (!visited && !mountedSessionsRef.current.has(leaf.sessionId)) return []
          mountedSessionsRef.current.add(leaf.sessionId)
          const session = sessionById.get(leaf.sessionId)
          const focused = workspace.focusedPaneId === leaf.id
          return (
            <div
              key={leaf.sessionId}
              className={`${styles.paneSlot} ${visible ? styles.workspaceActive : styles.workspaceHidden}`}
              style={style}
            >
              {session ? (
                <PaneView
                  session={session}
                  paneId={leaf.id}
                  focused={focused}
                  onFocus={focusPane}
                  visible={visible}
                />
              ) : (
                <div
                  className={`${styles.placeholder} ${focused ? styles.placeholderFocused : ''}`}
                  onPointerDown={() => focusPane(leaf.id)}
                >
                  session missing
                </div>
              )}
            </div>
          )
        })
      })}
      {layouts.flatMap(({ workspace, layout }) => {
        if (workspace.id !== activeId) return []
        return layout.splits.map(({ split, style }) => {
          const sashStyle: SashStyle = { ...style, '--sash-offset': `${split.ratio * 100}%` }
          return (
            <div
              key={split.id}
              className={`${styles.sashFrame} ${split.direction === 'horizontal' ? styles.horizontalSash : styles.verticalSash}`}
              style={sashStyle}
            >
              <Sash splitId={split.id} direction={split.direction} ratio={split.ratio} />
            </div>
          )
        })
      })}
    </div>
  )
}
