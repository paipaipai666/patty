import { useState, useRef, useEffect, memo } from 'react'
import gsap from 'gsap'
import { useSessionStore, SESSION_COLOR_VARS, type TerminalSession } from '../../store/sessionStore'
import { ContributionGrid } from '../ContributionGrid/ContributionGrid'
import styles from './Sidebar.module.css'

interface SessionItemProps {
  session: TerminalSession
  isActive: boolean
  onClose: (id: string) => void
  onSelect: (id: string) => void
  depth?: number
}

export const SessionItem = memo(function SessionItem({ session, isActive, onClose, onSelect, depth = 0 }: SessionItemProps) {
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
      const style = getComputedStyle(document.documentElement)
      const colorMap: Record<string, string> = {
        permission: style.getPropertyValue('--attention-permission-glow').trim() || 'rgba(99,102,241,0.4)',
        complete: style.getPropertyValue('--attention-complete-glow').trim() || 'rgba(52,211,153,0.4)',
        error: style.getPropertyValue('--attention-error-glow').trim() || 'rgba(248,113,113,0.4)'
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
      onSelect(session.id)
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
    ),
    codex: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd">
        <path clipRule="evenodd" d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z" />
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
      onClick={() => onSelect(session.id)}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      draggable={!isEditing}
      onDragStart={handleDragStart}
    >
      {isAi && <ContributionGrid aiType={session.aiType!} />}
      <div className={styles.itemContent}>
        {isAi ? (
          <span
            className={`${styles.aiIcon} ${
              session.aiType === 'claude'
                ? styles.aiIconClaude
                : session.aiType === 'codex'
                  ? styles.aiIconCodex
                  : styles.aiIconOpencode
            }`}
          >
            {AI_ICONS[session.aiType!]}
          </span>
        ) : (
          <span
            className={styles.colorDot}
            style={{ backgroundColor: SESSION_COLOR_VARS[session.color] || 'var(--color-blue)' }}
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
          type="button"
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
})
