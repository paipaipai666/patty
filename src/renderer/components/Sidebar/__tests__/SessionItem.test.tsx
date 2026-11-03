import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../../../store/sessionStore', () => {
  const state: any = {
    renameSession: vi.fn(),
    setDraggingSession: vi.fn(),
    agentStates: {}, agentRevisions: {}, agentRevisionFloor: 0,
    sessions: [],
    getState: () => state
  }
  const useSessionStore = (sel: (s: typeof state) => unknown) => sel(state)
  useSessionStore.getState = () => state
  return { useSessionStore, SESSION_COLOR_VARS: {} }
})

vi.mock('../../ContributionGrid/ContributionGrid', () => ({ ContributionGrid: () => <canvas data-testid="background-activity" /> }))

import { useSessionStore } from '../../../store/sessionStore'
import { SessionItem } from '../SessionItem'
import { SessionPreviewProvider } from '../SessionPreview'

const roots: ReturnType<typeof createRoot>[] = []
afterEach(() => { act(() => { for (const root of roots.splice(0)) root.unmount() }) })

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.getState().agentStates = {}
  document.body.innerHTML = ''
})

const defaultSession = {
  id: 's1',
  title: 'My Terminal',
  color: 'blue' as const,
  cwd: '',
  shell: 'powershell' as const,
  pid: 0,
  createdAt: 1,
  collectionId: null,
  aiType: null
}

function render(props: Partial<Parameters<typeof SessionItem>[0]> = {}) {
  const allProps = {
    session: defaultSession,
    isActive: false,
    onClose: vi.fn(),
    onSelect: vi.fn(),
    ...props
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<SessionPreviewProvider><SessionItem {...allProps} /></SessionPreviewProvider>) })
  return { container, root, props: allProps }
}

describe('SessionItem', () => {
  it('keeps status and context accessible while showing one quiet attention mark', () => {
    useSessionStore.getState().agentStates = { s1: { status: 'waiting_approval', unread: false } }
    const { container } = render({ session: { ...defaultSession, aiType: 'claude', cwd: 'D:\\work\\payments' } })
    expect(container.textContent).not.toContain('payments')
    expect(container.textContent).not.toContain('Claude Code')
    expect(container.querySelector('[aria-label="Waiting for approval"]')).not.toBeNull()
    expect(container.querySelector('[role="treeitem"]')?.getAttribute('aria-description')).toBe('Claude Code · payments, Waiting for approval')
    expect(container.querySelector('[data-testid="background-activity"]')).toBeNull()
  })

  it('keeps both background and foreground work free of animated indicators', () => {
    useSessionStore.getState().agentStates = { s1: { status: 'working', unread: false } }
    const session = { ...defaultSession, aiType: 'codex' as const }
    const { container, root } = render({ session })
    expect(container.querySelector('[data-testid="background-activity"]')).toBeNull()
    act(() => root.render(<SessionPreviewProvider><SessionItem session={session} isActive onClose={vi.fn()} onSelect={vi.fn()} /></SessionPreviewProvider>))
    expect(container.querySelector('[data-testid="background-activity"]')).toBeNull()
    expect(container.querySelector('[aria-label="Working"]')).toBeNull()
    expect(container.querySelector('[role="treeitem"]')?.getAttribute('aria-description')).toContain('Working')
  })

  it('renders session title', () => {
    const { container } = render()
    expect(container.textContent).toContain('My Terminal')
  })

  it('shows active state when isActive is true', () => {
    const { container } = render({ isActive: true })
    const tab = container.querySelector('[role="treeitem"][aria-selected="true"]')
    expect(tab).not.toBeNull()
  })

  it('does not show active state when isActive is false', () => {
    const { container } = render({ isActive: false })
    const tab = container.querySelector('[role="treeitem"][aria-selected="true"]')
    expect(tab).toBeNull()
  })

  it('double-click enters rename mode with input field', () => {
    const { container } = render()
    const tab = container.querySelector('[role="treeitem"]')!
    act(() => { tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const input = container.querySelector('input')!
    expect(input).not.toBeNull()
    expect(input.value).toBe('My Terminal')
  })

  it('rename submits on Enter', () => {
    const { container } = render()
    const tab = container.querySelector('[role="treeitem"]')!
    act(() => { tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const input = container.querySelector('input')!
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      nativeSetter.call(input, 'Renamed')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(useSessionStore.getState().renameSession).toHaveBeenCalledWith('s1', 'Renamed')
  })

  it('rename cancels on Escape', () => {
    const { container } = render()
    const tab = container.querySelector('[role="treeitem"]')!
    act(() => { tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const input = container.querySelector('input')!
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(container.textContent).toContain('My Terminal')
    expect(container.querySelector('input')).toBeNull()
  })

  it('drag start sets data and calls setDraggingSession', () => {
    const { container } = render()
    const tab = container.querySelector('[role="treeitem"]')!
    const dt = { setData: vi.fn(), effectAllowed: '' }
    const event = new Event('dragstart', { bubbles: true })
    Object.defineProperty(event, 'dataTransfer', { value: dt, writable: true })
    act(() => { tab.dispatchEvent(event) })
    expect(dt.setData).toHaveBeenCalledWith(
      'application/json',
      JSON.stringify({ type: 'session', id: 's1' })
    )
    expect(useSessionStore.getState().setDraggingSession).toHaveBeenCalledWith('s1')
  })

  it('close button calls onClose', () => {
    const onClose = vi.fn()
    const { container } = render({ onClose })
    const closeBtn = container.querySelector('button[aria-label="Close My Terminal"]')
    expect(closeBtn).not.toBeNull()
    act(() => { closeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onClose).toHaveBeenCalledWith('s1')
  })

  it('selects session on click', () => {
    const onSelect = vi.fn()
    const { container } = render({ onSelect })
    const tab = container.querySelector('[role="treeitem"]')!
    act(() => { tab.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onSelect).toHaveBeenCalledWith('s1')
  })
})
