import { useState, useRef } from 'react'
import { useSessionStore, type Collection } from '../../store/sessionStore'
import styles from './Sidebar.module.css'

interface CollectionItemProps {
  collection: Collection
  depth: number
  children: React.ReactNode
  onCloseSession: (id: string) => void
  onContextMenu?: (e: React.MouseEvent, collectionId: string) => void
}

export function CollectionItem({ collection, depth, children, onCloseSession, onContextMenu }: CollectionItemProps) {
  const toggleCollectionCollapse = useSessionStore((s) => s.toggleCollectionCollapse)
  const renameCollection = useSessionStore((s) => s.renameCollection)
  const removeCollection = useSessionStore((s) => s.removeCollection)
  const moveSessionToCollection = useSessionStore((s) => s.moveSessionToCollection)
  const moveCollection = useSessionStore((s) => s.moveCollection)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(collection.name)
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsEditing(true)
    setEditValue(collection.name)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleRename = () => {
    const trimmed = editValue.trim()
    if (trimmed) {
      renameCollection(collection.id, trimmed)
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRename()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setEditValue(collection.name)
    }
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    removeCollection(collection.id)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onContextMenu) {
      onContextMenu(e, collection.id)
    }
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation()
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'collection',
      id: collection.id
    }))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const data = e.dataTransfer.types.includes('application/json')
    if (data) {
      e.dataTransfer.dropEffect = 'move'
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type === 'session') {
        moveSessionToCollection(data.id, collection.id)
      } else if (data.type === 'collection' && data.id !== collection.id) {
        moveCollection(data.id, collection.id)
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className={styles.collectionGroup}>
      <div
        className={`${styles.collectionItem} ${isDragOver ? styles.dragOver : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        <button
          className={styles.collapseBtn}
          onClick={(e) => {
            e.stopPropagation()
            toggleCollectionCollapse(collection.id)
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            style={{ transform: collection.collapsed ? 'rotate(-90deg)' : 'none' }}
          >
            <path d="M2 3L5 6L8 3" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </button>

        <svg className={styles.folderIcon} width="14" height="14" viewBox="0 0 14 14">
          <path
            d="M1 3.5C1 2.67 1.67 2 2.5 2H5L6.5 3.5H11.5C12.33 3.5 13 4.17 13 5V10.5C13 11.33 12.33 12 11.5 12H2.5C1.67 12 1 11.33 1 10.5V3.5Z"
            fill="currentColor"
            opacity="0.6"
          />
        </svg>

        {isEditing ? (
          <input
            ref={inputRef}
            className={styles.renameInput}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span className={styles.collectionName}>{collection.name}</span>
        )}

        <button
          className={styles.closeBtn}
          onClick={handleDelete}
          aria-label={`Delete ${collection.name}`}
        >
          <svg width="8" height="8" viewBox="0 0 8 8">
            <path d="M0.5 0.5L7.5 7.5M7.5 0.5L0.5 7.5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>

      <div className={`${styles.collectionChildren} ${collection.collapsed ? styles.collectionCollapsed : ''}`}>
        {children}
      </div>
    </div>
  )
}
