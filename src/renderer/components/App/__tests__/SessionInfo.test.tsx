import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionInfo } from '../SessionInfo'
import { useSessionStore } from '../../../store/sessionStore'

let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useSessionStore.setState({ sessions: [{ id: 'remote', title: 'Production', shell: 'ssh', ssh: { host: 'prod-01', user: 'deploy', port: 2222 }, cwd: '/srv/payments', color: 'blue', pid: 42, createdAt: 1, collectionId: null }], agentStates: { remote: { status: 'waiting_approval', unread: false } } })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('shows the exact remote identity, path, process and live status on request', () => {
  act(() => root.render(<SessionInfo sessionId="remote" onClose={vi.fn()} />))
  const text = document.querySelector('[role="dialog"]')?.textContent
  expect(text).toContain('deploy@prod-01:2222')
  expect(text).toContain('/srv/payments')
  expect(text).toContain('PID 42')
  expect(text).toContain('Waiting for approval')
  act(() => useSessionStore.setState({ agentStates: { remote: { status: 'error', unread: true } } }))
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Error')
})

it('handles a session disappearing while details remain open and closes from Escape', () => {
  const close = vi.fn()
  act(() => root.render(<SessionInfo sessionId="remote" onClose={close} />))
  act(() => useSessionStore.setState({ sessions: [] }))
  expect(document.querySelector('[role="status"]')?.textContent).toBe('This session is no longer available.')
  act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(close).toHaveBeenCalledTimes(1)
})
