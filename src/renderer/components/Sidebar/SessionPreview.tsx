import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSessionStore } from '../../store/sessionStore'
import { useSettingsStore } from '../../store/settingsStore'
import { AGENT_STATUS_LABELS, sessionLocation, sessionTool } from '../../utils/sessionPresentation'
import styles from './SessionPreview.module.css'

type Source = 'pointer' | 'focus'
type Target = { id: string; anchor: HTMLElement }
interface PreviewController {
  activeId: string | null
  tooltipId: string
  enter: (target: Target, source: Source) => void
  leave: (id: string, source: Source) => void
  release: (id: string) => void
  dismiss: () => void
}

const PreviewContext = createContext<PreviewController | null>(null)

export function useSessionPreview(): PreviewController {
  const preview = useContext(PreviewContext)
  if (!preview) throw new Error('SessionItem requires SessionPreviewProvider')
  return preview
}

export function SessionPreviewProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const current = useRef<Target | null>(null)
  const sources = useRef<{ pointer: string | null; focus: string | null; card: boolean; pending: Target | null }>({ pointer: null, focus: null, card: false, pending: null })
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const panel = useRef<HTMLDivElement>(null)
  const tooltipId = useId()
  const settingsOpen = useSettingsStore(state => state.settingsOpen)
  const sidebarVisible = useSessionStore(state => state.sidebarVisible)
  const session = useSessionStore(state => target ? state.sessions.find(item => item.id === target.id) : undefined)
  const activity = useSessionStore(state => target ? state.agentStates[target.id] : undefined)

  const dismiss = useCallback(() => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
    sources.current.pending = null
    sources.current.card = false
    current.current = null
    setTarget(null)
  }, [])

  const hideUnused = useCallback((id: string) => {
    const state = sources.current
    if (state.pointer === id || state.focus === id || (state.card && current.current?.id === id)) return
    if (state.pending?.id === id) {
      clearTimeout(openTimer.current)
      state.pending = null
    }
    if (current.current?.id !== id) return
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      const live = sources.current
      if (live.pointer !== id && live.focus !== id && !live.card && current.current?.id === id) dismiss()
    }, 180)
  }, [dismiss])

  const enter = useCallback((next: Target, source: Source) => {
    if (settingsOpen || sidebarVisible === false || document.querySelector('[aria-modal="true"]')) return
    sources.current[source] = next.id
    clearTimeout(closeTimer.current)
    clearTimeout(openTimer.current)
    sources.current.pending = next
    if (current.current?.id === next.id) return
    openTimer.current = setTimeout(() => {
      const state = sources.current
      if (state.pending === next && next.anchor.isConnected && (state.pointer === next.id || state.focus === next.id)) {
        sources.current.card = false
        sources.current.pending = null
        current.current = next
        setTarget(next)
      }
    }, 400)
  }, [settingsOpen, sidebarVisible])

  const leave = useCallback((id: string, source: Source) => {
    if (sources.current[source] === id) sources.current[source] = null
    hideUnused(id)
  }, [hideUnused])

  const release = useCallback((id: string) => {
    if (sources.current.pointer === id) sources.current.pointer = null
    if (sources.current.focus === id) sources.current.focus = null
    if (sources.current.pending?.id === id) {
      clearTimeout(openTimer.current)
      sources.current.pending = null
    }
    if (current.current?.id === id) dismiss()
  }, [dismiss])

  useEffect(() => () => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
  }, [])

  useEffect(() => {
    if (target && !session) dismiss()
  }, [target, session, dismiss])

  useEffect(() => { if (settingsOpen) dismiss() }, [settingsOpen, dismiss])
  useEffect(() => { if (sidebarVisible === false) dismiss() }, [sidebarVisible, dismiss])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    const focusin = () => { if (document.querySelector('[aria-modal="true"]')) dismiss() }
    const pointerdown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) dismiss()
    }
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) dismiss()
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('focusin', focusin)
    window.addEventListener('pointerdown', pointerdown, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', scroll, true)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('focusin', focusin)
      window.removeEventListener('pointerdown', pointerdown, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [dismiss])

  useLayoutEffect(() => {
    if (!target || !panel.current) return
    const anchor = target.anchor.getBoundingClientRect()
    const card = panel.current.getBoundingClientRect()
    const right = anchor.right + 8
    const left = right + card.width <= window.innerWidth - 12 ? right : anchor.left - card.width - 8
    setPosition({ left: Math.max(12, Math.min(left, window.innerWidth - card.width - 12)), top: Math.max(12, Math.min(anchor.top, window.innerHeight - card.height - 12)) })
  }, [target, session, activity])

  const controller = useMemo(() => ({ activeId: target?.id ?? null, tooltipId, enter, leave, release, dismiss }), [target, tooltipId, enter, leave, release, dismiss])
  return <PreviewContext.Provider value={controller}>
    {children}
    {target && session && createPortal(<div
      ref={panel}
      id={tooltipId}
      role="tooltip"
      className={styles.preview}
      style={position}
      onMouseEnter={() => {
        sources.current.card = true
        clearTimeout(closeTimer.current)
        clearTimeout(openTimer.current)
        sources.current.pending = null
      }}
      onMouseLeave={() => { sources.current.card = false; hideUnused(target.id) }}
    >
      <div className={styles.title}>{session.title}</div>
      <dl className={styles.details}>
        <dt>Tool</dt><dd>{sessionTool(session)}</dd>
        <dt>Status</dt><dd>{activity ? AGENT_STATUS_LABELS[activity.status] : 'Shell session'}</dd>
        {activity && <><dt>Notice</dt><dd>{activity.unread ? 'Unread' : 'Read'}</dd></>}
        <dt>Folder</dt><dd className={styles.path}>{session.cwd || 'Not reported'}</dd>
        {session.shell === 'ssh' && <><dt>Connection</dt><dd className={styles.path}>{sessionLocation(session)}</dd></>}
      </dl>
    </div>, document.getElementById('root') ?? document.body)}
  </PreviewContext.Provider>
}
