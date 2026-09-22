import { useState, useRef, useEffect, memo } from 'react'
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
  const prevAttention = useRef<string | null>(null)


  const [glowNonce, setGlowNonce] = useState(0)
  useEffect(() => {
    if (attentionType && attentionType !== prevAttention.current) {
      setGlowNonce((n) => n + 1)
    }
    prevAttention.current = attentionType
  }, [attentionType])


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
    useSessionStore.getState().setDraggingSession(session.id)
  }

  const handleDragEnd = () => {
    useSessionStore.getState().setDraggingSession(null)
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
    ),
    omp: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4 5h16v2.5h-4.5V20h-2.7V7.5h-2.6V20H7.5V7.5H4V5z" />
      </svg>
    ),
    qwen: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.919 14.545 20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06Zm1.306 19.801-6.205-.002 1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z" />
      </svg>
    ),
    copilot: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.922 16.992c-.861 1.495-5.859 5.023-11.922 5.023-6.063 0-11.061-3.528-11.922-5.023A.641.641 0 0 1 0 16.736v-2.869a.841.841 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.195 10.195 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952 1.399-1.136 3.392-2.093 6.122-2.093 2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.832.832 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256ZM12.172 11h-.344a4.323 4.323 0 0 1-.355.508C10.703 12.455 9.555 13 7.965 13c-1.725 0-2.989-.359-3.782-1.259a2.005 2.005 0 0 1-.085-.104L4 11.741v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.323 4.323 0 0 1-.355-.508h-.016.016Zm.641-2.935c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z" />
      </svg>
    )
  }

  const AI_ICON_CLASS: Record<string, string> = {
    claude: styles.aiIconClaude,
    opencode: styles.aiIconOpencode,
    codex: styles.aiIconCodex,
    omp: styles.aiIconOmp,
    qwen: styles.aiIconQwen,
    copilot: styles.aiIconCopilot
  }

  return (
    <div
      className={`${styles.item} ${isActive ? styles.itemActive : ''} ${getAttentionClass()}`}
      style={{ paddingLeft: `${depth * 16 + 8}px`, position: 'relative', overflow: 'hidden' }}
      role="treeitem"
      tabIndex={isEditing ? -1 : 0}
      aria-selected={isActive}
      aria-label={session.title}
      onClick={() => onSelect(session.id)}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      draggable={!isEditing}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {isAi && <ContributionGrid aiType={session.aiType!} />}
      {attentionType && (
        <div key={glowNonce} className={`${styles.glowFx} ${styles[`glow_${attentionType}`]}`} aria-hidden />
      )}
      <div className={styles.itemContent}>
        {isAi ? (
          <span
            className={`${styles.aiIcon} ${AI_ICON_CLASS[session.aiType!]}`}
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
