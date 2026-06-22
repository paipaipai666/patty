import { useState, useRef } from 'react'
import { useSessionStore, type TerminalSession } from '../../store/sessionStore'
import styles from './Sidebar.module.css'

interface SessionItemProps {
  session: TerminalSession
  isActive: boolean
  onClose: (id: string) => void
  depth?: number
}

const COLOR_MAP: Record<string, string> = {
  blue: 'var(--color-blue)',
  green: 'var(--color-green)',
  amber: 'var(--color-amber)',
  coral: 'var(--color-coral)',
  purple: 'var(--color-purple)',
  gray: 'var(--color-gray)'
}

export function SessionItem({ session, isActive, onClose, depth = 0 }: SessionItemProps) {
  const setActive = useSessionStore((s) => s.setActive)
  const renameSession = useSessionStore((s) => s.renameSession)
  const attention = useSessionStore((s) => s.attentionMap[session.id] ?? false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDoubleClick = () => {
    setIsEditing(true)
    setEditValue(session.title)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleRename = () => {
    const trimmed = editValue.trim()
    if (trimmed) {
      renameSession(session.id, trimmed)
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRename()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setEditValue(session.title)
    }
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation()
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'session',
      id: session.id
    }))
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={() => setActive(session.id)}
      onDoubleClick={handleDoubleClick}
      draggable
      onDragStart={handleDragStart}
    >
      <span
        className={`${styles.colorDot} ${attention ? styles.attentionDot : ''}`}
        style={{ backgroundColor: attention ? '#f59e0b' : (COLOR_MAP[session.color] || COLOR_MAP.blue) }}
      />
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
        <span className={styles.itemTitle}>{session.title}</span>
      )}
      <button
        className={styles.closeBtn}
        onClick={(e) => {
          e.stopPropagation()
          onClose(session.id)
        }}
        aria-label={`Close ${session.title}`}
      >
        <svg width="8" height="8" viewBox="0 0 8 8">
          <path d="M0.5 0.5L7.5 7.5M7.5 0.5L0.5 7.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  )
}
