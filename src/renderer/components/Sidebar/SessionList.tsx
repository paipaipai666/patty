import { useMemo, useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { useSessionStore, type Collection, type TerminalSession } from '../../store/sessionStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { collectTreeSessionIds } from '../../../shared/paneTreeNormalize'
import { SessionItem } from './SessionItem'
import { CollectionItem } from './CollectionItem'
import styles from './Sidebar.module.css'

interface SessionListProps {
  onClose: (id: string) => void
  onSelect: (id: string) => void
  onCollectionContextMenu?: (e: React.MouseEvent, collectionId: string) => void
  searchQuery?: string
}

function renderCollection(
  collection: Collection,
  collections: Collection[],
  sessions: TerminalSession[],
  activeSessionId: string | null,
  onClose: (id: string) => void,
  onSelect: (id: string) => void,
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
      onContextMenu={onCollectionContextMenu}
    >
      {childCollections.map((child) =>
        renderCollection(child, collections, sessions, activeSessionId, onClose, onSelect, onCollectionContextMenu, depth + 1)
      )}
      {childSessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          onClose={onClose}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </CollectionItem>
  )
}

export function SessionList({ onClose, onSelect, onCollectionContextMenu, searchQuery }: SessionListProps) {
  const sessions = useSessionStore((s) => s.sessions)
  const collections = useSessionStore((s) => s.collections)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const loaded = useSessionStore((s) => s.loaded)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const listRef = useRef<HTMLDivElement>(null)
  const prevCount = useRef(0)

  // Build session→workspace lookup for grouping sessions under their workspace.
  const sessionWorkspaceMap = useMemo(() => {
    const map = new Map<string, { wsId: string; wsName: string; wsCollId: string | null }>()
    for (const ws of workspaces) {
      for (const sid of collectTreeSessionIds(ws.paneTree)) {
        map.set(sid, { wsId: ws.id, wsName: ws.name, wsCollId: ws.collectionId })
      }
    }
    return map
  }, [workspaces])

  // Stagger entrance animation for new items
  useGSAP(() => {
    if (!listRef.current) return
    const items = listRef.current.children
    if (items.length > prevCount.current && prevCount.current > 0) {
      // New items added — animate only the new ones
      const newItems = Array.from(items).slice(prevCount.current)
      gsap.from(newItems, {
        x: -40,
        opacity: 0,
        scale: 0.92,
        duration: 0.4,
        stagger: 0.06,
        ease: 'back.out(1.3)',
        clearProps: 'transform,opacity'
      })
    }
    prevCount.current = items.length
  }, { scope: listRef, dependencies: [sessions.map((s) => s.id).join(','), collections.map((c) => c.id).join(',')] })

  const filteredSessions = useMemo(() => {
    if (!searchQuery?.trim()) return sessions
    const query = searchQuery.toLowerCase()
    return sessions.filter((s) => s.title.toLowerCase().includes(query))
  }, [sessions, searchQuery])

  const filteredCollections = useMemo(() => {
    if (!searchQuery?.trim()) return collections
    // Only show collections that contain matching sessions or have matching child collections
    const matchingCollectionIds = new Set<string>()

    // Find collections that directly contain matching sessions
    filteredSessions.forEach((s) => {
      if (s.collectionId) matchingCollectionIds.add(s.collectionId)
    })

    // Include parent collections of matching collections
    const addParents = (id: string) => {
      const col = collections.find((c) => c.id === id)
      if (col?.parentId) {
        matchingCollectionIds.add(col.parentId)
        addParents(col.parentId)
      }
    }
    matchingCollectionIds.forEach(addParents)

    return collections.filter((c) => matchingCollectionIds.has(c.id))
  }, [collections, filteredSessions, searchQuery])

  const topLevelCollections = filteredCollections.filter((c) => c.parentId === null)
  const topLevelSessions = filteredSessions.filter((s) => s.collectionId === null)

  // Group top-level sessions by workspace when workspaces exist.
  const topLevelWorkspaceGroups = useMemo(() => {
    if (workspaces.length === 0) return null
    const groups: { wsId: string; wsName: string; sessions: TerminalSession[] }[] = []
    for (const ws of workspaces) {
      if (ws.collectionId !== null) continue
      const ids = collectTreeSessionIds(ws.paneTree)
      const wsSessions = topLevelSessions.filter((s) => ids.has(s.id))
      if (wsSessions.length > 0) {
        groups.push({ wsId: ws.id, wsName: ws.name, sessions: wsSessions })
      }
    }
    return groups
  }, [workspaces, topLevelSessions])

  // While loading from disk, render nothing to avoid flashing the empty state
  if (!loaded) return null

  if (filteredSessions.length === 0 && filteredCollections.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon}>
          <svg width="24" height="24" viewBox="0 0 48 48" fill="none">
            <rect x="4" y="8" width="40" height="32" rx="4" stroke="currentColor" strokeWidth="2" opacity="0.4" />
            <path d="M12 20L18 26L12 32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
            <path d="M24 32H34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
          </svg>
        </span>
        <span>{searchQuery?.trim() ? 'No matches' : 'No terminals'}</span>
        <span className={styles.emptyHint}>
          {searchQuery?.trim() ? 'Try a different search' : 'Press Ctrl+T or click + to create one'}
        </span>
      </div>
    )
  }

  return (
    <div className={styles.list} ref={listRef} role="tablist" aria-label="Terminal sessions">
      {topLevelCollections.map((collection) =>
        renderCollection(collection, filteredCollections, filteredSessions, activeSessionId, onClose, onSelect, onCollectionContextMenu, 0)
      )}
      {topLevelWorkspaceGroups
        ? topLevelWorkspaceGroups.flatMap((group) => [
            group.sessions.length > 1 ? (
              <div
                key={`ws-hdr-${group.wsId}`}
                className={styles.workspaceHeader}
              >
                {group.wsName}
              </div>
            ) : null,
            ...group.sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onClose={onClose}
                onSelect={onSelect}
                depth={group.sessions.length > 1 ? 1 : 0}
              />
            ))
          ])
        : topLevelSessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onClose={onClose}
              onSelect={onSelect}
              depth={0}
            />
          ))}
    </div>
  )
}
