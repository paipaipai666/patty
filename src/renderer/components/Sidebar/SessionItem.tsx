import { useState, useRef, useEffect } from 'react'
import gsap from 'gsap'
import { useSessionStore, type TerminalSession } from '../../store/sessionStore'
import { ContributionGrid } from '../ContributionGrid/ContributionGrid'
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
  const attentionType = useSessionStore((s) => s.attentionMap[session.id] ?? null)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRef = useRef<HTMLDivElement>(null)
  const prevAttention = useRef<string | null>(null)
  const attentionTimelineRef = useRef<gsap.core.Timeline | null>(null)

  // Attention state entrance animation
  useEffect(() => {
    if (attentionType && attentionType !== prevAttention.current && itemRef.current) {
      attentionTimelineRef.current?.kill()
      const colorMap: Record<string, string> = {
        permission: 'rgba(99,102,241,0.4)',
        complete: 'rgba(52,211,153,0.4)',
        error: 'rgba(248,113,113,0.4)'
      }
      const glow = document.createElement('div')
      glow.style.cssText = `
        position:absolute; left:-20px; top:50%; width:40px; height:40px;
        border-radius:50%; pointer-events:none;
        background:radial-gradient(circle, ${colorMap[attentionType] || colorMap.complete}, transparent);
        transform:translateY(-50%) scale(0); opacity:0;
      `
      itemRef.current.appendChild(glow)

      const tl = gsap.timeline({
        onComplete: () => {
          if (glow.parentNode) glow.parentNode.removeChild(glow)
          attentionTimelineRef.current = null
        }
      })
      attentionTimelineRef.current = tl
      tl.to(glow, { scale: 1.5, opacity: 0.6, duration: 0.35, ease: 'power2.out' })
        .to(glow, { scale: 2.5, opacity: 0, duration: 0.7, ease: 'power2.out' })
    }
    prevAttention.current = attentionType
    return () => {
      attentionTimelineRef.current?.kill()
      attentionTimelineRef.current = null
    }
  }, [attentionType])

  // Map attention type to CSS class name
  const getAttentionClass = () => {
    if (!attentionType) return ''
    switch (attentionType) {
      case 'permission':
        return styles['itemAttention-permission']
      case 'complete':
        return styles['itemAttention-complete']
      case 'error':
        return styles['itemAttention-error']
      default:
        return ''
    }
  }

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
    if (isEditing) {
      if (e.key === 'Enter') {
        handleRename()
      } else if (e.key === 'Escape') {
        setIsEditing(false)
        setEditValue(session.title)
      }
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setActive(session.id)
    } else if (e.key === 'F2') {
      e.preventDefault()
      handleDoubleClick()
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

  const isAi = !!session.aiType

  const AI_ICONS: Record<string, JSX.Element> = {
    claude: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z" />
      </svg>
    ),
    opencode: (
      <svg width="14" height="14" viewBox="0 0 512 512" fill="currentColor">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" />
      </svg>
    )
  }

  return (
    <div
      ref={itemRef}
      className={`${styles.item} ${isActive ? styles.itemActive : ''} ${getAttentionClass()}`}
      style={{ paddingLeft: `${depth * 16 + 8}px`, position: 'relative', overflow: 'hidden' }}
      role="tab"
      tabIndex={isEditing ? -1 : 0}
      aria-selected={isActive}
      aria-label={session.title}
      onClick={() => setActive(session.id)}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      draggable={!isEditing}
      onDragStart={handleDragStart}
    >
      {isAi && <ContributionGrid aiType={session.aiType!} />}
      <div className={styles.itemContent}>
        {isAi ? (
          <span className={`${styles.aiIcon} ${session.aiType === 'claude' ? styles.aiIconClaude : styles.aiIconOpencode}`}>
            {AI_ICONS[session.aiType!]}
          </span>
        ) : (
          <span
            className={styles.colorDot}
            style={{ backgroundColor: COLOR_MAP[session.color] || COLOR_MAP.blue }}
          />
        )}
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
    </div>
  )
}
