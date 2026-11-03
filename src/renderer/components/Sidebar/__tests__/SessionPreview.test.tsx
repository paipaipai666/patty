import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore, type TerminalSession } from '../../../store/sessionStore'
import { useSettingsStore } from '../../../store/settingsStore'
import { SessionItem } from '../SessionItem'
import { SessionPreviewProvider } from '../SessionPreview'

vi.mock('../../../store/dirtyScheduler', () => ({ markDirty: vi.fn() }))

const sessions: TerminalSession[] = [
  { id: 'one', title: 'Login callback', shell: 'powershell', cwd: 'D:\\projects\\payments', color: 'blue', collectionId: null, pid: 1, createdAt: 1, aiType: 'claude' },
  { id: 'two', title: 'Server logs', shell: 'ssh', cwd: '/srv/payments', ssh: { host: 'prod-01', user: 'deploy', port: 2222 }, color: 'amber', collectionId: null, pid: 2, createdAt: 2 }
]
let root: ReturnType<typeof createRoot>
let onSelect = vi.fn<(id: string) => void>()

beforeEach(() => {
  vi.useFakeTimers()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useSettingsStore.setState({ settingsOpen: false })
  useSessionStore.setState({ sessions, activeSessionId: 'two', sidebarVisible: true, agentStates: { one: { status: 'waiting_approval', unread: true } }, agentRevisions: {}, agentRevisionFloor: 0, draggingSessionId: null })
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  onSelect = vi.fn<(id: string) => void>()
  act(() => root.render(<SessionPreviewProvider>{sessions.map(session => <SessionItem key={session.id} session={session} isActive={false} onClose={vi.fn()} onSelect={onSelect} />)}</SessionPreviewProvider>))
})

afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
  document.body.innerHTML = ''
})

function row(id = 'one'): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tree-id="session:${id}"]`)
  if (!element) throw new Error(`Missing session ${id}`)
  return element
}

function enter(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })))
}

function leave(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
}

function advance(ms: number) { act(() => vi.advanceTimersByTime(ms)) }

describe('session previews', () => {
  it('waits for a deliberate hover and exposes complete metadata without changing attention', () => {
    enter(row())
    advance(399)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    advance(1)
    const preview = document.querySelector('[role="tooltip"]')
    expect(preview?.textContent).toContain('Login callback')
    expect(preview?.textContent).toContain('Claude Code')
    expect(preview?.textContent).toContain('D:\\projects\\payments')
    expect(preview?.textContent).toContain('Waiting for approval')
    expect(preview?.textContent).toContain('Unread')
    expect(row().getAttribute('aria-describedby')).toBe(preview?.id)
    expect(useSessionStore.getState().activeSessionId).toBe('two')
    expect(useSessionStore.getState().agentStates.one).toEqual({ status: 'waiting_approval', unread: true })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps keyboard focus on the row and dismisses with Escape', () => {
    act(() => row().focus())
    advance(400)
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
    expect(document.activeElement).toBe(row())
    act(() => row().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(row().hasAttribute('aria-describedby')).toBe(false)
    advance(1000)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(document.activeElement).toBe(row())
  })

  it('keeps the card readable while the pointer crosses into it', () => {
    enter(row())
    advance(400)
    const preview = document.querySelector('[role="tooltip"]')!
    leave(row())
    enter(preview)
    advance(500)
    expect(document.querySelector('[role="tooltip"]')).toBe(preview)
    leave(preview)
    advance(180)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('shares one preview across rows and displays an exact SSH target', () => {
    enter(row())
    advance(400)
    act(() => row('two').focus())
    advance(400)
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1)
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('deploy@prod-01:2222')
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('/srv/payments')
  })

  it('updates an open card from live agent events and clears it when the session is removed', () => {
    enter(row())
    advance(400)
    act(() => useSessionStore.getState().applyAgentUpdate({ paneId: 'one', revision: 10, agent: { aiType: 'claude', status: 'error' } }))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('Error')
    act(() => useSessionStore.getState().removeSession('one'))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('dismisses for an outside pointer action, a drag and a hidden sidebar', () => {
    enter(row())
    advance(400)
    act(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    leave(row())
    enter(row())
    advance(400)
    const drag = new Event('dragstart', { bubbles: true })
    Object.defineProperty(drag, 'dataTransfer', { value: { setData: vi.fn(), effectAllowed: '' } })
    act(() => row().dispatchEvent(drag))
    advance(400)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    act(() => useSessionStore.setState({ draggingSessionId: null }))
    leave(row('two'))
    enter(row('two'))
    advance(400)
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
    act(() => useSessionStore.setState({ sidebarVisible: false }))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('blocks background previews while settings owns the interaction', () => {
    enter(row())
    advance(400)
    act(() => useSettingsStore.getState().openSettings())
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    act(() => row('two').focus())
    advance(400)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('cancels hover work on selection, renaming, scrolling and unmount', () => {
    enter(row())
    advance(400)
    act(() => row().click())
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(onSelect).toHaveBeenCalledWith('one')
    leave(row())
    enter(row())
    advance(400)
    act(() => row().dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    enter(row('two'))
    advance(400)
    act(() => window.dispatchEvent(new Event('scroll')))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    enter(row('two'))
    act(() => root.unmount())
    advance(1000)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    root = createRoot(document.createElement('div'))
  })
})
