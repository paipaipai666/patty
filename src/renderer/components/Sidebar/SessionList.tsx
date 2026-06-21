import { useSessionStore, type Collection, type TerminalSession } from '../../store/sessionStore'
import { SessionItem } from './SessionItem'
import { CollectionItem } from './CollectionItem'
import styles from './Sidebar.module.css'

interface SessionListProps {
  onClose: (id: string) => void
  onCollectionContextMenu?: (e: React.MouseEvent, collectionId: string) => void
}

function renderCollection(
  collection: Collection,
  collections: Collection[],
  sessions: TerminalSession[],
  activeSessionId: string | null,
  onClose: (id: string) => void,
  onCollectionContextMenu: ((e: React.MouseEvent, collectionId: string) => void) | undefined,
  depth: number
): React.ReactNode {
  const childCollections = collections.filter((c) => c.parentId === collection.id)
  const childSessions = sessions.filter((s) => s.collectionId === collection.id)

  return (
    <CollectionItem
      key={collection.id}
      collection={collection}
      depth={depth}
      onCloseSession={onClose}
      onContextMenu={onCollectionContextMenu}
    >
      {childCollections.map((child) =>
        renderCollection(child, collections, sessions, activeSessionId, onClose, onCollectionContextMenu, depth + 1)
      )}
      {childSessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          onClose={onClose}
          depth={depth + 1}
        />
      ))}
    </CollectionItem>
  )
}

export function SessionList({ onClose, onCollectionContextMenu }: SessionListProps) {
  const sessions = useSessionStore((s) => s.sessions)
  const collections = useSessionStore((s) => s.collections)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  const topLevelCollections = collections.filter((c) => c.parentId === null)
  const topLevelSessions = sessions.filter((s) => s.collectionId === null)

  if (sessions.length === 0 && collections.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon}>⌨</span>
        <span>No terminals</span>
        <span className={styles.emptyHint}>Press Ctrl+T to create one</span>
      </div>
    )
  }

  return (
    <div className={styles.list}>
      {topLevelCollections.map((collection) =>
        renderCollection(collection, collections, sessions, activeSessionId, onClose, onCollectionContextMenu, 0)
      )}
      {topLevelSessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          onClose={onClose}
          depth={0}
        />
      ))}
    </div>
  )
}
