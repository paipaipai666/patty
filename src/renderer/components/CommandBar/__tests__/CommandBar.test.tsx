import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

const { sessionState, workspaceState, mockWrite, mockResetAttention } = vi.hoisted(() => ({
  sessionState: {
    sessions: [] as Array<Record<string, unknown>>,
    activeSessionId: null as string | null
  },
  workspaceState: {
    workspaces: [] as unknown[],
    activeWorkspaceId: 'w1' as string | null,
    focusedSessionId: 's1' as string | null
  },
  mockWrite: vi.fn(),
  mockResetAttention: vi.fn()
}))

vi.mock('../../../store/sessionStore', () => {
  const useSessionStore = (sel: (s: typeof sessionState) => unknown) => sel(sessionState)
  useSessionStore.getState = () => ({ ...sessionState, resetAttention: mockResetAttention })
  return { useSessionStore }
})

vi.mock('../../../store/workspaceStore', () => {
  const useWorkspaceStore = (sel: (s: typeof workspaceState) => unknown) => sel(workspaceState)
  return {
    useWorkspaceStore,
    getFocusedSessionId: () => workspaceState.focusedSessionId
  }
})

Object.assign(window, { terminalAPI: { write: mockWrite } })

import { CommandBar } from '../CommandBar'

const roots: Array<ReturnType<typeof createRoot>> = []

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  document.body.innerHTML = ''
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  workspaceState.focusedSessionId = 's1'
  sessionState.sessions = [{
    id: 's1', title: 'prod', shell: 'ssh', cwd: '', pid: 0, color: 'blue',
    ssh: { host: '10.0.0.5', user: 'deploy' }
  }]
})

function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<CommandBar />) })
  return { container, root }
}

afterEach(() => {
  roots.forEach((r) => r.unmount())
  roots.length = 0
})

function inputOf(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[aria-label="SSH command input"]')!
}

function typeValue(input: HTMLInputElement, value: string) {
  // Controlled input: go through the native setter so React sees the change.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function keydown(input: HTMLInputElement, key: string) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

describe('CommandBar', () => {
  it('renders the input when the focused session is ssh', () => {
    const { container } = render()
    expect(inputOf(container)).not.toBeNull()
    expect(inputOf(container).placeholder).toContain('deploy@10.0.0.5')
  })

  it('renders nothing for non-ssh sessions', () => {
    sessionState.sessions = [{ id: 's1', title: 'T', shell: 'powershell', cwd: '', pid: 0, color: 'blue' }]
    const { container } = render()
    expect(container.querySelector('input')).toBeNull()
  })

  it('Enter sends the command with CR and clears the input', () => {
    const { container } = render()
    const input = inputOf(container)
    typeValue(input, 'ls -la')
    keydown(input, 'Enter')
    expect(mockWrite).toHaveBeenCalledWith('s1', 'ls -la\r')
    expect(mockResetAttention).toHaveBeenCalledWith('s1')
    expect(input.value).toBe('')
    expect(JSON.parse(localStorage.getItem('patty-cmd-history')!)).toEqual(['ls -la'])
  })

  it('Enter on blank input sends nothing', () => {
    const { container } = render()
    keydown(inputOf(container), 'Enter')
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('consecutive duplicate commands are not duplicated in history', () => {
    const { container } = render()
    const input = inputOf(container)
    typeValue(input, 'top')
    keydown(input, 'Enter')
    typeValue(input, 'top')
    keydown(input, 'Enter')
    expect(JSON.parse(localStorage.getItem('patty-cmd-history')!)).toEqual(['top'])
    expect(mockWrite).toHaveBeenCalledTimes(2)
  })

  it('ArrowUp recalls the most recent command, ArrowDown restores the draft', () => {
    localStorage.setItem('patty-cmd-history', JSON.stringify(['first', 'second']))
    const { container } = render()
    const input = inputOf(container)
    typeValue(input, 'draft text')
    keydown(input, 'ArrowUp')
    expect(input.value).toBe('second')
    keydown(input, 'ArrowUp')
    expect(input.value).toBe('first')
    keydown(input, 'ArrowDown')
    expect(input.value).toBe('second')
    keydown(input, 'ArrowDown')
    expect(input.value).toBe('draft text')
  })

  it('shows a ghost suffix from history prefix and Tab accepts it', () => {
    localStorage.setItem('patty-cmd-history', JSON.stringify(['echo hello']))
    const { container } = render()
    const input = inputOf(container)
    typeValue(input, 'echo h')
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('echo hello')
    keydown(input, 'Tab')
    expect(input.value).toBe('echo hello')
  })
})
