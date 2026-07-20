import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

const { sessionState } = vi.hoisted(() => ({
  sessionState: { sessions: [] as any[], activeSessionId: null as string | null }
}))

vi.mock('../../../store/sessionStore', () => {
  const useSessionStore = (sel: (s: typeof sessionState) => unknown) => sel(sessionState)
  useSessionStore.getState = () => sessionState
  return { useSessionStore }
})

import { StatusBar } from '../StatusBar'

beforeEach(() => {
  sessionState.sessions = []
  sessionState.activeSessionId = null
  document.body.innerHTML = ''
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

function render(props: { metricsOpen?: boolean; onToggleMetrics?: () => void } = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<StatusBar metricsOpen={props.metricsOpen} onToggleMetrics={props.onToggleMetrics} />)
  })
  return { container, root }
}

describe('StatusBar', () => {
  it('shows "No active session" when no active session', () => {
    const { container } = render()
    expect(container.textContent).toContain('No active session')
  })

  it('shows session title, shell label, cwd for active session', () => {
    sessionState.sessions = [{ id: 'sess-1', title: 'Terminal 1', shell: 'powershell', cwd: 'C:\\Users\\test\\project', pid: 0, color: 'blue' }]
    sessionState.activeSessionId = 'sess-1'
    const { container } = render()
    expect(container.textContent).toContain('Terminal 1')
    expect(container.textContent).toContain('Windows PowerShell')
    expect(container.textContent).toContain('~/project')
  })

  it('shows PID when session has pid > 0', () => {
    sessionState.sessions = [{ id: 'sess-1', title: 'Terminal 1', shell: 'cmd', cwd: 'C:\\', pid: 4567, color: 'green' }]
    sessionState.activeSessionId = 'sess-1'
    const { container } = render()
    expect(container.textContent).toContain('PID 4567')
  })

  it('formatCwd replaces USERPROFILE prefix with ~', () => {
    sessionState.sessions = [{ id: 'sess-1', title: 'T', shell: 'powershell', cwd: 'C:\\Users\\john\\Documents\\code', pid: 0, color: 'blue' }]
    sessionState.activeSessionId = 'sess-1'
    const { container } = render()
    expect(container.textContent).toContain('~/Documents/code')
  })

  it('shows unknown shell label when shell is not in SHELL_LABELS', () => {
    sessionState.sessions = [{ id: 'sess-1', title: 'T', shell: 'zsh', cwd: '/home', pid: 0, color: 'blue' }]
    sessionState.activeSessionId = 'sess-1'
    const { container } = render()
    expect(container.textContent).toContain('zsh')
  })

  it('metrics toggle button works', () => {
    const onToggle = vi.fn()
    const { container } = render({ onToggleMetrics: onToggle })
    const btn = container.querySelector('button')
    expect(btn).toBeTruthy()
    act(() => { btn!.click() })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('metrics button shows active class when metricsOpen is true', () => {
    const { container } = render({ metricsOpen: true, onToggleMetrics: vi.fn() })
    const btn = container.querySelector('button')
    expect(btn?.getAttribute('aria-pressed')).toBe('true')
  })
})
