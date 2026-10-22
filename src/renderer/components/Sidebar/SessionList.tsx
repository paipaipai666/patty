import { useMemo, useRef, useLayoutEffect } from 'react'
import { Code20Regular } from '@fluentui/react-icons'
import {
  useSessionStore,
  type Collection,
  type TerminalSession
} from '../../store/sessionStore'
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
  onCollectionContextMenu:
    ((e: React.MouseEvent, collectionId: string) => void) | undefined,
  depth: number
): React.ReactNode {
  const childCollections = collections.filter(
    (c) => c.parentId === collection.id
  )
  const childSessions = sessions.filter((s) => s.collectionId === collection.id)

  return (
    <CollectionItem
      key={collection.id}
      collection={collection}
      depth={depth}
      onContextMenu={onCollectionContextMenu}
    >
      {childCollections.map((child) =>
        renderCollection(
          child,
          collections,
          sessions,
          activeSessionId,
          onClose,
          onSelect,
          onCollectionContextMenu,
          depth + 1
        )
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

export function SessionList({
  onClose,
  onSelect,
  onCollectionContextMenu,
  searchQuery
}: SessionListProps) {
  const sessions = useSessionStore((s) => s.sessions)
  const collections = useSessionStore((s) => s.collections)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const loaded = useSessionStore((s) => s.loaded)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const treeRef = useRef<HTMLDivElement>(null)
  const focusedTreeId = useRef<string | null>(null)
  const focusedItem = useRef<HTMLElement | null>(null)

  const filteredSessions = useMemo(() => {
    if (!searchQuery?.trim()) return sessions
    const query = searchQuery.toLowerCase()
    return sessions.filter((s) => s.title.toLowerCase().includes(query))
  }, [sessions, searchQuery])

  const filteredCollections = useMemo(() => {
    if (!searchQuery?.trim()) return collections

    const matchingCollectionIds = new Set<string>()

    filteredSessions.forEach((s) => {
      if (s.collectionId) matchingCollectionIds.add(s.collectionId)
    })

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

  const topLevelCollections = filteredCollections.filter(
    (c) => c.parentId === null
  )
  const topLevelSessions = filteredSessions.filter(
    (s) => s.collectionId === null
  )

  const topLevelWorkspaceGroups = useMemo(() => {
    if (workspaces.length === 0) return null
    const groups: {
      wsId: string
      wsName: string
      sessions: TerminalSession[]
    }[] = []
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

  const backgroundSessions = useMemo(() => {
    if (!topLevelWorkspaceGroups) return []
    const inTrees = new Set<string>()
    for (const ws of workspaces) {
      if (ws.collectionId !== null) continue
      for (const id of collectTreeSessionIds(ws.paneTree)) inTrees.add(id)
    }
    return topLevelSessions.filter((s) => !inTrees.has(s.id))
  }, [workspaces, topLevelSessions, topLevelWorkspaceGroups])

  const visibleItems = () =>
    Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []
    ).filter((item) => !item.closest('[hidden]'))

  useLayoutEffect(() => {
    const items = visibleItems()
    const target =
      items.find((item) => item.dataset.treeId === focusedTreeId.current) ??
      items.find((item) => item.getAttribute('aria-selected') === 'true') ??
      items[0]
    for (const item of items) item.tabIndex = item === target ? 0 : -1
    if (
      target &&
      focusedItem.current &&
      !focusedItem.current.isConnected &&
      document.activeElement === document.body
    )
      target.focus()
    if (target) focusedTreeId.current = target.dataset.treeId ?? null
  }, [filteredSessions, filteredCollections, workspaces, activeSessionId])

  const handleTreeFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement)) return
    const target = event.target.closest<HTMLElement>('[role="treeitem"]')
    if (!target) return
    focusedTreeId.current = target.dataset.treeId ?? null
    focusedItem.current = target
    for (const item of visibleItems()) item.tabIndex = item === target ? 0 : -1
  }

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      !(event.target instanceof HTMLElement) ||
      event.target.matches('input, button') ||
      event.nativeEvent.isComposing
    )
      return
    const items = visibleItems()
    const index = items.indexOf(event.target)
    if (index < 0) return
    const current = items[index]
    const level = Number(current.getAttribute('aria-level') ?? 1)
    let target: HTMLElement | undefined
    switch (event.key) {
      case 'ArrowDown':
        target = items[Math.min(index + 1, items.length - 1)]
        break
      case 'ArrowUp':
        target = items[Math.max(index - 1, 0)]
        break
      case 'Home':
        target = items[0]
        break
      case 'End':
        target = items[items.length - 1]
        break
      case 'ArrowRight':
        if (
          current.getAttribute('aria-expanded') === 'false' &&
          current.dataset.collectionId
        ) {
          useSessionStore
            .getState()
            .toggleCollectionCollapse(current.dataset.collectionId)
        } else if (Number(items[index + 1]?.getAttribute('aria-level')) > level)
          target = items[index + 1]
        break
      case 'ArrowLeft':
        if (
          current.getAttribute('aria-expanded') === 'true' &&
          current.dataset.collectionId
        ) {
          useSessionStore
            .getState()
            .toggleCollectionCollapse(current.dataset.collectionId)
        } else
          target = items
            .slice(0, index)
            .reverse()
            .find((item) => Number(item.getAttribute('aria-level')) < level)
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
    target?.focus()
  }

  if (!loaded) return null

  if (filteredSessions.length === 0 && filteredCollections.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon}>
          <Code20Regular aria-hidden />
        </span>
        <span>{searchQuery?.trim() ? 'No matches' : 'No terminals'}</span>
        <span className={styles.emptyHint}>
          {searchQuery?.trim()
            ? 'Try a different search'
            : 'Use New terminal to start a session'}
        </span>
      </div>
    )
  }

  return (
    <div
      ref={treeRef}
      className={styles.list}
      role="tree"
      aria-label="Terminal sessions"
      onFocusCapture={handleTreeFocus}
      onKeyDown={handleTreeKeyDown}
    >
      {searchQuery?.trim() ? (
        filteredSessions.map((session) => (
          <SessionItem
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onClose={onClose}
            onSelect={onSelect}
          />
        ))
      ) : (
        <>
          {topLevelCollections.map((collection) =>
            renderCollection(
              collection,
              filteredCollections,
              filteredSessions,
              activeSessionId,
              onClose,
              onSelect,
              onCollectionContextMenu,
              0
            )
          )}
          {topLevelWorkspaceGroups ? (
            <>
              {topLevelWorkspaceGroups.flatMap((group) => [
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
              ])}
              {backgroundSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onClose={onClose}
                  onSelect={onSelect}
                  depth={0}
                />
              ))}
            </>
          ) : (
            topLevelSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onClose={onClose}
                onSelect={onSelect}
                depth={0}
              />
            ))
          )}
        </>
      )}
    </div>
  )
}
