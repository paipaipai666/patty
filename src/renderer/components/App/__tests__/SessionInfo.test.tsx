import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionInfo } from '../SessionInfo'
import { useSessionStore } from '../../../store/sessionStore'
import type { CommandSnapshot } from '../../../../shared/commandTypes'

let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
const commandState = vi.fn<(id: string) => Promise<CommandSnapshot | null>>()
beforeEach(() => {
  vi.useFakeTimers()
  commandState.mockReset().mockResolvedValue(null)
  Object.defineProperty(window, 'terminalAPI', { configurable: true, value: { commandStateSnapshot: commandState } })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useSessionStore.setState({ sessions: [{ id: 'remote', title: 'Production', shell: 'ssh', ssh: { host: 'prod-01', user: 'deploy', port: 2222 }, cwd: '/srv/payments', color: 'blue', pid: 42, createdAt: 1, collectionId: null }], agentStates: { remote: { status: 'waiting_approval', unread: false } } })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers() })

it('shows live command duration and preserves unknown results instead of showing success', async () => {
  commandState.mockResolvedValue({ runId: '1', revision: 1, status: 'running', elapsedMs: 250 })
  await act(async () => root.render(<SessionInfo sessionId="remote" onClose={vi.fn()} />))
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('RunningElapsed250 ms')
  commandState.mockResolvedValue({ runId: '1', revision: 2, status: 'finished', durationMs: 1250, exitCode: null })
  await act(async () => vi.advanceTimersByTime(250))
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('FinishedExit codeNot reportedDuration1.25 s')
  commandState.mockResolvedValue({ runId: '2', revision: 2, status: 'finished', durationMs: 30, exitCode: 7 })
  await act(async () => vi.advanceTimersByTime(250))
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Exit code7Duration30 ms')
  act(() => root.render(null))
  const calls = commandState.mock.calls.length
  await act(async () => vi.advanceTimersByTime(5000))
  expect(commandState).toHaveBeenCalledTimes(calls)
})

it('ignores a pending response after its session has been removed', async () => {
  let complete: (value: CommandSnapshot) => void = () => {}
  commandState.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  await act(async () => root.render(<SessionInfo sessionId="remote" onClose={vi.fn()} />))
  act(() => useSessionStore.setState({ sessions: [] }))
  await act(async () => complete({ runId: '1', revision: 1, status: 'running', elapsedMs: 250 }))
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('This session is no longer available.')
  await act(async () => vi.advanceTimersByTime(5000))
  expect(commandState).toHaveBeenCalledTimes(1)
})

it('stops querying command state while the application is hidden', async () => {
  const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  await act(async () => root.render(<SessionInfo sessionId="remote" onClose={vi.fn()} />))
  expect(commandState).toHaveBeenCalledTimes(1)
  visibility.mockReturnValue(true)
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => vi.advanceTimersByTime(5000))
  expect(commandState).toHaveBeenCalledTimes(1)
  visibility.mockReturnValue(false)
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(commandState).toHaveBeenCalledTimes(2)
  visibility.mockRestore()
})

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
