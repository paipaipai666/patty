import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown16Regular, ArrowUp16Regular, ArrowUndo16Regular, Dismiss16Regular, Search16Regular } from '@fluentui/react-icons'
import { focusActiveTerminal } from '../../commands/useApplicationKeyboard'
import { isComposingKey } from '../../commands/shortcuts'
import { useOmpNavigationStore } from '../../store/ompNavigationStore'
import { getFocusedSessionId, useWorkspaceStore } from '../../store/workspaceStore'
import styles from './TurnNavigation.module.css'

const ROW_HEIGHT = 12
const MAX_HEIGHT = 276
const LINE_LENGTHS = [48, 34, 22, 15, 10]
const timeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function TurnNavigation({ open, onOpenChange, blocked }: { open: boolean; onOpenChange: (open: boolean) => void; blocked: boolean }) {
  const sessionId = useWorkspaceStore(() => getFocusedSessionId())
  const state = useOmpNavigationStore(store => sessionId ? store.byPane[sessionId] : undefined)
  const rail = useRef<HTMLElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const flyout = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const pointerY = useRef<number | null>(null)
  const composing = useRef(false)
  const [inside, setInside] = useState(false)
  const [focused, setFocused] = useState(false)
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(MAX_HEIGHT)
  const [flyoutPosition, setFlyoutPosition] = useState({ top: 0, left: 0 })
  const id = useId()
  const snapshot = state?.snapshot
  const available = state?.status === 'ready' && Boolean(snapshot?.scope)
  const turns = state?.turns
  const results = useMemo(() => {
    const words = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
    return (turns ?? []).filter(turn => words.every(word => turn.preview.normalize('NFKC').toLocaleLowerCase().includes(word)))
  }, [turns, query])
  const position = state?.shownPosition
  const currentId = position?.mode === 'browsing' ? position.entryId : null
  const current = turns?.find(turn => turn.entryId === currentId)
  const active = results.find(turn => turn.entryId === activeId) ?? results.find(turn => turn.entryId === currentId) ?? results.at(-1)
  const activeIndex = active ? results.indexOf(active) : -1
  const engaged = open || inside || focused
  const request = snapshot?.latestRequest
  const applied = request?.status.kind === 'applied' ? request.status : null
  const waiting = applied && !applied.shown && applied.position.frameId === snapshot?.position.frameId
    && applied.position.branchEpoch === snapshot.position.branchEpoch && applied.position.displayEpoch === snapshot.position.displayEpoch
    && applied.position.viewRevision === snapshot.position.viewRevision
  const inFlight = state?.navigating || request?.status.kind === 'queued' || request?.status.kind === 'accepted'
  const navigationError = state?.status === 'ready' && Boolean(state.error)
  let status = position?.mode === 'browsing' ? current ? `Turn ${current.ordinal.toLocaleString()} of ${turns?.length.toLocaleString()}` : 'Browsing history' : 'Live terminal'
  if (!state || state.status === 'loading') status = 'Connecting to OMP…'
  else if (state.status === 'unavailable') status = 'This terminal needs a compatible OMP navigation adapter.'
  else if (state.status === 'error') status = 'Could not load conversation turns.'
  else if (navigationError) status = 'Could not change terminal position. Select the turn again to retry.'
  else if (waiting) status = request?.observationTimedOut ? 'Terminal display not confirmed' : 'Waiting for terminal display…'
  else if (inFlight) status = 'Jumping to turn…'
  else if (request?.status.kind === 'failed') status = 'Could not change terminal position'
  else if (request?.status.kind === 'expired') status = 'Navigation expired. Try again.'
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 3)
  const end = Math.min(results.length, first + Math.ceil(height / ROW_HEIGHT) + 6)
  const visible = results.slice(first, end).map((turn, offset) => ({ turn, index: first + offset }))
  if (active && (activeIndex < first || activeIndex >= end) && focused) visible.push({ turn: active, index: activeIndex })

  useEffect(() => {
    if (!sessionId) return
    void useOmpNavigationStore.getState().start(sessionId)
    return () => useOmpNavigationStore.getState().stop(sessionId)
  }, [sessionId])

  const previousSession = useRef(sessionId)
  useEffect(() => {
    if (previousSession.current === sessionId) return
    previousSession.current = sessionId
    setInside(false)
    setFocused(false)
    setQuery('')
    setActiveId(null)
    pointerY.current = null
    onOpenChange(false)
  }, [sessionId, onOpenChange])

  useLayoutEffect(() => { if (open && !blocked) input.current?.focus() }, [open, blocked])

  useEffect(() => {
    if (!blocked) return
    setInside(false)
    setFocused(false)
    pointerY.current = null
  }, [blocked])

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const index = query ? 0 : Math.max(0, results.findIndex(turn => turn.entryId === currentId))
    const target = query || currentId ? index : Math.max(0, results.length - 1)
    element.scrollTop = Math.max(0, target * ROW_HEIGHT - (element.clientHeight || MAX_HEIGHT) / 2)
    setScrollTop(element.scrollTop)
  }, [sessionId, snapshot?.runId, Boolean(turns?.length), currentId, query, open, blocked])

  useEffect(() => {
    const element = viewport.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setHeight(element.clientHeight || MAX_HEIGHT))
    observer.observe(element)
    return () => observer.disconnect()
  }, [Boolean(turns?.length), open, blocked])

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return
      event.preventDefault()
      event.stopPropagation()
      const delta = event.deltaY * (event.deltaMode === 1 ? ROW_HEIGHT : event.deltaMode === 2 ? element.clientHeight : 1)
      element.scrollTop = Math.max(0, Math.min(results.length * ROW_HEIGHT - element.clientHeight, element.scrollTop + delta))
      setScrollTop(element.scrollTop)
      if (pointerY.current !== null) setActiveId(results[Math.floor((element.scrollTop + pointerY.current) / ROW_HEIGHT)]?.entryId ?? null)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [results, open, blocked])

  const placeFlyout = useCallback(() => {
    if (!rail.current || !flyout.current) return
    const rect = rail.current.getBoundingClientRect()
    const card = flyout.current.getBoundingClientRect()
    const desired = rect.top + Math.max(0, activeIndex * ROW_HEIGHT - scrollTop) - 40
    const top = Math.max(12, Math.min(desired, window.innerHeight - card.height - 12))
    const left = Math.max(8, Math.min(rect.left - card.width, window.innerWidth - card.width - 8))
    setFlyoutPosition(previous => previous.top === top && previous.left === left ? previous : { top, left })
  }, [activeIndex, scrollTop])

  useLayoutEffect(() => { if (engaged) placeFlyout() }, [engaged, placeFlyout, open, state?.status, query, height])

  useEffect(() => {
    if (!engaged) return
    window.addEventListener('resize', placeFlyout)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(placeFlyout)
    if (flyout.current) observer?.observe(flyout.current)
    return () => { window.removeEventListener('resize', placeFlyout); observer?.disconnect() }
  }, [engaged, placeFlyout])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rail.current?.contains(event.target) && !flyout.current?.contains(event.target)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, onOpenChange])

  const dismiss = () => {
    onOpenChange(false)
    setInside(false)
    setFocused(false)
    setQuery('')
    setActiveId(null)
    pointerY.current = null
    focusActiveTerminal()
  }
  const leave = (target: EventTarget | null) => {
    if (target instanceof Node && (rail.current?.contains(target) || flyout.current?.contains(target))) return
    setInside(false)
    pointerY.current = null
    if (!focused && !open) setActiveId(null)
  }
  const navigate = (entryId: string) => {
    if (!sessionId || !available || blocked) return
    void useOmpNavigationStore.getState().navigate(sessionId, { kind: 'turn', entryId })
    dismiss()
  }
  const keydown = (event: KeyboardEvent<HTMLElement>) => {
    if (composing.current || isComposingKey(event.nativeEvent)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (query) { setQuery(''); setActiveId(null) } else dismiss()
    } else if (!event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
      && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)
      && (event.target === viewport.current || event.target === input.current)
      && (!['Home', 'End'].includes(event.key) || event.target !== input.current || !query)) {
      event.preventDefault()
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? results.length - 1 : activeIndex + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : event.key === 'PageDown' ? Math.floor(height / ROW_HEIGHT) : -Math.floor(height / ROW_HEIGHT))
      const next = Math.max(0, Math.min(results.length - 1, index))
      setActiveId(results[next]?.entryId ?? null)
      const element = viewport.current
      if (element) {
        if (next * ROW_HEIGHT < element.scrollTop) element.scrollTop = next * ROW_HEIGHT
        else if ((next + 1) * ROW_HEIGHT > element.scrollTop + height) element.scrollTop = (next + 1) * ROW_HEIGHT - height
        setScrollTop(element.scrollTop)
      }
    } else if (event.key === 'Enter' && !event.repeat && active && (event.target === viewport.current || event.target === input.current)) {
      event.preventDefault()
      navigate(active.entryId)
    }
  }

  if (!sessionId || blocked || (!open && (!available || !turns?.length))) return null
  const activeDomId = active && visible.some(item => item.turn.entryId === active.entryId) ? `${id}-${active.entryId}` : undefined
  return <nav ref={rail} className={styles.rail} aria-label="Conversation navigation" data-turn-rail data-expanded={engaged}
    onPointerEnter={() => setInside(true)} onPointerLeave={event => leave(event.relatedTarget)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!(event.relatedTarget instanceof Node) || !rail.current?.contains(event.relatedTarget) && !flyout.current?.contains(event.relatedTarget)) setFocused(false) }}
    onKeyDown={keydown} onContextMenu={event => event.stopPropagation()}>
    <div ref={viewport} id={`${id}-list`} className={styles.viewport} data-turn-viewport role="listbox" aria-label="Conversation turns" tabIndex={0} aria-activedescendant={activeDomId}
      style={{ height: Math.max(ROW_HEIGHT, Math.min(MAX_HEIGHT, results.length * ROW_HEIGHT)) }}
      onPointerMove={event => {
        const y = event.clientY - event.currentTarget.getBoundingClientRect().top
        pointerY.current = y
        setInside(true)
        setActiveId(results[Math.floor((event.currentTarget.scrollTop + y) / ROW_HEIGHT)]?.entryId ?? null)
      }} onScroll={event => {
        const top = event.currentTarget.scrollTop
        setScrollTop(top)
        if (pointerY.current !== null) setActiveId(results[Math.floor((top + pointerY.current) / ROW_HEIGHT)]?.entryId ?? null)
      }}>
      <div className={styles.marks} style={{ height: results.length * ROW_HEIGHT }}>
        {visible.map(({ turn, index }) => {
          const distance = engaged ? Math.abs(index - activeIndex) : 5
          const length = engaged ? LINE_LENGTHS[Math.min(distance, LINE_LENGTHS.length - 1)] : turn.entryId === currentId ? 14 : 8
          return <div key={turn.entryId} id={`${id}-${turn.entryId}`} role="option" aria-label={`Turn ${turn.ordinal}: ${turn.preview || 'Attachment prompt'}`}
            aria-selected={engaged && turn.entryId === active?.entryId} aria-current={turn.entryId === currentId ? 'true' : undefined}
            aria-posinset={index + 1} aria-setsize={results.length} data-entry-id={turn.entryId} className={styles.markTarget} style={{ top: index * ROW_HEIGHT }}
            onPointerEnter={() => { setInside(true); setActiveId(turn.entryId) }} onMouseDown={event => event.preventDefault()} onClick={() => navigate(turn.entryId)}>
            <span data-turn-mark className={styles.mark} data-distance={distance} style={{ transform: `scaleX(${length / 48})`, opacity: engaged ? Math.max(0.3, 1 - distance * 0.16) : turn.entryId === currentId ? 1 : 0.5 }} />
          </div>
        })}
      </div>
    </div>
    <button type="button" className={styles.toggle} aria-label="Open conversation turns" aria-expanded={open} onClick={() => { if (open) dismiss(); else onOpenChange(true) }}><Search16Regular aria-hidden /></button>
    <span className={styles.srOnly} role={navigationError ? 'alert' : 'status'} aria-live={navigationError ? 'assertive' : 'polite'}>{status}</span>
    {engaged && createPortal(<div ref={flyout} className={styles.flyout} style={flyoutPosition} onPointerEnter={() => setInside(true)} onPointerLeave={event => leave(event.relatedTarget)}>
      <section className={styles.card} aria-label="Conversation turn preview">
        <div className={styles.heading}><span>{active ? `Turn ${active.ordinal.toLocaleString()}` : 'Conversation turns'}</span><span className={styles.headingEnd}>
          {active && <time dateTime={new Date(active.createdAt).toISOString()}>{timeFormat.format(active.createdAt)}</time>}
          {open && <button type="button" aria-label="Close conversation turns" onClick={dismiss}><Dismiss16Regular aria-hidden /></button>}</span></div>
        {open && <div className={styles.search}><Search16Regular aria-hidden /><input ref={input} role="combobox" aria-label="Search conversation turns" aria-controls={`${id}-list`} aria-expanded="true" aria-activedescendant={activeDomId} value={query} onChange={event => { setQuery(event.target.value); setActiveId(null) }}
          onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} placeholder="Search prompts…" spellCheck={false} autoComplete="off" /></div>}
        {state?.status === 'ready' ? <><p className={styles.prompt}>{active?.preview || (query ? 'No prompts match your search.' : 'Your first prompt will appear here.')}</p>
          <div className={styles.meta}>{navigationError || waiting || inFlight || request?.status.kind === 'failed' || request?.status.kind === 'expired' ? status : `${results.length.toLocaleString()} ${results.length === 1 ? 'turn' : 'turns'} · Scroll to browse`}</div>
          <div className={styles.actions}><span className={styles.hint}>Click a mark to jump</span>
            <button type="button" aria-label="Previous turn" disabled={!available || !turns?.length} onClick={() => { if (sessionId) void useOmpNavigationStore.getState().relative(sessionId, -1); focusActiveTerminal() }}><ArrowUp16Regular aria-hidden /></button>
            <button type="button" aria-label="Next turn" disabled={!available || !turns?.length} onClick={() => { if (sessionId) void useOmpNavigationStore.getState().relative(sessionId, 1); focusActiveTerminal() }}><ArrowDown16Regular aria-hidden /></button>
            <button type="button" className={styles.live} aria-label="Return to live terminal" disabled={!available || position?.mode !== 'browsing' && !inFlight && !waiting} onClick={() => { if (sessionId) void useOmpNavigationStore.getState().returnLive(sessionId); dismiss() }}><ArrowUndo16Regular aria-hidden />Live</button>
          </div></> : <div className={styles.empty}><p>{status}</p>{state?.status === 'error' && <button type="button" aria-label="Retry loading turns" onClick={() => { if (sessionId) void useOmpNavigationStore.getState().start(sessionId); input.current?.focus() }}>Retry loading turns</button>}</div>}
      </section>
    </div>, document.body)}
  </nav>
}
